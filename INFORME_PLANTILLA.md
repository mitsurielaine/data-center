# Trabajo Práctico: Despliegue Automatizado y Administración de Servicios en VPS

**Materia:** Administración de Data Center
**Docente:** Ing. Carlos Muñoz M.
**Autor:** [TU NOMBRE COMPLETO]

> Esta plantilla sigue exactamente las 4 secciones que exige el enunciado (punto 2) y los 5
> criterios de la rúbrica (punto 3). Cada `[COMPLETAR: ...]` se llena con datos reales una vez
> hecho el despliegue — no se inventa nada, se documenta lo que realmente pasó (incluyendo
> errores y cómo se resolvieron, como pide una bitácora real).

---

## 1. Diseño de la Infraestructura

*(Rúbrica 4.1 — Infraestructura: "instalación impecable, servicios optimizados y seguros")*

### 1.1 Descripción general

La aplicación se ejecuta en una única instancia EC2 de AWS mediante contenedores Docker
orquestados con Docker Compose. Tres servicios conforman el stack: un contenedor **frontend**
(Nginx sirviendo el SPA estático y actuando como proxy inverso hacia la API), un contenedor
**backend** (API REST en Node.js/Express) y un contenedor **database** (PostgreSQL 16). Los tres
se comunican mediante una red bridge privada de Docker (`internal`); solo Nginx publica el
puerto 80 hacia internet.

Acceso: `http://[COMPLETAR: TU_IP_PUBLICA]` (sin dominio propio, según lo definido para este
trabajo).

### 1.2 Diagrama de arquitectura

```
[COMPLETAR: pegar aquí el diagrama — se puede pedir a Claude Desktop que lo genere una vez
se tenga la IP real, mostrando: Usuario → VPS AWS EC2 → (Security Group + UFW) →
contenedor frontend (Nginx:80) → contenedor backend (Node/Express:3000, red interna) →
contenedor database (PostgreSQL:5432, red interna) → GitHub Actions (push a main → SSH deploy)]
```

### 1.3 Componentes principales

| Componente | Tecnología | Función |
|---|---|---|
| Instancia VPS | AWS EC2 [COMPLETAR: tipo], Ubuntu 24.04 LTS | Servidor real con IP pública [COMPLETAR] |
| Frontend | Nginx + HTML/CSS/JS | Sirve el SPA, proxy `/api/` hacia el backend |
| Backend | Node.js + Express | API REST (`/api/tasks`, `/api/health`), solo en red interna |
| Database | PostgreSQL 16 | Persiste las tareas; puerto 5432 solo accesible internamente |
| Orquestación | Docker Compose | `docker-compose.yml` versionado en Git |
| CI/CD | GitHub Actions | Valida y despliega por SSH ante cada push a `main` |
| Firewall de red | AWS Security Group | Filtra 22/80 a nivel de nube |
| Firewall de sistema | UFW | Segunda capa de filtrado dentro del VPS |
| Respaldos | cron + `pg_dump` + gzip | Respaldo diario con retención de 7 días |

---

## 2. Proceso de Provisionamiento

*(Rúbrica — bitácora de instalación y configuración: puertos abiertos, usuarios, permisos)*

> Completar como tabla cronológica real, basada en lo ejecutado siguiendo `GUIA_DESPLIEGUE.md`.
> Incluir cualquier problema real que haya surgido y cómo se resolvió (por ejemplo, si el SSH no
> conectaba, si hubo que ajustar memoria, etc.) — eso demuestra manejo real del entorno, no solo
> haber copiado comandos.

| Paso | Actividad | Detalle |
|---|---|---|
| 1 | Cuenta AWS | [COMPLETAR] |
| 2 | Security Group | [COMPLETAR: nombre, reglas exactas creadas] |
| 3 | Lanzamiento de instancia | [COMPLETAR: tipo, AMI, key pair, IP asignada] |
| 4 | Conexión SSH | [COMPLETAR: ¿directa o EC2 Instance Connect? ¿hubo problemas?] |
| 5 | Actualización del sistema | `sudo apt update && sudo apt upgrade -y` |
| 6 | Firewall UFW | [COMPLETAR: puertos permitidos, resultado de `sudo ufw status`] |
| 7 | Instalación de Docker | [COMPLETAR: versión instalada, `docker --version`] |
| 8 | Clonado del repositorio | [COMPLETAR: deploy key usada, resultado] |
| 9 | Variables de entorno | `.env` creado en el servidor (nunca versionado) |
| 10 | Primer despliegue | `docker compose up -d --build` — [COMPLETAR: resultado, `docker compose ps`] |
| 11 | Verificación funcional | [COMPLETAR: CRUD probado manualmente por IP pública] |
| 12 | fail2ban (opcional) | [COMPLETAR si se instaló] |
| 13 | Respaldos automáticos | Cron diario 03:00 con `pg_dump` + gzip, retención 7 días |

