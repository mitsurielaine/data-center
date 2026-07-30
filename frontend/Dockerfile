FROM nginx:1.27-alpine

# Parches de seguridad del sistema base de la imagen.
RUN apk upgrade --no-cache

# Contenido estático (CSS y JS externos: la CSP no necesita 'unsafe-inline')
COPY index.html styles.css app.js /usr/share/nginx/html/

# Endurecimiento a nivel http + snippets reutilizables
COPY nginx/00-http-hardening.conf /etc/nginx/conf.d/00-http-hardening.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/app-locations.conf /etc/nginx/snippets/app-locations.conf

# Las dos configuraciones posibles del sitio; el entrypoint elige según exista
# o no certificado de Let's Encrypt.
COPY nginx/site-http.conf /etc/nginx/sites-available/site-http.conf
COPY nginx/site-tls.conf /etc/nginx/sites-available/site-tls.conf
COPY docker-entrypoint.d/40-tls-setup.sh /docker-entrypoint.d/40-tls-setup.sh

# Validación de sintaxis de AMBAS configuraciones en tiempo de build: si algo
# está mal, el pipeline falla en "docker compose build" y no en producción.
# Se usa un certificado y un host "backend" temporales solo para la validación.
RUN chmod +x /docker-entrypoint.d/40-tls-setup.sh \
 && rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/certs /etc/nginx/snippets /var/www/certbot \
 && : > /etc/nginx/snippets/hsts.conf \
 && apk add --no-cache --virtual .build-deps openssl \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout /etc/nginx/certs/privkey.pem \
      -out /etc/nginx/certs/fullchain.pem \
      -subj "/CN=build-check" 2>/dev/null \
 && cp /etc/hosts /tmp/hosts.bak && echo "127.0.0.1 backend" >> /etc/hosts \
 && cp /etc/nginx/sites-available/site-http.conf /etc/nginx/conf.d/default.conf && nginx -t \
 && cp /etc/nginx/sites-available/site-tls.conf /etc/nginx/conf.d/default.conf && nginx -t \
 && cat /tmp/hosts.bak > /etc/hosts && rm -f /tmp/hosts.bak \
 && rm -f /etc/nginx/conf.d/default.conf /etc/nginx/certs/privkey.pem /etc/nginx/certs/fullchain.pem \
 && apk del .build-deps

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
