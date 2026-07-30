import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

const LARGO_MAXIMO_TITULO = 255;

/**
 * Valida que el parámetro :id sea un entero positivo.
 * Las consultas ya usan parámetros ($1, $2…), por lo que no había inyección
 * SQL; el problema era que un id no numérico llegaba a PostgreSQL y provocaba
 * un error 500 (comportamiento inesperado y ruido en los logs) en lugar de un
 * 400 limpio. Validar en la frontera también reduce la superficie de abuso.
 */
function idValido(valor) {
  return /^[0-9]{1,9}$/.test(String(valor)) && Number(valor) > 0;
}

/** GET /api/tasks — Listar todas las tareas */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, completed, created_at FROM tasks ORDER BY created_at DESC LIMIT 500'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar tareas:', err);
    res.status(500).json({ error: 'Error al listar tareas' });
  }
});

/** POST /api/tasks — Crear una tarea nueva. Body: { title } */
router.post('/', async (req, res) => {
  const bruto = req.body?.title;

  // Validación estricta de tipo: antes se hacía (req.body?.title || '') y un
  // objeto o un arreglo pasaban el filtro y llegaban al driver de PostgreSQL.
  if (typeof bruto !== 'string') {
    return res.status(400).json({ error: 'El título debe ser una cadena de texto' });
  }

  const title = bruto.trim();
  if (!title) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }
  if (title.length > LARGO_MAXIMO_TITULO) {
    return res.status(400).json({ error: `El título no puede exceder ${LARGO_MAXIMO_TITULO} caracteres` });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO tasks (title, completed) VALUES ($1, false) RETURNING id, title, completed, created_at',
      [title]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error al crear tarea:', err);
    res.status(500).json({ error: 'Error al crear la tarea' });
  }
});

/** PUT /api/tasks/:id — Actualizar título y/o estado. Body: { title?, completed? } */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'Identificador inválido' });
  }

  const { title, completed } = req.body || {};

  // Solo se aceptan los tipos esperados; cualquier otra cosa se rechaza.
  if (title !== undefined && title !== null) {
    if (typeof title !== 'string') {
      return res.status(400).json({ error: 'El título debe ser una cadena de texto' });
    }
    if (!title.trim()) {
      return res.status(400).json({ error: 'El título no puede estar vacío' });
    }
    if (title.length > LARGO_MAXIMO_TITULO) {
      return res.status(400).json({ error: `El título no puede exceder ${LARGO_MAXIMO_TITULO} caracteres` });
    }
  }
  if (completed !== undefined && completed !== null && typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'El campo completed debe ser booleano' });
  }
  if ((title === undefined || title === null) && (completed === undefined || completed === null)) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         completed = COALESCE($2, completed)
       WHERE id = $3
       RETURNING id, title, completed, created_at`,
      [title?.trim() ?? null, completed ?? null, Number(id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar tarea:', err);
    res.status(500).json({ error: 'Error al actualizar la tarea' });
  }
});

/** DELETE /api/tasks/:id — Eliminar una tarea */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) {
    return res.status(400).json({ error: 'Identificador inválido' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [Number(id)]);
    if (!rowCount) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.status(204).send();
  } catch (err) {
    console.error('Error al eliminar tarea:', err);
    res.status(500).json({ error: 'Error al eliminar la tarea' });
  }
});

export default router;
