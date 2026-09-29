# Imagen del backend de la wiki (API en Node.js, sin dependencias npm).
# Los archivos de public/ los sirve el contenedor de Caddy (ver docker-compose.yml).
FROM node:22-alpine

ENV NODE_ENV=production \
    WIKI_HOST=0.0.0.0 \
    WIKI_PORT=3000 \
    WIKI_DATA_DIR=/datos \
    WIKI_SERVIR_ESTATICOS=0 \
    WIKI_COOKIE_SECURE=1

WORKDIR /app
COPY package.json ./
COPY server ./server

# Usuario sin privilegios de la imagen (uid 1000): dueño de la carpeta de datos.
RUN mkdir -p /datos && chown node:node /datos
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/sesion || exit 1

CMD ["node", "server/server.js"]
