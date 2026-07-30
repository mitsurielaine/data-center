#!/bin/sh
# Selecciona la configuración de Nginx según exista o no un certificado válido
# de Let's Encrypt para TLS_DOMAIN.
#
# Sin este script habría un problema de huevo y gallina: Nginx no arranca si su
# configuración referencia un certificado que aún no existe, pero certbot
# necesita que Nginx esté sirviendo el puerto 80 para emitirlo. Aquí se arranca
# siempre: primero en modo HTTP y, en cuanto el certificado aparece, en modo TLS.
set -eu

DOMAIN="${TLS_DOMAIN:-}"
LIVE_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_DIR="/etc/nginx/certs"
SNIPPETS="/etc/nginx/snippets"

mkdir -p "$CERT_DIR" "$SNIPPETS"
: > "$SNIPPETS/hsts.conf"

if [ -n "$DOMAIN" ] && [ -s "$LIVE_DIR/fullchain.pem" ] && [ -s "$LIVE_DIR/privkey.pem" ]; then
    echo "[tls-setup] Certificado de Let's Encrypt encontrado para $DOMAIN — activando HTTPS."
    ln -sf "$LIVE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
    ln -sf "$LIVE_DIR/privkey.pem"   "$CERT_DIR/privkey.pem"
    echo 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' > "$SNIPPETS/hsts.conf"
    cp /etc/nginx/sites-available/site-tls.conf /etc/nginx/conf.d/default.conf
else
    echo "[tls-setup] Sin certificado para '${DOMAIN:-(TLS_DOMAIN no definido)}' — sirviendo por HTTP hasta que se emita."
    cp /etc/nginx/sites-available/site-http.conf /etc/nginx/conf.d/default.conf
fi
