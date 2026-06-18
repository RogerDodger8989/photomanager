# PhotoManager

> Self-hosted Google Photos-ersättare. Kör lokalt i Docker/Unraid — dina bilder stannar hemma.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector%20%2B%20PostGIS-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)

---

## Funktioner

### Bibliotek & indexering
- Automatisk bevakning av mediamappar via **chokidar** — nya filer indexeras direkt
- Stöd för **JPEG, PNG, WebP, HEIC, GIF** och videofiler (MP4, MOV, MKV m.fl.)
- Läser all **EXIF/IPTC/XMP**-metadata: datum, GPS, kamera, objektiv, taggar
- **SHA-256**-hashning för dubblettdetektering
- Administratörsgränssnitt för att hantera och lägga till bevakade mappar

### Bilder
- Genererar **WebP-thumbnails** i två storlekar (400px + 1200px) via Sharp
- **HEIC → WebP**-konvertering automatiskt vid indexering
- Fullt stöd för **EXIF-rotation**

### Video
- **FFmpeg**-transkodning: HEVC/MOV → H.264 MP4 för sömlös webbuppspelning
- **HTTP range-requests** — seek fungerar direkt i webbläsaren

### Sökning
- **Full-text + fuzzy-sökning** på filnamn, plats och taggar (PostgreSQL pg_trgm)
- Filtrera på datum, plats, album, person, filtyp och favoriter
- Tagghantering med normaliserade taggar

### Utforska
- **Tidslinje** grupperad per dag, månad och år
- **Händelser** — auto-grupperade resor och tillfällen
- **"Den här dagen"** — bilder från samma datum tidigare år
- **Resor med GPS-spår** — automatisk rutt från geo-taggade bilder
- **Platser** — klustring av bilder per geografiskt område
- **Samlingar** — smarta grupper baserade på innehåll

### Karta
- Interaktiv karta med **PostGIS-klustring** (Leaflet.js)
- Klicka på ett kluster för att zooma in och se bilder

### Ansikten & AI
- **Ansiktsdetektering** med ONNX Runtime (ArcFace, 512-dim embeddings)
- **pgvector**-sökning för att hitta liknande ansikten
- Förslag på personnamn med accept/avvisa per ansikte eller batch
- Manuell hantering: skapa, namnge, slå ihop och ta bort personer
- Graceful degradation — startar utan AI-modeller om de saknas

### Album & delning
- Skapa manuella och smarta **album** med valfri sorteringsordning
- **Favoriter** — markera och filtrera dina bästa bilder
- **Intern delning** med specifika användare
- **Publika länkar** med valfri giltighetstid och max antal visningar
- Se inkommande och utgående delningar

### Export & backup
- Ladda ner **ZIP-arkiv** med originalfiler + XMP-sidecar per bild
- Jobb körs asynkront och är nedladdningsbara när de är klara

### Admin & säkerhet
- **Användarhantering**: skapa, redigera, aktivera/inaktivera konton
- **RBAC** med tre roller (admin / user / guest) och granulära rättigheter per användare
- **Audit-log** med CSV-export — spåra alla händelser (login, delete, share, download)
- **Jobbkö** via BullMQ + Redis — se status, starta om misslyckade jobb
- **Dubblettrapport** baserat på SHA-256
- **Systemstatistik**: antal assets, lagringsutrymme, jobbstatus
- Rate-limiting, httpOnly JWT-cookies och bcrypt lösenordshashning

### PWA
- **Installerbar** på mobil och desktop via webbläsaren
- Service Worker för offline-stöd
- **Web Push-notifikationer** vid t.ex. ny indexering

---

## Stack

| Lager | Teknik |
|-------|--------|
| API | Node.js 20 + Fastify |
| Databas | PostgreSQL med pgvector + PostGIS + pg_trgm |
| Cache / Köer | Redis + BullMQ |
| AI | ONNX Runtime (ArcFace, worker_threads) |
| Frontend | PWA — HTML + Tailwind CSS v4 + Vanilla JS |
| Media | Sharp (bilder) · FFmpeg (video) |
| Containers | Docker / Unraid |

---

## Kom igång

### Förutsättningar

- Docker + Docker Compose
- (Unraid) Skapa dessa sökvägar innan start:

| Sökväg | Syfte |
|--------|-------|
| `/mnt/user/photos` | Dina originalfiler |
| `/mnt/user/thumbs` | Thumbnails (skapas automatiskt) |
| `/mnt/user/transcode` | Transkodade videor (skapas automatiskt) |
| `/mnt/user/appdata/photomanager/models` | ONNX-modeller för AI |

### 1. Klona och konfigurera

```bash
git clone <repo-url>
cd PhotoManager
cp backend/.env.example backend/.env
# Redigera backend/.env med dina värden
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

Skapar alla tabeller och en admin-användare (lösenord definieras i `.env`).

### Utvecklingsläge

```bash
docker compose -f docker-compose.dev.yml up
```

Kör backend med `--watch` för automatisk omstart vid filändringar.

---

## Projektstruktur

```
PhotoManager/
├── backend/
│   └── src/
│       ├── db/
│       │   └── migrations/        # SQL-migrationer (schema, AI, push, folders)
│       ├── plugins/               # Fastify-plugins (auth, cors, rate-limit, static)
│       ├── routes/                # API-endpoints (assets, albums, persons, search …)
│       ├── services/              # Affärslogik (AI, geo, metadata, jobb, SSE)
│       └── workers/               # Bakgrundsprocesser
│           ├── fileWatcher.js     # Bevakar mediamappar
│           ├── indexer.js         # Indexerar nya filer
│           ├── thumbnailer.js     # Genererar thumbnails
│           ├── transcoder.js      # Transkoderar video
│           ├── aiEmbedder.js      # Skapar ansiktsembeddings
│           └── trashCleaner.js    # Rensar papperskorgen via cron
├── frontend/
│   ├── public/                    # index.html, manifest.json, service worker
│   └── src/
│       ├── views/                 # timeline, albums, map, persons, explore, admin …
│       └── components/            # lightbox, nav
├── postgres/
│   └── Dockerfile                 # PostgreSQL med pgvector + PostGIS
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## Planerat

- [ ] Komplett PWA-frontend (pågår)
- [ ] Ansiktsigenkänning med automatisk klustring
- [ ] Audit-log UI i admingränssnittet
- [ ] Säkerhetsgranskning inför release

---

## Licens

Privat projekt.
