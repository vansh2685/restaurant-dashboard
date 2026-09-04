# ---- Restaurant Analytics Dashboard ----
# Single-stage image: Express API + static frontend, no build step needed.
FROM node:20-alpine

# App lives here inside the container
WORKDIR /app

# Install dependencies first so Docker can cache this layer
# when only app/data files change (not package.json).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the application
COPY server.js ./
COPY public ./public
COPY data ./data

# Runs as the built-in non-root "node" user for a smaller attack surface
USER node

ENV PORT=3000
EXPOSE 3000

# Basic container-level health check hitting the API
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
