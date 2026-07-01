FROM node:20-bookworm-slim AS base

# --- System-beroenden ---
# libgl1 + libglib2.0-0 krävs av OpenCV (cv2)
# libopenblas-dev + liblapack-dev krävs av InsightFace/numpy
# vips-dev krävs av sharp (Node.js bildbibliotek)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    cmake \
    build-essential \
    libopenblas-dev \
    liblapack-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    ffmpeg \
    libvips-dev \
    exiftool \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://rclone.org/install.sh | bash

WORKDIR /app

# --- Python virtualenv + InsightFace ---
# Isolerat från systemets Python för reproducerbarhet
RUN python3 -m venv /app/venv

RUN /app/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /app/venv/bin/pip install --no-cache-dir \
        flask==3.0.3 \
        insightface==0.7.3 \
        onnxruntime==1.18.0 \
        opencv-python-headless==4.10.0.84 \
        numpy

# --- Node.js beroenden ---
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# PM2 som global processhanterare (håller både Node och Python uppe)
RUN npm install -g pm2

# --- Källkod ---
COPY src/ ./src/
COPY pm2.config.js ./
COPY insightface_server.py ./

# /app/models mappas som Docker Volume i produktion.
# InsightFace laddar ner buffalo_l (~300 MB) hit vid första start
# och återanvänder dem vid efterföljande container-starter.
RUN mkdir -p /app/models /media/photos /media/thumbs /media/transcode

# Port 3000 = Fastify (extern), 5000 = InsightFace Flask (intern, localhost only)
EXPOSE 3000

CMD ["pm2-runtime", "pm2.config.js"]