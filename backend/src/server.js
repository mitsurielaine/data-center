import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { pool } from './db.js';
import tasksRouter from './routes/tasks.js';

const app = express();

// La API vive detrás del proxy inverso de Nginx: se confía en un único salto
// para que el rate limiting use la IP real del cliente (X-Forwarded-For) y no
// la del contenedor frontend.
app.set('trust proxy', 1);

// No anunciar la tecnología del servidor.
app.disable('x-powered-by');

// Cabeceras de seguridad en las respuestas de la API. La CSP la fija Nginx
// para el HTML; aquí se aplican el resto de protecciones.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// CORS: el frontend se sirve desde el MISMO origen a través del proxy de Nginx,
// así que no hace falta habilitar orígenes cruzados. Antes se usaba cors() sin
// opciones, que responde "Access-Control-Allow-Origin: *" y permitía que
// cualquier sitio de internet consumiera esta API desde el navegador de la
// víctima. Si alguna vez se necesita un origen externo, se declara de forma
// explícita en la variable CORS_ORIGIN.
const origenPermitido = process.env.CORS_ORIGIN;
if (origenPermitido) {
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origenPermitido);
    res.setHeader('Vary', 'Origin');
    next();
  });
}

// Cuerpo JSON acotado: evita agotar la memoria del contenedor con payloads
// enormes (la instancia solo tiene 1 GiB de RAM).
app.use(express.json({ limit: '10kb' }));

// Limitación de tasa a nivel de aplicación (segunda capa, además de la de Nginx).
const limitadorApi = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intente más tarde' },
});

/** Endpoint de salud — usado por el pipeline de CI/CD y por los healthchecks */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Fallo de conexión a la base de datos:', err);
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.use('/api/tasks', limitadorApi, tasksRouter);

// Manejador de errores: nunca se devuelve el stack ni el detalle interno al
// cliente (evita filtrar rutas, versiones o consultas SQL).
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Cuerpo de la petición demasiado grande' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = Number(process.env.PORT) || 3000;
const servidor = app.listen(PORT, () => {
  console.log(`API de data-center-backend escuchando en el puerto ${PORT}`);
});

// Apagado ordenado: cierra el servidor HTTP y el pool de PostgreSQL para no
// dejar conexiones colgadas cuando el pipeline reinicia los contenedores.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    console.log(`${senal} recibido, cerrando de forma ordenada…`);
    servidor.close(() => pool.end().finally(() => process.exit(0)));
  });
}
