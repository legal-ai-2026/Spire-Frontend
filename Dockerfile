# C2D2 — Multi-stage Docker build
# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image (Python 3.11 + Node)
FROM python:3.11-slim
WORKDIR /app

# Install Node for running Next.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt aiohttp

# App code
COPY backend/ ./backend/
COPY server.py .

# Frontend build artifacts
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend/.next/standalone
COPY --from=frontend-builder /app/frontend/.next/static ./frontend/.next/standalone/.next/static
COPY --from=frontend-builder /app/frontend/public ./frontend/.next/standalone/public

# Local data dir
RUN mkdir -p data_local/uploads data_local/audio

EXPOSE 8080
ENV PORT=8080 DEBUG=false

CMD ["python", "server.py"]