---

## 3. Configuración del Pipeline CI/CD

*(Rúbrica — Automatización CI/CD: "los cambios locales se reflejan solos en el VPS")*

### 3.1 Descripción general

El pipeline se define en `.github/workflows/deploy.yml` y corre ante cada `push` o `pull request`
contra `main`. Tiene dos jobs secuenciales: `validate` y `deploy` (este último solo en eventos
`push`, y depende de que `validate` pase).

### 3.2 Job `validate`

Descarga el código, instala dependencias del backend (`npm ci`), valida su sintaxis, valida la
sintaxis de `docker-compose.yml` (`docker compose config --quiet`) y construye las imágenes
(`docker compose build`) para confirmar que el proyecto compila de extremo a extremo antes de
tocar producción.

### 3.3 Job `deploy`

Se conecta por SSH real al VPS (acción `appleboy/ssh-action`, autenticada con una llave privada
guardada como secreto de GitHub) y ejecuta: `git fetch` + `git reset --hard origin/main`,
`docker compose up -d --build`, `docker image prune -f`, y finalmente un `curl` contra
`/api/health` que hace fallar el job si la app no responde tras el despliegue.

### 3.4 Secretos utilizados

| Secreto | Propósito |
|---|---|
| `VPS_HOST` | [COMPLETAR: IP pública] |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | Llave privada dedicada al pipeline (distinta de la personal y de la deploy key) |
| `VPS_PORT` | `22` |

### 3.5 Evidencia de funcionamiento

[COMPLETAR: describir la prueba real — un cambio menor, push a main, y el workflow ejecutándose
en verde en la pestaña Actions, con el cambio reflejado en la IP pública sin tocar el VPS a mano]

---

## 4. Plan de Mantenimiento y Seguridad

*(Rúbrica 4.4 — "firewall configurado, respaldos automatizados y logs revisados")*

### 4.1 Firewall en dos capas
- **AWS Security Group**: permite únicamente 22 (SSH) y 80 (HTTP) [COMPLETAR: origen de cada regla].
- **UFW** (sistema operativo): misma política de puertos, segunda capa independiente.
- El backend (3000) y la base de datos (5432) nunca se exponen fuera de la red interna de Docker.

### 4.2 Respaldo de la base de datos
Script `~/backups/backup-db.sh` ejecuta `pg_dump` sobre la base, comprime con `gzip` y elimina
respaldos de más de 7 días. Cron diario a las 03:00. [COMPLETAR: confirmar ejecución manual de
prueba y que el archivo `.sql.gz` se generó correctamente]

### 4.3 Gestión de secretos
Ningún secreto (contraseña de base de datos, llaves privadas) está versionado en Git — `.env`
está excluido vía `.gitignore`. Las credenciales del pipeline viven únicamente como GitHub
Actions Secrets, cifrados y ocultos en los logs.

### 4.4 Recomendaciones futuras
[COMPLETAR: por ejemplo, mover respaldos a S3, restringir el puerto 22 a rangos de IP de GitHub
Actions, habilitar `unattended-upgrades`, etc.]

---

## 5. Conclusión

[COMPLETAR: 3-4 líneas resumiendo que la infraestructura cumple los 4 requisitos técnicos del
enunciado: VPS real, stack completo con BD relacional, CI/CD automático por SSH, y plan de
mantenimiento con firewall en dos capas y respaldos automáticos]

## 6. Anexos

- Anexo 1: [COMPLETAR: captura de la instancia EC2 en la consola de AWS]
- Anexo 2: [COMPLETAR: captura de las reglas de entrada del Security Group]
- Anexo 3: [COMPLETAR: captura de la pestaña Actions de GitHub con el workflow en verde]
- Anexo 4: [COMPLETAR: captura de `docker compose ps` mostrando los 3 contenedores]
- Anexo 5: [COMPLETAR: captura de la app funcionando en el navegador vía IP pública]
