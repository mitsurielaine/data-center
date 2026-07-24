import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { pool } from './db.js';
import tasksRouter from './routes/tasks.js';

const app = express();
app.use(cors());
app.use(express.json());

/** Endpoint de salud — usado por el pipeline de CI/CD para confirmar el despliegue */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Fallo de conexión a la base de datos:', err);
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.use('/api/tasks', tasksRouter);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`API de data-center-backend escuchando en el puerto ${PORT}`);
});
