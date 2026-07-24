import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/** GET /api/tasks — Listar todas las tareas */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, completed, created_at FROM tasks ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al listar tareas:', err);
    res.status(500).json({ error: 'Error al listar tareas' });
  }
});

/** POST /api/tasks — Crear una tarea nueva. Body: { title } */
router.post('/', async (req, res) => {
  const title = (req.body?.title || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'El título es obligatorio' });
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
  const { title, completed } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         completed = COALESCE($2, completed)
       WHERE id = $3
       RETURNING id, title, completed, created_at`,
      [title ?? null, completed ?? null, id]
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
  try {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.status(204).send();
  } catch (err) {
    console.error('Error al eliminar tarea:', err);
    res.status(500).json({ error: 'Error al eliminar la tarea' });
  }
});

export default router;
