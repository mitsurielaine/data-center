# Guía de despliegue desde cero — AWS EC2 + Docker Compose + CI/CD

Esta guía asume que **no tienes cuenta de AWS ni dominio propio**, y que vas a ejecutar los pasos manuales
(consola de AWS, terminal SSH) en tu propia PC — idealmente con **Claude Desktop / Claude Code**, que sí tiene
acceso real a tu terminal y a internet sin restricciones, a diferencia de este chat web.

No hace falta dominio ni Cloudflare: el trabajo práctico no lo exige, así que vas a acceder por la **IP pública**
de la instancia (ej. `http://18.223.0.9`). Si más adelante quieres HTTPS gratis sin comprar un dominio, al final
hay una nota sobre usar `nip.io`.

---

## 0. Antes de empezar: crea el repositorio en GitHub

1. Entra a GitHub y crea un repositorio nuevo llamado **`data-center`** (público o privado, cualquiera sirve).
   No lo inicialices con README (ya tienes uno).
2. En tu PC, dentro de la carpeta del proyecto que te entregué:
   ```bash
   git init
   git add .
   git commit -m "Proyecto inicial: task-queue con Docker Compose"
   git branch -M main
   git remote add origin https://github.com/mitsurielaine/data-center.git
   git push -u origin main
   ```
   > GitHub ya no acepta la contraseña de tu cuenta para operaciones de `git push` ni para la API. Cuando te pida
   > credenciales, usa un **Personal Access Token (PAT)** en vez de tu contraseña:
   > GitHub → foto de perfil → **Settings** → **Developer settings** → **Personal access tokens** →
   > **Tokens (classic)** → **Generate new token** → marca el permiso `repo` → cópialo (solo se muestra una vez)
   > y pégalo cuando Git te pida la contraseña.

---

## 1. Cuenta de AWS (Free Tier)

1. Ve a **aws.amazon.com** → **Crear una cuenta de AWS**.
2. Completa el registro. Te pedirá una tarjeta (solo para verificación; con Free Tier bien configurado no se
   cobra nada si te mantienes dentro de los límites).
3. Elige el plan **"Free account plan"** (sin acceso a servicios de pago) si te lo ofrece — así evitas cargos
   accidentales.
4. **Configura una alerta de presupuesto de $0.01** para tener visibilidad total desde el primer momento:
   **Billing and Cost Management** → **Budgets** → **Create budget** → tipo *Zero spend budget* (o un budget de
   $0.01) → agrega tu correo como destinatario de la alerta.

## 2. Security Group (firewall de AWS)

1. Ve a **EC2** → **Security Groups** (menú lateral, bajo "Network & Security") → **Create security group**.
2. Nombre: `data-center-sg`.
3. **Inbound rules** (reglas de entrada):
   | Tipo | Puerto | Origen |
   |---|---|---|
   | SSH | 22 | Tu IP (elige "My IP" — más seguro que abrirlo a todo internet) |
   | HTTP | 80 | Anywhere (0.0.0.0/0) |
4. Deja las **Outbound rules** por defecto (todo permitido de salida).
5. Guarda.

> Más adelante, cuando configures el pipeline de CI/CD, vas a tener que abrir el puerto 22 a "Anywhere" porque
> los runners de GitHub Actions usan IPs dinámicas. Lo compensamos con `fail2ban` en el paso 8.

## 3. Lanzar la instancia EC2

1. **EC2** → **Launch instance**.
2. Nombre: `data-center-vps`.
3. AMI: **Ubuntu Server 24.04 LTS** (marca "Free tier eligible").
4. Tipo de instancia: **t2.micro** o **t3.micro** (ambos entran en el Free Tier: 750 horas/mes durante 12 meses).
   > A diferencia de un proyecto anterior que necesitó subir a `t3.small` por quedarse sin memoria, este stack
   > es liviano (el frontend no compila nada dentro de Docker, solo copia archivos estáticos a Nginx), así que
   > `t2.micro`/`t3.micro` debería alcanzar. Si igual ves que `docker compose up --build` se cuelga o el SSH se
   > congela, es casi siempre falta de RAM — la solución rápida está en el paso 5 (swap), y solo si eso no
   > alcanza, subes de tipo de instancia.
5. **Key pair**: crea una nueva (`data-center-key`), formato `.pem`, y descárgala. Es tu llave personal de
   administrador — no la pierdas ni la subas a ningún lado.
6. **Network settings**: selecciona el Security Group `data-center-sg` que ya creaste.
7. **Storage**: 20-30 GiB gp3 está de sobra (el Free Tier da hasta 30 GiB).
8. **Launch instance**.
9. Anota la **IP pública** que te asigna (la vas a usar todo el tiempo).

## 4. Conectarte por SSH

Desde tu terminal (en Claude Desktop, PowerShell, o Git Bash):

```bash
chmod 400 ruta/a/data-center-key.pem
ssh -i ruta/a/data-center-key.pem ubuntu@TU_IP_PUBLICA
```

Si el SSH se queda "colgado" sin conectar (pasa con algunas redes/ISP que bloquean el puerto 22 saliente), usa
**EC2 Instance Connect** desde el propio navegador como alternativa: en la consola de AWS, selecciona la
instancia → **Connect** → pestaña **EC2 Instance Connect** → **Connect**. Te abre una terminal en el navegador
sin necesitar la llave `.pem`.

## 5. Preparar el servidor

Ya conectado por SSH:

