# PhotoManager

> Self-hosted Google Photos-ersättare. Kör lokalt i Docker/Unraid — dina bilder stannar hemma.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector%20%2B%20PostGIS-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)

---

## Innehåll

- [Funktioner](#funktioner)
- [Stack & arkitektur](#stack--arkitektur)
- [Databas](#databas)
- [Kom igång](#kom-igång)
- [Miljövariabler](#miljövariabler)
- [API-översikt](#api-översikt)
- [Projektstruktur](#projektstruktur)
- [Licens](#licens)

---

## Funktioner

### Bibliotek & indexering
- Automatisk bevakning av mediamappar med **chokidar** — nya filer indexeras i realtid
- Stöd för **JPEG, PNG, WebP, HEIC, GIF** och videofiler (MP4, MOV, MKV m.fl.)
- Extraktion av all **EXIF/IPTC/XMP**-metadata: datum, GPS-koordinater, kamera, objektiv, taggar
- **SHA-256**-hashning för automatisk dubblettdetektering
- Stöd för **nätverksmappar (SMB/CIFS)** som bevakade källmappar
- Administratörsgränssnitt för att lägga till och hantera bevakade mappar

### Bilder
- Genererar **WebP-thumbnails** i två storlekar (400 px + 1 200 px) via Sharp
- Automatisk **HEIC → WebP**-konvertering vid indexering
- Korrekt hantering av **EXIF-rotation**
- **Stjärnbetyg** (1–5) — sätts via högerklick eller kortkommando, visas direkt på thumbnail
- **Flaggning** — Flaggad 🚩 / Avvisad ✗ / Ingen — via högerklick eller kortkommando
- **Färgetiketter** — 5 färger (röd/gul/grön/blå/lila) visas som border runt thumbnail
- **Konfigurerbar thumbnail-overlay** — välj fritt vad som visas: betyg, flagga, färgkant, filnamn, storlek, datum, dimensioner
- Inställningarna synkroniseras mellan Bilder, Album och Favoriter-vyerna

### Video
- **FFmpeg**-transkodning: HEVC/MOV → H.264 MP4 för sömlös webbuppspelning
- **HTTP range-requests** — sökning i videon fungerar direkt i webbläsaren

### Sökning & filtrering
- **Full-text + fuzzy-sökning** på filnamn, plats och taggar via PostgreSQL `pg_trgm`
- Avancerade filter: datumintervall, plats, album, person, filtyp och favoriter
- **Tagghantering** med normaliserade taggar och autocomplete

### Utforska
- **Tidslinje** grupperad per dag, månad och år med cursor-paginering
- **Händelser** — auto-grupperade resor och tillfällen utifrån datum och plats
- **"Den här dagen"** — visar bilder från samma datum tidigare år
- **Resor med GPS-spår** — automatisk ruttvisualisering från geo-taggade bilder (≥ 2 dagar)
- **Platsklustring** — bilder grupperade per geografiskt område
- **Smarta samlingar** baserade på innehåll och metadata

### Karta
- Interaktiv karta (**Leaflet.js**) med **PostGIS-baserad klustring** som anpassas efter zoomnivå
- Klicka på ett kluster för att zooma in och se bilderna
- Automatisk beräkning av kartutbredning för alla geo-taggade bilder

### Ansikten & AI
- **Ansiktsdetektering** med ONNX Runtime — SCRFD_500M-modellen körs i `worker_threads`
- **ArcFace**-embeddings (512 dimensioner) lagras i PostgreSQL via **pgvector**
- `ivfflat`-index skapas automatiskt när ~1 000 ansikten indexerats
- **AI-förslag** på personnamn med accept/avvisa per ansikte eller i batch
- Separat **Python Flask-tjänst** (InsightFace `buffalo_l`) som alternativ AI-backend
- Manuell hantering: skapa, namnge, slå ihop och ta bort personer
- Spara **födelseår och dödsår** på personer
- **Personrelationer** — koppla ihop personer med varandra
- **Borttagna förslag** (dismissed) — skippa ansikten du inte vill kategorisera
- Graceful degradation — appen startar utan AI-modeller om de saknas

### Album & delning
- Manuella och smarta **album** med valfri sorteringsordning
- **Favoriter** — markera och filtrera dina bästa bilder
- **Intern delning** med specifika användare
- **Publika delningslänkar** med valfri giltighetstid och max antal visningar
- Vy för inkommande och utgående delningar
- Offentliga bilder/album tillgängliga utan inloggning via unik token

### Export & backup
- Ladda ner **ZIP-arkiv** med originalfiler och **XMP-sidecar**-filer per bild
- Export körs asynkront via jobbkön och är nedladdningsbar när den är klar

### Admin & säkerhet
- **Användarhantering**: skapa, redigera, aktivera och inaktivera konton
- **RBAC** med tre roller (`admin` / `user` / `guest`) och granulära rättigheter per användare
- **Audit-log** med CSV-export — spårar login, borttagning, delning och nedladdning
- **Jobbkö** via BullMQ + Redis — övervaka status och starta om misslyckade jobb
- **Dubblettrapport** baserat på SHA-256
- **Systemstatistik**: antal assets, lagringsutrymme och jobbstatus
- Rate-limiting, httpOnly JWT-refresh-cookie och bcrypt-lösenordshashning

### PWA
- **Installerbar** på mobil och desktop via webbläsaren
- Service Worker för offline-stöd
- **Web Push-notifikationer** vid ny indexering och andra händelser

---

## Stack & arkitektur

| Lager | Teknik |
|-------|--------|
| **API-server** | Node.js 20 + Fastify 4.28 |
| **Databas** | PostgreSQL 16 med pgvector, PostGIS och pg_trgm |
| **Cache & köer** | Redis 7 + BullMQ 5.8 |
| **AI (Node)** | ONNX Runtime 1.18 — ArcFace/SCRFD i worker_threads |
| **AI (Python)** | InsightFace 0.7.3 + Flask — separat Docker-tjänst |
| **Frontend** | PWA — HTML5 + Tailwind CSS v4 + Vanilla JavaScript (ingen byggsteg i dev) |
| **Bildhantering** | Sharp 0.33 (thumbnails, HEIC-konvertering) |
| **Videohantering** | FFmpeg (H.264-transkodning, range-requests) |
| **Metadata** | exifr + exiftool (EXIF/IPTC/XMP) |
| **Geo** | PostGIS (klustring, avstånd) + reverse geocoding |
| **Realtid** | Server-Sent Events (SSE) för live-uppdateringar |
| **Processhantering** | PM2 (kör Node + Python parallellt i produktion) |
| **Containers** | Docker + Docker Compose |

### Bakgrundsarbetare

| Worker | Uppgift |
|--------|---------|
| `fileWatcher.js` | Bevakar mediamappar via chokidar, köar nya filer |
| `indexer.js` | Extraherar metadata, reverse-geocodar GPS, detekterar dubbletter |
| `thumbnailer.js` | Genererar 400 px + 1 200 px WebP-thumbnails |
| `transcoder.js` | Transkoderar video till H.264 MP4 med FFmpeg |
| `aiEmbedder.js` | Kör ansiktsdetektering och skapar 512-dim embeddings |
| `trashCleaner.js` | Cron-jobb som permanent raderar filer efter N dagar i papperskorgen |
| `jobRunner.js` | BullMQ-konsument som koordinerar alla asynkrona jobb |

### Autentisering & säkerhet

- JWT **access token** (15 min) i Authorization-header
- JWT **refresh token** (30 dagar) i httpOnly-cookie
- Automatisk token-förnyelse i API-klienten
- bcrypt-hashning av lösenord
- Rate-limiting på inloggningsendpointen (10 försök/min)
- Granulär RBAC — per-användarbehörigheter kan t.ex. stänga av karta, ansikten eller borttagning

---

## Kortkommandon

Gäller i **Bilder-vyn** när inget textfält är aktivt och lightboxen är stängd.

### Flaggning
| Tangent | Åtgärd |
|---------|--------|
| `P` | Flagga bild(er) som Flaggad 🚩 |
| `X` | Markera bild(er) som Avvisad ✗ |
| `U` | Ta bort flagga |

### Betyg
| Tangent | Åtgärd |
|---------|--------|
| `1` – `5` | Sätt stjärnbetyg 1–5 ⭐ |

### Färgetikett
| Tangent | Färg |
|---------|------|
| `6` | Röd |
| `7` | Gul |
| `8` | Grön |
| `9` | Blå |
| `0` | Ta bort färg |

> Kortkommandona appliceras på **alla markerade bilder** (Ctrl+klik / Shift+klik). Om ingen bild är markerad appliceras de på den fokuserade bilden.

### Mappar-vyn
| Tangent | Åtgärd |
|---------|--------|
| `↑` / `↓` | Navigera bland filer/mappar |
| `→` | Öppna markerad mapp / gå till filruta |
| `←` | Fokus till mappträdet |
| `Backspace` | Gå upp en nivå |
| `F2` | Byt namn (öppnar dialog) |
| `Enter` | Öppna mapp eller bild |
| `Delete` | Radera till papperskorg |
| `G` | Växla till gridvy |
| `L` | Växla till listvy |
| `Ctrl+A` | Markera alla |
| `Ctrl+X` / `C` / `V` | Klipp ut / Kopiera / Klistra in |

---

## Databas

PostgreSQL 16 med följande extensions:

| Extension | Syfte |
|-----------|-------|
| `uuid-ossp` | UUID-generering |
| `pgcrypto` | Kryptofunktioner |
| `postgis` | Geo-förfrågningar och klustring |
| `vector` (pgvector) | 512-dim ansiktsembeddings och similaritetssökning |
| `pg_trgm` | Trigram-baserad fuzzy-textsökning |

### Tabeller (14 migrationer)

| Tabell | Beskrivning |
|--------|-------------|
| `users` | Konton med roller och inloggningshistorik |
| `user_permissions` | Granulära rättigheter per användare |
| `user_settings` | JSONB-inställningar (t.ex. face detection-tröskel) |
| `assets` | Alla foton och videor — metadata, sökvägar, status, rating |
| `asset_metadata` | Rådata från EXIF/IPTC/XMP per asset |
| `asset_tags` | Koppling asset ↔ tag |
| `tags` | Normaliserade taggar (lowercase) |
| `faces` | Detekterade ansikten med ONNX-embedding (VECTOR 512) |
| `persons` | Namngivna identiteter med födelseår, dödsår och relationer |
| `ai_suggestions` | AI-förslag (face_id → person_id) med confidence-score |
| `albums` | Manuella och smarta samlingar |
| `album_assets` | Koppling album ↔ asset med sorteringsordning |
| `favorites` | Användarens favoritmarkerade bilder |
| `events` | Auto-grupperade händelser/resor |
| `event_assets` | Koppling event ↔ asset |
| `shares` | Intern och publik delning med token, giltighetstid och max-visningar |
| `jobs` | Asynkrona jobb (thumbnail, transcode, index, ai_embed, zip_export) |
| `audit_log` | Komplett logg över alla användarhandlingar |
| `watched_folders` | Bevakade mappar inkl. SMB/CIFS-konfiguration |
| `push_subscriptions` | Web Push-prenumerationer per användare |

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

Öppna `http://localhost:3000` i webbläsaren. Migrationer och admin-konto skapas automatiskt vid första start.

### Utvecklingsläge

```bash
docker compose -f docker-compose.dev.yml up
```

Kör backend med `--watch` för automatisk omstart vid filändringar. Startar även InsightFace som separat tjänst på port 5000.

### AI-modeller (valfritt)

Lägg ONNX-modellerna i mappen du konfigurerade under `AI_DETECTOR_PATH` och `AI_RECOGNIZER_PATH`:

- Detektor: `SCRFD_500M_bnkps_shape640x640.onnx`
- Igenkänning: `w600k_r50.onnx`

Appen startar och fungerar fullt ut utan modellerna — AI-funktionen är helt inaktiverad tills modellerna finns på plats.

---

## Miljövariabler

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

DATABASE_URL=postgresql://pm:secret@postgres:5432/photomanager
REDIS_URL=redis://redis:6379

JWT_SECRET=<lång-slumpmässig-sträng>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

MEDIA_PHOTOS_PATH=/media/photos
MEDIA_THUMBS_PATH=/media/thumbs
MEDIA_TRANSCODE_PATH=/media/transcode

VAPID_PUBLIC_KEY=<web-push-nyckel>
VAPID_PRIVATE_KEY=<web-push-nyckel>
VAPID_EMAIL=admin@example.com

TRASH_AUTO_CLEAN_DAYS=30

AI_DETECTOR_PATH=/models/SCRFD_500M_bnkps_shape640x640.onnx
AI_RECOGNIZER_PATH=/models/w600k_r50.onnx
```

---

## API-översikt

Alla endpoints under `/api/` kräver JWT i `Authorization: Bearer <token>`-headern, utom publika delningslänkar och `/api/auth/*`.

| Grupp | Prefix | Exempel |
|-------|--------|---------|
| Autentisering | `/api/auth` | `POST /login`, `POST /refresh`, `GET /me` |
| Assets | `/api/assets` | Lista, metadata, trash, restore, permanent delete |
| Sökning | `/api/search` | Full-text + filter, tagg-autocomplete |
| Utforska | `/api/explore` | Händelser, resor, "den här dagen", GPS-spår |
| Karta | `/api/map` | Geo-kluster, kartutbredning, bilder i radius |
| Persons | `/api/persons` | CRUD, dubbletter, ansiktsförslag |
| AI | `/api/ai` | Status, förslag, accept/avvisa, träna om kluster |
| Album | `/api/albums` | CRUD, lägg till/ta bort assets |
| Delning | `/api/shares` | Inkommande, utgående, publika länkar |
| Export | `/api/export` | Starta ZIP-export, ladda ner färdigt arkiv |
| Admin | `/api/admin` | Användare, jobb, dubbletter, systemstatistik |
| Stream | `/api/stream` | Foton och videor med range-request-stöd |
| Push | `/api/push` | Registrera Web Push-prenumeration |
| Inställningar | `/api/settings` | Användarinställningar (JSONB) |
| Hälsa | `/api/health` | Healthcheck |

---

## Projektstruktur

```
PhotoManager/
├── backend/
│   ├── src/
│   │   ├── server.js                  # Fastify-applikation och startpunkt
│   │   ├── config.js                  # Miljökonfiguration
│   │   ├── db/
│   │   │   ├── migrations/            # 14 SQL-migrationer (001–014)
│   │   │   ├── migrate.js             # Migrationskörare
│   │   │   └── pool.js                # PostgreSQL-anslutningspool
│   │   ├── plugins/                   # Fastify-plugins (auth, cors, rate-limit, static)
│   │   ├── routes/                    # 18 routfiler (assets, albums, persons, search …)
│   │   ├── services/                  # Affärslogik (AI, geo, metadata, jobb, SSE, XMP)
│   │   └── workers/                   # Bakgrundsprocesser (se tabell ovan)
│   ├── models/                        # ONNX-modellcache
│   ├── insightface_server.py          # Python Flask AI-backend
│   ├── pm2.config.js                  # PM2 multi-process-konfiguration
│   ├── Dockerfile                     # Produktionsbild (Node + Python + FFmpeg)
│   ├── Dockerfile.dev                 # Utvecklingsbild med watch-läge
│   ├── Dockerfile.insightface         # Separat Python-tjänst
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── index.html                 # SPA-skal
│   │   ├── app.js                     # Ingångspunkt
│   │   ├── manifest.json              # PWA-manifest
│   │   └── sw.js                      # Service Worker
│   └── src/
│       ├── api.js                     # API-klient med JWT auto-refresh
│       ├── state.js                   # Global tillståndshantering
│       ├── components/                # lightbox, gridCell, nav, selectionManager
│       └── views/                     # timeline, albums, mapview, persons,
│                                      # explore, admin, folders, sharing, upload
├── postgres/
│   └── Dockerfile                     # PostgreSQL 16 + pgvector + PostGIS
├── docker-compose.yml                 # Produktion
└── docker-compose.dev.yml             # Utveckling (inkl. InsightFace-tjänst)
```

---

## Licens

Privat projekt.
