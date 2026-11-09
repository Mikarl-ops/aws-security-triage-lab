FROM node:24-alpine

RUN apk upgrade --no-cache

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm /usr/local/bin/npm /usr/local/bin/npx

COPY frontend/ ./
RUN chown -R node:node /app

USER node

EXPOSE 5173
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
