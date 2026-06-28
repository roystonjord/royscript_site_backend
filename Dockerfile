FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# Application source.
COPY src ./src

# Run as the built-in non-root user.
USER node

EXPOSE 3000

# Container-level health: hits the app's /health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
