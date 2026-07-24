import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

/**
 * Pool de conexiones a PostgreSQL.
 * En Docker Compose, DB_HOST apunta al nombre del servicio ("db"),
 * que Docker resuelve internamente por DNS dentro de la red "internal".
 */
export const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});