```bash
sudo apt update && sudo apt upgrade -y

# Firewall del sistema operativo (segunda capa además del Security Group)
sudo apt install -y ufw
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw --force enable

# Swap de seguridad (evita que el build se cuelgue si la RAM del free tier no alcanza)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker + Docker Compose plugin
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Cierra la sesión SSH y vuelve a conectarte para que el grupo `docker` se aplique:
```bash
exit
ssh -i ruta/a/data-center-key.pem ubuntu@TU_IP_PUBLICA
docker --version
docker compose version
```

## 6. Clonar el repositorio en el VPS

Como es un repositorio de solo lectura para el servidor, usa una **Deploy Key** (llave SSH dedicada, sin permisos
de escritura) en vez de tu usuario/contraseña de GitHub:

```bash
ssh-keygen -t ed25519 -C "deploy-key-data-center" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

Copia esa clave pública. En GitHub: repositorio `data-center` → **Settings** → **Deploy keys** → **Add deploy
key** → pega la clave (deja **sin marcar** "Allow write access", solo lectura) → **Add key**.

En el VPS, dile a Git que use esa llave para este host y clona:

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
EOF

git clone git@github.com:mitsurielaine/data-center.git ~/data-center
cd ~/data-center
```

## 7. Variables de entorno y primer despliegue manual

```bash
cp .env.example .env
nano .env     # cambia DB_PASSWORD por una contraseña real y fuerte
```

```bash
docker compose up -d --build
docker compose ps        # los 3 contenedores deben verse "healthy"/"running"
curl http://localhost/api/health
```

Desde tu navegador, abre `http://TU_IP_PUBLICA` — deberías ver el panel de tareas funcionando, con las 3 tareas
de ejemplo cargadas desde PostgreSQL. Prueba crear, marcar como completada, filtrar y eliminar una tarea para
confirmar el CRUD completo.

## 8. Endurecer el acceso SSH (fail2ban)

Como en el siguiente paso vas a tener que abrir el puerto 22 a cualquier IP (los runners de GitHub Actions no
tienen una IP fija), instala `fail2ban` para mitigar fuerza bruta:

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Con la configuración por defecto ya bloquea IPs con varios intentos fallidos de SSH en poco tiempo.

## 9. Configurar el pipeline de CI/CD (GitHub Actions)

### 9.1 Llave SSH dedicada al pipeline (distinta de tu llave personal y de la deploy key)

En tu propia PC (no en el VPS):

```bash
ssh-keygen -t ed25519 -C "github-actions-data-center" -f ./pipeline_key -N ""
```

Esto genera `pipeline_key` (privada) y `pipeline_key.pub` (pública).

### 9.2 Autorizar la llave pública en el VPS

Copia el contenido de `pipeline_key.pub` y, en el VPS:

```bash
echo "PEGA_AQUI_LA_CLAVE_PUBLICA" >> ~/.ssh/authorized_keys
```

### 9.3 Agregar los secretos en GitHub

En el repositorio: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, crea
estos cuatro:

| Nombre | Valor |
|---|---|
| `VPS_HOST` | tu IP pública, ej. `18.223.0.9` |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | el contenido completo de `pipeline_key` (la privada, no la `.pub`) |
| `VPS_PORT` | `22` |

### 9.4 Abrir el Security Group al puerto 22 (Anywhere)

Vuelve a **EC2** → **Security Groups** → `data-center-sg` → edita la regla de SSH: cambia el origen de "My IP"
a **Anywhere (0.0.0.0/0)**. Esto es necesario porque los runners de GitHub Actions cambian de IP en cada
ejecución. `fail2ban` (paso 8) es la mitigación de este riesgo.

## 10. Probar el pipeline

Haz un cambio pequeño (por ejemplo, edita el texto de `frontend/index.html`), y:

```bash
git add .
git commit -m "Probar despliegue automático"
git push origin main
```

Ve a la pestaña **Actions** del repositorio en GitHub: deberías ver el workflow ejecutándose (`validate` y luego
`deploy`), y en un par de minutos el cambio debe reflejarse en `http://TU_IP_PUBLICA` sin que hayas tocado el
VPS manualmente.

## 11. Respaldo automático de la base de datos

En el VPS:

```bash
mkdir -p ~/backups
cat > ~/backups/backup-db.sh << 'EOF'
#!/bin/bash
cd ~/data-center
set -a; source .env; set +a
TS=$(date +%F_%H%M%S)
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > ~/backups/tasksdb_$TS.sql.gz
find ~/backups -name "*.sql.gz" -mtime +7 -delete
EOF
chmod +x ~/backups/backup-db.sh

# Cron diario a las 03:00, con log
(crontab -l 2>/dev/null; echo "0 3 * * * ~/backups/backup-db.sh >> ~/backups/backup.log 2>&1") | crontab -
```

Puedes probarlo manualmente con `~/backups/backup-db.sh` y revisar que aparezca el archivo `.sql.gz` en
`~/backups`.

## 12. Qué capturar para el informe (Anexos)

Para el informe técnico, toma capturas de:
- La instancia EC2 corriendo (consola de AWS → EC2 → Instances).
- Las reglas de entrada del Security Group.
- La pestaña **Actions** de GitHub con el workflow en verde (éxito).
- `docker compose ps` en el VPS mostrando los 3 contenedores.
- La app funcionando en el navegador con `http://TU_IP_PUBLICA`.

---

## Nota opcional: HTTPS sin comprar dominio

Si quieres sumar HTTPS aunque no tengas dominio propio, puedes usar un servicio gratuito como
[nip.io](https://nip.io) o [sslip.io](https://sslip.io), que resuelven automáticamente subdominios con tu IP
incrustada (ej. `18-223-0-9.nip.io` apunta solo a `18.223.0.9`, sin que tengas que configurar ningún DNS). Con
eso podrías emitir un certificado de Let's Encrypt igual que en el proyecto de DevTask Manager. No es un
requisito de la rúbrica, así que solo vale la pena si quieres ese plus.
