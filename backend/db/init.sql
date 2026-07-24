-- Se ejecuta automáticamente una única vez cuando el volumen de PostgreSQL
-- está vacío (ver docker-entrypoint-initdb.d en la imagen oficial de postgres).

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  completed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Datos de ejemplo para verificar el CRUD apenas se levanta el sistema
INSERT INTO tasks (title, completed) VALUES
  ('Configurar el Security Group en AWS', true),
  ('Instalar Docker y Docker Compose en el VPS', true),
  ('Probar el pipeline de GitHub Actions', false);
