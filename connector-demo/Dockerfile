# SENA FLEET — conector de demostración (robots virtuales). Sin dependencias.
# Build context = la propia carpeta. Ver src/server.mjs.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 4010
CMD ["node", "src/server.mjs"]
