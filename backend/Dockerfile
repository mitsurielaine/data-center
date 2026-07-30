FROM node:20-alpine

# Parches de seguridad del sistema base de la imagen.
RUN apk upgrade --no-cache

WORKDIR /app

# npm ci instala exactamente lo fijado en package-lock.json (build reproducible).
# --ignore-scripts evita que se ejecuten scripts postinstall de dependencias,
# que son un vector conocido de ataques de cadena de suministro.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src

# El proceso NO corre como root: se usa el usuario "node" (uid 1000) que ya
# trae la imagen oficial. Si alguien logra ejecutar código en el contenedor,
# no tiene privilegios administrativos dentro de él.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
