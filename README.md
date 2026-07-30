# data-center — Task Queue

Aplicación web (SPA) para gestión de tareas (To-Do List) con CRUD completo y filtro en tiempo real, construida para el
**Trabajo Práctico: Despliegue Automatizado y Administración de Servicios en VPS** (Administración de Data Center, UPSE).

**En producción:** https://3-144-146-133.nip.io (HTTPS con certificado de Let's Encrypt)

## Stack

- **Frontend:** HTML/CSS/JS puro, sin build step, servido por **Nginx** (también actúa como proxy inverso hacia la API).
- **Backend:** **Node.js + Express**, API REST (`/api/tasks`, `/api/health`).
- **Base de datos:** **PostgreSQL 16**.
- **Orquestación:** **Docker Compose** (3 contenedores: `frontend`, `backend`, `db`, comunicados por una red interna privada).
- **CI/CD:** **GitHub Actions** — valida y despliega automáticamente por SSH en cada `push` a `main`.

## Ejecutar en local (para probar antes de subir al VPS)

```bash
cp .env.example .env          # completa una contraseña
docker compose up -d --build
```

Abre `http://localhost` en el navegador. La API queda en `http://localhost/api/tasks`.

Para ver logs: `docker compose logs -f`
Para apagar: `docker compose down` (o `docker compose down -v` para borrar también los datos).

## Guía completa de despliegue en AWS (desde cero)

Ver **`GUIA_DESPLIEGUE.md`** — cubre: creación de la cuenta AWS, Security Group, instancia EC2, conexión SSH,
instalación de Docker, primer despliegue manual, configuración del pipeline de CI/CD, y el plan de seguridad y
respaldos que pide el informe.

## Informe técnico (entregable)

Ver **`INFORME_PLANTILLA.md`** — estructurado 1:1 con las 4 secciones que exige el enunciado y los 5 criterios
de la rúbrica. Se completa con datos reales (IP, capturas, bitácora) después de hacer el despliegue; no antes.
