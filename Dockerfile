# ---- 1. Build the React dashboard ----
FROM node:22-slim AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

# ---- 2. Python runtime ----
FROM python:3.11-slim

# FFmpeg with libass (captions), fontconfig fonts for caption fallback, espeak-free
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libass-dev \
    fonts-dejavu-core \
    nodejs \
    fontconfig \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + the built dashboard (served by the Python web server)
COPY . .
COPY --from=frontend /web/dist ./frontend/dist

# Expose Web UI port
EXPOSE 8080

CMD ["python", "main.py"]
