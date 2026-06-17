FROM node:20-alpine AS base

# FFmpeg + libvips (krävs av sharp och fluent-ffmpeg)
RUN apk add --no-cache ffmpeg vips-dev python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

# Skapa media-mappar och modell-mapp (overridas av volumes i produktion)
RUN mkdir -p /media/photos /media/thumbs /media/transcode /models

EXPOSE 3000

CMD ["node", "src/server.js"]
