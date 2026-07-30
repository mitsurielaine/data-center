# Trabajo Práctico: Despliegue Automatizado y Administración de Servicios en VPS

**Materia:** Administración de Data Center
**Docente:** Ing. Carlos Muñoz M.
**Autor:** Marisa Eliana Matias Alcivar

> Este informe sigue las 4 secciones que exige el enunciado (punto 2) y los 5 criterios de la
> rúbrica (punto 3), y añade una sección de auditoría de seguridad (5) con las correcciones
> aplicadas sobre el servicio ya en producción. Todos los datos son reales y verificados: nada
> está inventado. Se documentan también los errores que surgieron y cómo se resolvieron, como
> corresponde a una bitácora real.

---

## 1. Diseño de la Infraestructura

*(Rúbrica 4.1 — Infraestructura: "instalación impecable, servicios optimizados y seguros")*

### 1.1 Descripción general

La aplicación se ejecuta en una única instancia EC2 de AWS mediante contenedores Docker
orquestados con Docker Compose. Tres servicios conforman el stack: un contenedor **frontend**
(Nginx sirviendo el SPA estático y actuando como proxy inverso hacia la API), un contenedor
**backend** (API REST en Node.js/Express) y un contenedor **database** (PostgreSQL 16). Los tres
se comunican mediante una red bridge privada de Docker (`internal`); solo Nginx publica puertos
hacia internet: el 443 (HTTPS) para la aplicación y el 80 únicamente para redirigir a HTTPS y
atender la validación del certificado.

