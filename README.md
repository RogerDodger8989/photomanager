# PhotoManager

> Self-hosted Google Photos-ersättare. Kör lokalt i Docker/Unraid — dina bilder stannar hemma.

![Node.js](https://img.shields.io/badge/Node.js-20+-green) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector%20%2B%20PostGIS-blue) ![Docker](https://img.shields.io/badge/Docker-ready-blue)

---

## Funktioner

### Implementerat

| Funktion | Beskrivning |
|----------|-------------|
| **Automatisk indexering** | Bevakar `/media/photos/` med chokidar — nya filer indexeras direkt |
| **EXIF/XMP/IPTC** | Läser all metadata: datum, GPS, kamera, objektiv, taggar |
| **Thumbnails** | Genererar WebP-thumbnails (400px + 1200px) via Sharp |
| **HEIC-stöd** | Konverterar Apple HEIC till WebP automatiskt |
| **Video-transkodning** | FFmpeg konverterar HEVC/MOV → H.264 MP4 för webbuppspelning |
| **Video-streaming** | Range-requests med stöd för seek |
| **Karta** | Visar bilder på karta med PostGIS-klustring (Leaflet.js) |
| **Ansikten** | Ansiktsdetektering med ArcFace (ONNX Runtime) + pgvector-sökning |
| **Sökning** | Full-text + fuzzy-sökning på filnamn, plats och taggar (pg_trgm) |
| **Explore** | Auto-grupperade händelser från tidslinje |
| **Album** | Manuella och smarta album med sorteringsordning |
| **Favoriter** | Markera bilder som favoriter |
| **Delning** | Intern delning + publika länkar med valfri giltighetstid och max-visningar |
| **Uppladdning** | Direkt uppladdning via webbgränssnittet (multipart) |
| **Papperskorg** | Mjuk-radering med automatisk rensning via cron |
| **Export** | Ladda ner ZIP med original + XMP-sidecar |
| **Push-notiser** | Web Push-notifikationer (t.ex. vid ny indexering) |
| **Jobbkö** | BullMQ + Redis — thumbnailing, transkodning, AI och export körs asynkront |
| **Admin** | Hantera användare, bevakade mappar, jobbstatus och audit-log |
| **RBAC** | Rollbaserad åtkomstkontroll (admin / user / guest) med granulära rättigheter |
| **PWA** | Installerbar webapp med Service Worker och offline-stöd |
| **Auth** | JWT-sessioner med bcrypt, rate-limiting och httpOnly-cookies |

### Planerat / under arbete

| Funktion | Status |
|----------|--------|
| Komplett PWA-frontend | Pågår |
| Ansiktsigenkänning (clustering + namngivning) | Pågår |
| Audit-log UI i admin | Planerat |
| Säkerhetsgranskning inför release | Planerat |

---

## Stack

| Lager | Teknik |
|-------|--------|
| API | Node.js 20 + Fastify |
| Databas | PostgreSQL med pgvector + PostGIS + pg_trgm |
| Cache / Köer | Redis + BullMQ |
| AI | ONNX Runtime (ArcFace 512-dim, worker_threads) |
| Frontend | PWA — HTML + Tailwind CSS v4 + Vanilla JS |
| Media | Sharp (bilder) + FFmpeg (video) |
| Containers | Docker / Unraid |

---

## Kom igång

### Förutsättningar

- Docker + Docker Compose
- (Unraid) Skapa dessa paths innan start:

```
/mnt/user/photos          ← dina originalfiler
/mnt/user/thumbs          ← thumbnails (skapas automatiskt)
/mnt/user/transcode       ← transkodade videor (skapas automatiskt)
/mnt/user/appdata/photomanager/models  ← ONNX-modeller
```

### 1. Klona och konfigurera

```bash
git clone <repo-url>
cd PhotoManager
cp backend/.env.example backend/.env
# Redigera backend/.env med dina egna värden
```

### 2. Starta

```bash
docker compose up -d
```

Öppna `http://localhost:3000` i webbläsaren.

### 3. Kör migrationer

```bash
docker compose exec photomanager npm run migrate
```

Skapar alla tabeller och en admin-användare (se `.env` för lösenord).

### Utvecklingsläge

```bash
docker compose -f docker-compose.dev.yml up
```

Använder `--watch` för hot-reload av backend.

---

## Projektstruktur

```
PhotoManager/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   └── migrations/     # SQL-migrationer
│   │   ├── plugins/            # Fastify-plugins (auth, cors, rate-limit)
│   │   ├── routes/             # API-endpoints
│   │   ├── services/           # Affärslogik
│   │   ├── workers/            # Bakgrundsprocesser (watcher, thumbnailer, transcoder, AI)
│   │   └── server.js
│   └── package.json
├── frontend/
│   ├── public/                 # Statiska filer & PWA-manifest
│   └── src/
│       ├── views/              # Vyer (timeline, albums, map, persons, …)
│       └── components/         # Komponenter (lightbox, nav)
├── postgres/
│   └── Dockerfile              # PostgreSQL med pgvector + PostGIS
└── docker-compose.yml
```

---

## Volymer

| Host-sökväg | Container-sökväg | Syfte |
|-------------|------------------|-------|
| `/mnt/user/photos` | `/media/photos` | Originalfiler (skrivskyddad rekommenderas) |
| `/mnt/user/thumbs` | `/media/thumbs` | Genererade thumbnails |
| `/mnt/user/transcode` | `/media/transcode` | Transkodade videor |
| `/mnt/user/appdata/photomanager/models` | `/models` | ONNX-modeller för AI |

---

## Miljövariabler

Se [backend/.env.example](backend/.env.example) för samtliga variabler.

---

## Licens

Privat projekt.
