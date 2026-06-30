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
- [Roadmap](#roadmap)
- [Licens](#licens)

---

## Funktioner

### Bibliotek & indexering
- Automatisk bevakning av mediamappar med **chokidar** — nya filer indexeras i realtid
- Stöd för **JPEG, PNG, WebP, HEIC, GIF, RAW** (CR2, NEF, ARW, DNG m.fl.) och videofiler (MP4, MOV, MKV m.fl.)
- Extraktion av all **EXIF/IPTC/XMP**-metadata: datum, GPS-koordinater, kamera, objektiv, taggar
- **SHA-256**-hashning för automatisk exakt dubblettdetektering
- **Perceptuell hash (dHash)** — hittar nästan-identiska bilder med Hamming-distans ≤ 10 bitar
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
- **Staplar (Stacks)** — gruppera burst-bilder och varianter, en "cover"-bild visas i grid
- **Motion Photos** (Google Pixel) — identifieras automatiskt vid indexering, kort videoklipp extraheras

### Video
- **FFmpeg**-transkodning: HEVC/MOV → H.264 MP4 för sömlös webbuppspelning
- **HTTP range-requests** — sökning i videon fungerar direkt i webbläsaren

### Sökning & filtrering
- **Full-text + fuzzy-sökning** på filnamn, plats och taggar via PostgreSQL `pg_trgm`
- Avancerade filter: datumintervall, plats, album, person, filtyp och favoriter
- **Tagghantering** med normaliserade taggar, hierarkiska sökvägar och autocomplete

### Utforska
- **Tidslinje** grupperad per dag, månad och år med cursor-paginering
- **Händelser** — auto-grupperade resor och tillfällen utifrån datum och plats (24h-fönster, 200 km)
- **Minnesvy "Denna dag i historien"** — visar bilder från samma datum tidigare år, grupperade per år
- **Daglig push-notis** kl 08:00 när det finns minnen för dagen
- **Resor med GPS-spår** — automatisk ruttvisualisering från geo-taggade bilder (≥ 2 dagar)
- **Platsklustring** — bilder grupperade per geografiskt område
- **Smarta samlingar** baserade på innehåll och metadata

### Lightbox & navigation
- **Touch-swipe** — svep vänster/höger för nästa/föregående bild
- **Pinch-zoom** — nyp med två fingrar för att zooma, panorera med ett finger när inzoomad
- Tangentbordsnavigering: ←/→ navigerar bilder, Esc stänger, +/- zoomar

### Kamera & statistik
- **Kamerastatistik** i admindashboarden — histograms för ISO, bländare, slutartid, brännvidd och objektiv
- Kolumnerna `iso`, `aperture`, `shutter_speed`, `focal_length_mm`, `lens_model` indexerade direkt på `assets`
- Backfill-funktion som beräknar statistik från befintliga EXIF-metadata

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
- **YOLOv8-nano motivigenkänning** — taggar automatiskt 80 COCO-klasser (hund, katt, bil, mat …) på svenska
  - Modellen (~6 MB) laddas ner via admingränssnittet
  - AI-taggar märks med ⚡ och lila färg i lightboxen
  - Backfill-knapp för att tagga befintliga foton
- Manuell hantering: skapa, namnge, slå ihop och ta bort personer
- Spara **födelseår och dödsår** på personer
- **Personrelationer** — koppla ihop personer med varandra
- **Borttagna förslag** (dismissed) — skippa ansikten du inte vill kategorisera
- Graceful degradation — appen startar utan AI-modeller om de saknas

### Album & delning
- Manuella och smarta **album** med valfri sorteringsordning
- **Regelbyggare** för smarta album med AND/OR-logik (tagg, person, datum, plats, betyg m.m.)
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
- **Jobbkö** — övervaka status för thumbnail, transcode, phash, object_detection och zip-jobb
- **Dubblettrapport** baserat på SHA-256 och perceptuell hash (nästan-identiska)
- **Kamerastatistik**: histograms för ISO, bländare, slutartid, brännvidd och objektiv
- **YOLOv8-sektionen** i admin: modellstatus, nedladdning och backfill
- **Systemstatistik**: antal assets, lagringsutrymme och jobbstatus
- Rate-limiting, httpOnly JWT-refresh-cookie och bcrypt-lösenordshashning

### PWA
- **Installerbar** på mobil och desktop via webbläsaren
- Service Worker för offline-stöd
- **Web Push-notifikationer** — ny indexering, dagliga minnesnotiser kl 08:00

---

## Stack & arkitektur

| Lager | Teknik |
|-------|--------|
| **API-server** | Node.js 20 + Fastify 4.28 |
| **Databas** | PostgreSQL 16 med pgvector, PostGIS och pg_trgm |
| **Cache & köer** | Redis 7 |
| **AI (Node)** | ONNX Runtime 1.18 — ArcFace/SCRFD/YOLOv8 i worker_threads |
| **AI (Python)** | InsightFace 0.7.3 + Flask — separat Docker-tjänst |
| **Frontend** | PWA — HTML5 + Tailwind CSS v4 + Vanilla JavaScript (ingen byggsteg i dev) |
| **Bildhantering** | Sharp 0.33 (thumbnails, HEIC-konvertering, phash, YOLO-preprocessning) |
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
| `indexer.js` | Extraherar metadata, reverse-geocodar GPS, detekterar dubbletter, köar jobb |
| `thumbnailer.js` | Genererar 400 px + 1 200 px WebP-thumbnails |
| `transcoder.js` | Transkoderar video till H.264 MP4 med FFmpeg |
| `aiEmbedder.js` | Kör ansiktsdetektering och skapar 512-dim embeddings |
| `jobRunner.js` | Polling-baserad jobbkoordinator (phash, object_detection, transcode, thumbnail) |
| `trashCleaner.js` | Cron kl 24h-intervall — permanent raderar filer efter N dagar i papperskorgen |
| `dailyPushJob.js` | Cron kl 08:00 — skickar minnespush till alla prenumeranter med foton "denna dag" |
| `motionPhotoBackfill.js` | Identifierar Motion Photos bland befintliga bilder vid uppstart |

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

### Tabeller (36 migrationer, 001–036)

| Tabell | Beskrivning |
|--------|-------------|
| `users` | Konton med roller och inloggningshistorik |
| `user_permissions` | Granulära rättigheter per användare |
| `user_settings` | JSONB-inställningar (t.ex. face detection-tröskel) |
| `assets` | Alla foton/videor — metadata, sökvägar, status, rating, iso, aperture, shutter_speed, focal_length_mm, lens_model, phash |
| `asset_metadata` | Rådata från EXIF/IPTC/XMP per asset |
| `asset_tags` | Koppling asset ↔ tag (med `source` och `confidence` för AI-taggar) |
| `tags` | Normaliserade taggar med hierarkiska sökvägar (`source`: manual/ai) |
| `stacks` | Grupper av burst-bilder och varianter |
| `stack_assets` | Koppling stack ↔ asset med cover-flagga |
| `faces` | Detekterade ansikten med ONNX-embedding (VECTOR 512) |
| `persons` | Namngivna identiteter med födelseår, dödsår och relationer |
| `ai_suggestions` | AI-förslag (face_id → person_id) med confidence-score |
| `albums` | Manuella och smarta samlingar |
| `album_assets` | Koppling album ↔ asset med sorteringsordning |
| `smart_album_rules` | Regeluppsättningar för smarta album (AND/OR-logik) |
| `favorites` | Användarens favoritmarkerade bilder |
| `events` | Auto-grupperade händelser/resor |
| `event_assets` | Koppling event ↔ asset |
| `shares` | Intern och publik delning med token, giltighetstid och max-visningar |
| `jobs` | Asynkrona jobb (thumbnail, transcode, phash, object_detection, zip_export) |
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

### AI-modeller

#### Ansiktsigenkänning (valfritt)
Lägg ONNX-modellerna i mappen du konfigurerade under `AI_DETECTOR_PATH` och `AI_RECOGNIZER_PATH`:

- Detektor: `SCRFD_500M_bnkps_shape640x640.onnx`
- Igenkänning: `w600k_r50.onnx`

#### Motivigenkänning YOLOv8 (valfritt)
Ladda ner direkt från admingränssnittet (Admin → Jobb → YOLOv8 AI-taggning → Ladda ner modell), eller manuellt:

```bash
# Lägg modellen i MODELS_PATH (standard: ./models/)
wget -O models/yolov8n.onnx \
  https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
```

Appen startar och fungerar fullt ut utan modellerna — AI-funktionerna är inaktiverade tills modellerna finns på plats.

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

# Mapp för ONNX-modeller (YOLOv8 m.fl.)
MODELS_PATH=./models

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
| Utforska | `/api/explore` | Händelser, resor, "denna dag i historien", GPS-spår |
| Karta | `/api/map` | Geo-kluster, kartutbredning, bilder i radius |
| Persons | `/api/persons` | CRUD, dubbletter, ansiktsförslag |
| AI | `/api/ai` | Status, förslag, accept/avvisa, träna om kluster |
| Album | `/api/albums` | CRUD, lägg till/ta bort assets, smarta album |
| Delning | `/api/shares` | Inkommande, utgående, publika länkar |
| Export | `/api/export` | Starta ZIP-export, ladda ner färdigt arkiv |
| Admin | `/api/admin` | Användare, jobb, dubbletter, kamerastatistik, YOLOv8-modell, backfill |
| Stream | `/api/stream` | Foton och videor med range-request-stöd |
| Push | `/api/push` | Registrera/avregistrera Web Push-prenumeration |
| Inställningar | `/api/settings` | Användarinställningar (JSONB) |
| Taggar | `/api/tags` | Tagghantering och sökvägshierarki |
| Staplar | `/api/stacks` | Skapa, hantera och expandera bildstaplar |
| Mappar | `/api/folders` | Mappträd och fillistning |
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
│   │   │   ├── migrations/            # 36 SQL-migrationer (001–036)
│   │   │   ├── runMigrations.js       # Migrationskörare
│   │   │   └── pool.js                # PostgreSQL-anslutningspool
│   │   ├── plugins/                   # Fastify-plugins (auth, cors, rate-limit, static)
│   │   ├── routes/                    # 19 routfiler (assets, albums, persons, search …)
│   │   ├── services/                  # Affärslogik (AI, geo, metadata, jobb, SSE, XMP,
│   │   │                              #   objectDetection, pHash, faceRecognition, explore)
│   │   └── workers/                   # Bakgrundsprocesser (se tabell ovan)
│   ├── models/                        # ONNX-modellcache (yolov8n.onnx m.fl.)
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

## Roadmap

Funktioner som planeras implementeras, i prioritetsordning. Bockas av när de är klara.

### Klar ✅
| # | Funktion | Beskrivning |
|---|----------|-------------|
| 1A | Perceptuell hash | dHash — nästan-identiska bilder med Hamming ≤ 10 |
| 1B | YOLOv8-nano auto-taggning | COCO-80 → svenska taggar, CPU-only, ⚡-ikon i UI |
| 2A | Touch-gester i lightbox | Swipe-navigation + pinch-zoom + touch-panorering |
| 3A | Kamerastatistik | ISO/bländare/slutartid/brännvidd/objektiv-histograms i admin |
| 3B | Minnesvy + push-notis | "Denna dag i historien" + daglig push kl 08:00 |
| 3C | Lagringsanalys | Diskutrymme per år/album/person — ny "Lagring"-flik i admin |
| 2C | Tangentbordsnavigering i gallery | ↑↓←→ i fotogrid, Enter öppnar lightbox, Space markerar, Ctrl+A markera alla |
| 2B | Decennietal/årsvy | Ny "Tidslinje"-vy (#/timeline): dekad → år → månad, klick-filtrering till bilder |
| 2D | Digital fotoram | Helskärms-slideshow på /frame.html, token-skyddad, konfig i Admin → Inställningar |

### Kvar att bygga 🔜
| # | Funktion | Beskrivning |
|---|----------|-------------|
| 2D | Digital fotoram | Helskärm slideshow-sida (frame.html) utan inloggning, konfigurerbar källa och intervall |
| 4A | Vattenstämpel vid export | Text/logga compositas med Sharp vid ZIP-export, toggle i exportdialog |
| 4B | Redigera EXIF (utökat) | Ändra datum, GPS (karta), kameramodell — skrivs tillbaka via exiftool/XMP-sidecar |
| 5A | rclone backup | Synka till Google Drive, OneDrive, S3/Backblaze via rclone — schema + logg i admin |
| 5B | Import-rapport | Sessionsbaserad logg: importerade, dubbletter, fel per körning |
| 6A | Kommentarer + reaktioner | Per-bild kommentarer och emoji-reaktioner (❤️ 😂 😮 👍) i lightboxen |
| 6B | Aktivitetsflöde | Human-läsbar vy av audit_log — "Mamma lade till 47 foton i Julafton 2025" |
| 6C | Åtkomstlogg UI | Frontend-vy för att se vem som tittade på delade album |
| 7A | Ortstaggar automatiska | Skapa hierarkiska platstaggar (Platser/Sverige/Västra Götaland/Göteborg) vid import |
| 7B | Live Photo hover-video | Visa tillhörande .mov som autoplay-video on hover i galleriet |
| 7C | Projektmappar | Album-subtyp med kapitel, rubrik + text + cover per sektion, manuell ordning |

---

## Licens

Privat projekt.