Acceso: `https://3-144-146-133.nip.io` (HTTPS con certificado de Let's Encrypt). Al no
disponer de dominio propio se emplea el servicio gratuito **nip.io**, que resuelve el
subdominio a la IP que lleva incrustada en el nombre (3.144.146.133) sin necesidad de
configurar DNS. Todo acceso por HTTP se redirige a HTTPS con un 308.

### 1.2 Diagrama de arquitectura

![Diagrama de arquitectura](diagrama_arquitectura.png)

Usuario → HTTPS:443 → VPS AWS EC2 (3.144.146.133) → [Security Group + UFW + fail2ban] →
frontend (Nginx con TLS de Let's Encrypt, CSP y rate limiting; el 80 solo redirige con 308) →
backend (Node/Express:3000, red interna, usuario sin privilegios y sistema de archivos de solo
lectura) → database (PostgreSQL 16:5432, red interna). En paralelo: desarrollador → push a
`main` → GitHub Actions (validate + deploy por SSH:22) → VPS.

### 1.3 Componentes principales

| Componente | Tecnología | Función |
|---|---|---|
| Instancia VPS | AWS EC2 t3.micro, Ubuntu 24.04 LTS | Servidor real con IP pública 3.144.146.133 (región us-east-2, Ohio) |
| Frontend | Nginx + HTML/CSS/JS | Sirve el SPA, termina TLS 1.2/1.3, aplica CSP y rate limiting, proxy `/api/` hacia el backend |
| Certificados | Let's Encrypt + certbot | Certificado TLS para `3-144-146-133.nip.io`, renovación semanal automática |
| Backend | Node.js + Express + helmet | API REST (`/api/tasks`, `/api/health`), solo en red interna, corre como usuario sin privilegios |
| Database | PostgreSQL 16 | Persiste las tareas; puerto 5432 solo accesible internamente |
| Orquestación | Docker Compose | `docker-compose.yml` versionado en Git |
| CI/CD | GitHub Actions | Valida y despliega por SSH ante cada push a `main` |
| Firewall de red | AWS Security Group | Filtra 22/80/443 a nivel de nube |
| Firewall de sistema | UFW | Segunda capa de filtrado dentro del VPS (22/80/443) |
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
| 1 | Cuenta AWS | Cuenta free plan (ID 705061159695), región us-east-2 (Ohio). Alerta de presupuesto creada con la plantilla *Zero spend budget* (notifica al superar $0,01; la plantilla muestra $1 como monto nominal interno, lo cual generó una duda inicial que se aclaró leyendo la descripción de la propia plantilla). |
| 2 | Security Group | `data-center-sg` (sg-053023b53ec696b20). Entrada: SSH 22 solo desde la IP del administrador (181.211.216.101/32, opción "Mi IP") y HTTP 80 desde 0.0.0.0/0. Detalle real: la regla HTTP quedó inicialmente con origen "Personalizada" vacío y hubo que corregirla a "Cualquier lugar-IPv4" antes de crear el grupo. Salida: todo permitido (por defecto). |
| 3 | Lanzamiento de instancia | `data-center-vps` (i-0962f700486021b25), t3.micro (apto capa gratuita), AMI Ubuntu Server 24.04 LTS (ami-0ea1cddefe0c4aed5), zona us-east-2c, disco 20 GiB gp3. Key pair RSA `data-center-key.pem` generado al lanzar. IP pública asignada: 3.144.146.133. |
| 4 | Conexión SSH | Directa con OpenSSH de Windows: `ssh -i data-center-key.pem ubuntu@3.144.146.133`. Problema real: el primer intento falló con `WARNING: UNPROTECTED PRIVATE KEY FILE` / `bad permissions` porque el `.pem` heredaba permisos de lectura de otros grupos del sistema. Se resolvió con `icacls data-center-key.pem /inheritance:r /grant:r "%USERNAME%:R"` (quita la herencia y deja solo lectura para el usuario dueño). Segundo intento: conexión exitosa a Ubuntu 24.04.4 LTS. |
| 5 | Actualización del sistema | `sudo apt update && sudo apt upgrade -y` (con `NEEDRESTART_MODE=a` para evitar diálogos interactivos): 75 paquetes actualizados + kernel nuevo 6.17.0-1019-aws instalado (63 actualizaciones de seguridad LTS). Se reinició la instancia para cargar el kernel pendiente. También se creó un swapfile de 1 GiB (persistente vía `/etc/fstab`) como colchón de RAM para los builds de Docker en t3.micro (1 GiB de RAM). |
| 6 | Firewall UFW | `ufw allow 22/tcp`, `ufw allow 80/tcp`, `ufw --force enable`. `sudo ufw status` → Status: active, con 22/tcp y 80/tcp ALLOW Anywhere (IPv4 e IPv6); todo lo demás bloqueado por defecto. |
| 7 | Instalación de Docker | Repositorio oficial de Docker (clave GPG en `/etc/apt/keyrings/docker.gpg`). Instalado: docker-ce 29.6.2, containerd 2.2.6, docker-compose-plugin 5.3.1. Usuario `ubuntu` agregado al grupo `docker` (aplicado tras reiniciar la sesión). |
| 8 | Clonado del repositorio | Se generó una deploy key ED25519 dedicada en el VPS (`~/.ssh/deploy_key`) y se registró en el repo vía API de GitHub con `"read_only": true` (el servidor solo puede leer, nunca escribir). Con `~/.ssh/config` apuntando a esa llave, `git clone git@github.com:mitsurielaine/data-center.git ~/data-center` clonó sin problemas. |
| 9 | Variables de entorno | `.env` creado a partir de `.env.example`; `DB_PASSWORD` generada directamente en el servidor con `openssl rand -hex 20` (nunca pasó por el chat ni quedó versionada — `.env` está en `.gitignore`). |
| 10 | Primer despliegue | `docker compose up -d --build`: build completo en ~9 s (t3.micro con swap, sin cuelgues). `docker compose ps`: `data-center-db` (postgres:16-alpine) **healthy**, `data-center-backend` y `data-center-frontend` **Up**; solo el frontend publica `0.0.0.0:80->80`. `curl http://localhost/api/health` → `{"status":"ok","db":"connected"}`. |
| 11 | Verificación funcional | `http://3.144.146.133/api/health` respondió `{"status":"ok","db":"connected"}` desde internet (verificado desde fuera de la red del VPS). CRUD probado manualmente en el navegador vía IP pública: se creó la tarea "Prueba de url", se marcó como completada, se probó el filtro por título y la eliminación. El panel muestra los contadores (pendientes/completadas/total) sincronizados con la base. |
| 12 | fail2ban | Instalado fail2ban 1.0.2 con el jail `sshd` activo (`systemctl enable --now fail2ban`). Mitiga fuerza bruta sobre SSH, necesario porque el puerto 22 se abrió a 0.0.0.0/0 para los runners de GitHub Actions (IPs dinámicas). |
| 13 | Respaldos automáticos | Cron diario 03:00 con `pg_dump` + gzip, retención 7 días. Prueba manual exitosa: `tasksdb_2026-07-24_022013.sql.gz` (976 B) generado en `~/backups/`. |
| 14 | Auditoría de seguridad | Escaneo externo de la URL pública con Cloudflare URL Scanner + revisión manual del código (frontend, API, Dockerfiles y compose). 19 hallazgos detectados y corregidos — ver sección 5. |
| 15 | HTTPS con Let's Encrypt | Puerto 443 abierto en Security Group y UFW. Certificado emitido para `3-144-146-133.nip.io` mediante certbot con desafío HTTP-01 por webroot (válido hasta 2026-10-28). Renovación automática semanal por cron con recarga de Nginx. Se verificó el circuito ACME con un archivo de prueba antes de solicitar el certificado, para no consumir los intentos que limita Let's Encrypt. |
| 16 | Endurecimiento del servidor | SSH: `PasswordAuthentication no`, `PermitRootLogin no`, `MaxAuthTries 3`, `AllowUsers ubuntu`. fail2ban: 3 intentos, baneo de 1 h, ventana de 10 min. `unattended-upgrades` habilitado para parches automáticos. `chmod 600` en `.env`. |

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
| `VPS_HOST` | `3.144.146.133` (IP pública de la instancia) |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | Llave privada dedicada al pipeline (distinta de la personal y de la deploy key) |
| `VPS_PORT` | `22` |

### 3.5 Evidencia de funcionamiento

Dato real de la bitácora: la **primera** ejecución del workflow (disparada por el push inicial del
proyecto, antes de existir el VPS y los secretos) falló en el job `deploy` — comportamiento esperado
que confirmó que el pipeline no despliega si no puede conectarse al servidor.

Prueba definitiva: se editó una línea del `frontend/index.html` (se agregó el texto "Desplegado
automáticamente con GitHub Actions.") y se hizo push a `main` (commit `565b797`). El workflow corrió
`validate` (npm ci + verificación de sintaxis + `docker compose config` + build de imágenes) y luego
`deploy` (SSH real al VPS, `git reset --hard origin/main`, `docker compose up -d --build`, health
check con `curl`). En ~3 minutos el cambio quedó visible en `http://3.144.146.133` **sin tocar el
VPS manualmente**, verificado desde fuera de la red del servidor.

---

## 4. Plan de Mantenimiento y Seguridad

*(Rúbrica 4.4 — "firewall configurado, respaldos automatizados y logs revisados")*

### 4.1 Firewall en dos capas
- **AWS Security Group**: permite únicamente 22 (SSH) y 80 (HTTP). El 22 se restringió inicialmente a la IP del administrador ("Mi IP") y se abrió a 0.0.0.0/0 recién al configurar el pipeline (los runners de GitHub Actions no tienen IP fija), riesgo mitigado con fail2ban. El 80 está abierto a 0.0.0.0/0 por ser el servicio web público.
- **UFW** (sistema operativo): misma política de puertos, segunda capa independiente.
- El backend (3000) y la base de datos (5432) nunca se exponen fuera de la red interna de Docker.

### 4.2 Respaldo de la base de datos
Script `~/backups/backup-db.sh` ejecuta `pg_dump` sobre la base, comprime con `gzip` y elimina
respaldos de más de 7 días. Cron diario a las 03:00 (`0 3 * * *`, verificado con `crontab -l`).
Prueba manual ejecutada con éxito: se generó `tasksdb_2026-07-24_022013.sql.gz` (976 B comprimido)
en `~/backups/`, con log de ejecuciones en `~/backups/backup.log`.

### 4.3 Gestión de secretos
Ningún secreto (contraseña de base de datos, llaves privadas) está versionado en Git — `.env`
está excluido vía `.gitignore`. Las credenciales del pipeline viven únicamente como GitHub
Actions Secrets, cifrados y ocultos en los logs.

### 4.4 Recomendaciones futuras
Copiar los respaldos fuera de la instancia (por ejemplo a un bucket S3 con ciclo de vida) para
sobrevivir a la pérdida del volumen; restringir el puerto 22 a los rangos de IP publicados por
GitHub Actions (`api.github.com/meta`) en lugar de 0.0.0.0/0; habilitar `unattended-upgrades`
para parches de seguridad automáticos; agregar HTTPS con un certificado de Let's Encrypt usando
un subdominio gratuito tipo nip.io; y configurar alarmas de CloudWatch (CPU, disco, estado) para
detectar incidentes sin entrar al servidor.

---

---

## 5. Auditoría de Seguridad y Correcciones Aplicadas

*(Rúbrica 4.4 — servicios optimizados y seguros)*

Una vez el servicio estuvo en producción se realizó una auditoría en cuatro capas:
un escaneo externo de la URL pública con **Cloudflare URL Scanner** (que reporta las
cabeceras de respuesta y las peticiones que hace el sitio) y una **revisión manual del
código** del frontend, de la API, de los Dockerfiles y del `docker-compose.yml`. Se
detectaron 19 hallazgos y se corrigieron todos. La tabla resume cada uno con su
evidencia de verificación.

### 5.1 Capa de transporte y cabeceras HTTP

| # | Hallazgo | Riesgo | Corrección aplicada | Verificación |
|---|---|---|---|---|
| 1 | Sitio servido solo por HTTP, sin cifrado | Alto — credenciales y datos viajan en claro; permite interceptación y modificación en tránsito | TLS 1.2/1.3 con certificado de Let's Encrypt para `3-144-146-133.nip.io` (servicio gratuito, sin dominio propio). Servicio `certbot` con desafío HTTP-01 por webroot y renovación automática semanal por cron | `curl -I https://3-144-146-133.nip.io` → `HTTP/2 200` con certificado válido |
| 2 | Sin redirección de HTTP a HTTPS | Medio — el usuario podía seguir navegando sin cifrado | Redirección **308** (no 301: preserva el método, un 301 convertiría un POST en GET). El puerto 80 solo conserva el desafío ACME y la sonda de salud | `curl -I http://3-144-146-133.nip.io` → `308 Permanent Redirect` |
| 3 | Sin `Strict-Transport-Security` (HSTS) | Medio — vulnerable a degradación a HTTP en la primera visita | HSTS con `max-age=31536000; includeSubDomains`, emitido solo cuando el certificado es de confianza | Cabecera `strict-transport-security` presente en la respuesta |
| 4 | Sin `Content-Security-Policy` | Alto — sin defensa en profundidad frente a inyección de scripts | CSP restrictiva **sin `unsafe-inline`**: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`. Exigió refactorizar el frontend (ver 5.2) | Cabecera `content-security-policy` completa en la respuesta |
| 5 | Divulgación de la versión del servidor (`Server: nginx/1.27.5`) | Bajo — facilita al atacante buscar exploits de esa versión exacta | `server_tokens off` | La respuesta ahora dice solo `Server: nginx` |
| 6 | Faltaban `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` y `X-Permitted-Cross-Domain-Policies` | Bajo/Medio | Las cuatro cabeceras añadidas | Verificadas con `curl -I` |
| 7 | `X-Frame-Options: SAMEORIGIN` (permisivo) y cabeceras sin `always` | Bajo — nginx omitía las cabeceras en respuestas de error 4xx/5xx, justo donde más importan | `X-Frame-Options: DENY` y todas las cabeceras con el modificador `always` | Cabeceras presentes también en respuestas 404 |
| 8 | Sin limitación de tasa ni de conexiones | Medio — permitía abuso automatizado y fuerza bruta del CRUD | `limit_req_zone` a 10 r/s por IP con ráfaga de 20, `limit_conn` a 20 conexiones por IP, y `client_max_body_size 16k` en `/api/` | 30 peticiones seguidas: 26 → `200`, 4 → `429` |
| 9 | Tiempos de espera sin acotar | Bajo — conexiones lentas podían agotar los procesos de Nginx (tipo Slowloris) en una instancia de 1 GiB | `client_body_timeout`, `client_header_timeout`, `send_timeout` y `keepalive_timeout` acotados | Configuración validada con `nginx -t` en cada build |

### 5.2 Frontend

| # | Hallazgo | Riesgo | Corrección aplicada | Verificación |
|---|---|---|---|---|
| 10 | **XSS real**: el texto escrito en el filtro se insertaba sin escapar en el DOM al no haber coincidencias | **Alto** — con `<img src=x onerror=alert(1)>` en el buscador se ejecutaba JavaScript arbitrario en la página | El valor del filtro pasa por `escapeHtml()` antes de insertarse | Se probó el payload en el campo de filtro: ahora se muestra como texto literal, sin ejecutarse |
| 11 | Notificaciones construidas con `innerHTML` | Bajo — no explotable con los mensajes actuales, pero un patrón frágil | Reconstruidas con `createElement` y `textContent` | Revisión de código |
| 12 | Atributos `onclick` inline en cada fila | Medio — obligaban a permitir `unsafe-inline` en la CSP, anulando su protección | Reemplazados por **delegación de eventos** con `data-action`; CSS y JS extraídos a `styles.css` y `app.js` | La CSP sin `unsafe-inline` funciona y el CRUD sigue operativo |

### 5.3 API (Express)

| # | Hallazgo | Riesgo | Corrección aplicada | Verificación |
|---|---|---|---|---|
| 13 | `cors()` sin opciones → `Access-Control-Allow-Origin: *` | **Alto** — cualquier sitio web podía consumir la API desde el navegador de la víctima | Se eliminó la dependencia `cors`. El frontend es del mismo origen vía proxy, así que no se envía ninguna cabecera CORS; si alguna vez se necesita, se declara un origen concreto en `CORS_ORIGIN` | La respuesta ya no incluye `access-control-allow-origin` |
| 14 | Sin cabeceras de seguridad ni ocultamiento de tecnología (`X-Powered-By: Express`) | Bajo | `helmet` + `app.disable('x-powered-by')` | `curl -I` sobre la API: sin `x-powered-by`, con cabeceras de helmet |
| 15 | Sin validación de tipos ni de longitud; cuerpo JSON sin límite | Medio — un objeto o arreglo en `title` llegaba al driver de PostgreSQL, un `id` no numérico producía un 500, y un payload gigante podía agotar la memoria del contenedor | Validación estricta de tipo y longitud (máx. 255), `id` validado como entero positivo, `express.json({ limit: '10kb' })` y manejador de errores que nunca expone el stack | 9 casos probados: título objeto, vacío y de 300 caracteres, `id` no numérico, `completed` no booleano, JSON malformado y cuerpo de 20 kB → todos responden `400`/`413` con mensaje limpio |
| 16 | Sin limitación de tasa en la aplicación | Medio | `express-rate-limit` a 120 peticiones/minuto por IP, con `trust proxy` para leer la IP real detrás de Nginx | Tras superar el umbral la API responde `429` |

### 5.4 Contenedores y servidor

| # | Hallazgo | Riesgo | Corrección aplicada | Verificación |
|---|---|---|---|---|
| 17 | El backend corría como **root** dentro del contenedor; `npm install` no reproducible y ejecutaba scripts `postinstall` | **Alto** — una ejecución de código en el contenedor obtenía privilegios administrativos; los scripts de dependencias son un vector de cadena de suministro | `USER node` (uid 1000), `npm ci --omit=dev --ignore-scripts`, `read_only: true` con `/tmp` en tmpfs, `cap_drop: ALL` y `no-new-privileges` | `docker compose exec backend id` → `uid=1000(node)` |
| 18 | Sin límites de recursos, sin rotación de logs y sin healthchecks en frontend y backend | Medio — un contenedor podía consumir toda la RAM de la instancia, y los logs sin rotar podían llenar el disco de 20 GiB (denegación de servicio por agotamiento) | Límites de CPU y memoria por servicio (320M/256M/128M), `json-file` con `max-size: 10m` y `max-file: 3`, y healthcheck en los tres contenedores | `docker compose ps` muestra los tres como `healthy` |
| 19 | SSH con el puerto 22 abierto a 0.0.0.0/0 y configuración por defecto; `.env` con permisos amplios | Alto — superficie de fuerza bruta abierta a todo internet | `PasswordAuthentication no`, `PermitRootLogin no`, `MaxAuthTries 3`, `AllowUsers ubuntu`; fail2ban endurecido (3 intentos, baneo de 1 h); `unattended-upgrades` activo; `chmod 600` en `.env`; puerto 443 añadido a UFW | `sshd -t` correcto, `fail2ban-client status sshd` activo, `unattended-upgrades` habilitado |

### 5.5 Hallazgos aceptados y justificados

- **Dependencia de Google Fonts.** El SPA carga tipografías desde `fonts.googleapis.com`, lo que revela la IP del visitante a un tercero. Es un asunto de privacidad, no una vulnerabilidad explotable: se mantiene por coherencia visual con la entrega y se declara de forma **explícita** en la CSP (`style-src` y `font-src` acotados a esos dos dominios), de modo que ningún otro origen externo puede cargar recursos. La remediación completa sería autoalojar las fuentes.
- **Puerto 22 accesible desde cualquier IP.** Lo exige el pipeline, porque los runners de GitHub Actions no tienen IP fija. Se mitiga con autenticación exclusivamente por llave, fail2ban y la restricción `AllowUsers`. La alternativa ideal sería un runner autoalojado o AWS Systems Manager, que evitarían exponer SSH.

### 5.6 Controles de seguridad incorporados al pipeline

Para que estas correcciones no se degraden con el tiempo, el job `validate` ahora
también actúa como control de seguridad continuo:

- `npm audit --audit-level=high` falla la construcción si aparece una vulnerabilidad
  alta o crítica en las dependencias.
- El `Dockerfile` del frontend valida con `nginx -t` **las dos** configuraciones
  posibles (HTTP y TLS) durante el build, de modo que un error de configuración
  detiene el pipeline antes de llegar a producción, en lugar de tumbar el sitio.

### 5.7 Incidencias reales durante la corrección

Como en el resto de la bitácora, se documentan los problemas que surgieron:

1. **El pipeline falló dos veces seguidas en el job `validate`** y el despliegue no se
   aplicó (los contenedores seguían con 6 días de antigüedad). Lo confirmó el "Last
   login" del servidor, que no registraba la conexión del pipeline.
2. **Primera causa:** el Dockerfile intentaba escribir en `/etc/hosts` para que
   `nginx -t` resolviera el nombre `backend`, pero BuildKit monta ese archivo como
   solo lectura. Se resolvió de una forma que además mejora el servicio: usar el DNS
   interno de Docker (`resolver 127.0.0.11`) con el upstream en una variable, así
   Nginx ya no fija la IP del backend al arrancar y sobrevive a un cambio de IP del
   contenedor.
3. **Segunda causa:** `nginx: [emerg] "keepalive_timeout" directive is duplicate`. La
   imagen oficial ya declara esa directiva en el contexto `http`, y nginx aborta ante
   un duplicado. Se movió al contexto `server`.
4. **Aprendizaje sobre `add_header`:** en Nginx, un `add_header` dentro de un `location`
   **reemplaza** todos los heredados del bloque `server`. El HSTS, declarado
   inicialmente a nivel de `server`, habría desaparecido de todas las respuestas
   reales. Se detectó revisando la configuración antes de desplegar y se movió al
   mismo snippet que el resto de cabeceras.
5. **Orden de despliegue seguro:** el certificado no puede emitirse si Nginx no sirve
   el puerto 80, pero Nginx no arranca si su configuración apunta a un certificado que
   aún no existe. Se resolvió con un script de entrypoint que detecta si el
   certificado está presente y sirve la configuración HTTP o TLS según corresponda,
   de modo que el sitio nunca queda caído. Antes de pedir el certificado a Let's
   Encrypt (que limita los intentos) se validó el circuito ACME con un archivo de
   prueba.

### 5.8 Verificación independiente posterior

Terminadas las correcciones se repitió el escaneo externo con Cloudflare URL Scanner,
esta vez sobre la URL HTTPS, para comprobar los resultados con una herramienta ajena
al propio despliegue. El informe confirmó:

- **`securityState: secure`** en todas las peticiones, con **TLS 1.3** y cifrado
  **AES-256-GCM**, y certificado emitido para `3-144-146-133.nip.io`.
- Las **once cabeceras de seguridad** presentes en *todos* los recursos (HTML, CSS, JS,
  API y favicon), no solo en la página principal.
- `Server: nginx` sin número de versión, `Cache-Control: no-store` en la API y las
  cabeceras `RateLimit: limit=120, remaining=119, reset=60` confirmando el limitador.
- Sin veredictos maliciosos ni categorías de riesgo.

El re-escaneo detectó además dos residuos que no aparecían en la primera pasada y que
también se corrigieron:

| # | Hallazgo | Riesgo | Corrección aplicada | Verificación |
|---|---|---|---|---|
| 20 | Cabeceras duplicadas y contradictorias en las respuestas de `/api/`: `X-Frame-Options: SAMEORIGIN, DENY` y dos valores distintos de HSTS y `Referrer-Policy` | Bajo/Medio — helmet (backend) y Nginx (borde) emitían las mismas cabeceras y el proxy las concatenaba. Ante valores contradictorios el navegador puede **descartar la cabecera completa**, anulando la protección | `proxy_hide_header` para las ocho cabeceras que ambos emiten, de modo que Nginx queda como única fuente en el borde. Se mantiene helmet en el backend como defensa en profundidad por si la API llegara a exponerse de forma directa | Nueva respuesta de `/api/` con un único valor por cabecera |
| 21 | `/favicon.ico` devolvía el `index.html` con `Content-Type: text/html` y código 200, por el fallback del SPA | Bajo — sirve HTML donde el navegador espera una imagen (confusión de tipo de contenido, ya mitigada por `nosniff`) | `location = /favicon.ico` responde 204 sin registrar el acceso | La ruta ya no devuelve HTML |

Este ciclo —escaneo, corrección, re-escaneo y corrección de residuos— es el que
corresponde a una auditoría real: la verificación con una herramienta independiente
encontró detalles que la revisión manual había dejado pasar.

---

## 6. Conclusión

La infraestructura desplegada cumple los cuatro requisitos técnicos del enunciado: un VPS real
(AWS EC2 t3.micro con Ubuntu 24.04, IP pública 3.144.146.133), un stack completo de tres capas con
base de datos relacional (Nginx + Node.js/Express + PostgreSQL 16, orquestado con Docker Compose
sobre una red interna privada), un pipeline de CI/CD que valida y despliega automáticamente por SSH
en cada push a `main` (verificado con un despliegue real de extremo a extremo), y un plan de
mantenimiento con firewall en dos capas (Security Group + UFW), fail2ban y respaldos diarios
automatizados de la base de datos.

Además, el servicio se sometió a una auditoría de seguridad posterior a la puesta en producción
(sección 5) que combinó un escaneo externo con una revisión manual del código. Se identificaron y
corrigieron 19 hallazgos, entre ellos tres de riesgo alto: la ausencia de cifrado en tránsito
—resuelta con HTTPS y certificado de Let's Encrypt—, un XSS real en el filtro del frontend y una
política CORS abierta a cualquier origen. El endurecimiento alcanzó las cuatro capas del sistema:
transporte, aplicación, contenedores y sistema operativo. Los controles se incorporaron al propio
pipeline (auditoría de dependencias y validación de la configuración de Nginx en cada build) para
que las correcciones no se degraden con el tiempo. Todo el proceso quedó documentado como bitácora
real, incluyendo los problemas encontrados y su resolución.

## 7. Anexos

- Anexo 1: Instancia EC2 `data-center-vps` en ejecución en la consola de AWS (IP 3.144.146.133).
- Anexo 2: Reglas de entrada del Security Group `data-center-sg` (SSH 22 y HTTP 80).
- Anexo 3: Pestaña Actions de GitHub — run #2 en verde (`validate` 16s + `deploy` 24s) tras el push de prueba; run #1 en rojo (push inicial, antes de existir el VPS).
- Anexo 4: `docker compose ps` en el VPS mostrando los 3 contenedores (db healthy, backend y frontend up).
- Anexo 5: La aplicación funcionando en el navegador vía `https://3-144-146-133.nip.io` (CRUD sobre PostgreSQL, con certificado válido).
- Anexo 6: Cabeceras de seguridad y certificado TLS verificados con `curl -I` tras la auditoría.
- Anexo 7: Prueba del XSS corregido — el payload `<img src=x onerror=alert(1)>` escrito en el filtro se muestra como texto literal, sin ejecutarse.
