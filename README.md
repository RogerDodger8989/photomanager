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
- [Kortkommandon](#kortkommandon)
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
- **Import-sessionsspårning** — varje importkörning loggas med antal importerade, hoppade och felaktiga filer, synlig i Admin → Import

### Bilder
- Genererar **WebP-thumbnails** i två storlekar (400 px + 1 200 px) via Sharp
- Automatisk **HEIC → WebP**-konvertering vid indexering
- Korrekt hantering av **EXIF-rotation**
- **Stjärnbetyg** (1–5) — sätts via högerklick, toolbar eller kortkommando
- **Flaggning** — Flaggad 🚩 / Avvisad ✗ / Ingen — via högerklick eller kortkommando
- **Färgetiketter** — 5 färger (röd/gul/grön/blå/lila) visas som border runt thumbnail
- **Konfigurerbar thumbnail-overlay** — välj fritt vad som visas: betyg, flagga, färgkant, filnamn, storlek, datum, dimensioner
- **Staplar (Stacks)** — gruppera burst-bilder och varianter, en "cover"-bild visas i grid
- **Motion Photos** (Google Pixel) — identifieras automatiskt, kort videoklipp extraheras

### Video
- **FFmpeg**-transkodning: HEVC/MOV → H.264 MP4 för sömlös webbuppspelning
- **HTTP range-requests** — sökning i videon fungerar direkt i webbläsaren

### Sökning & filtrering
- **Full-text + fuzzy-sökning** på filnamn, plats och taggar via PostgreSQL `pg_trgm`
- Avancerade filter: datumintervall, plats, album, person, filtyp och favoriter
- **Tagghantering** med normaliserade taggar, hierarkiska sökvägar och autocomplete

### Utforska & tidslinje
- **Tidslinje** med zoombar vy — dekad → år → månad → dag, klick-filtrering till bilder
- **Händelser** — auto-grupperade resor och tillfällen utifrån datum och plats (24h-fönster, 200 km)
- **Minnesvy "Denna dag i historien"** — foton från samma datum tidigare år, grupperade per år
- **Daglig push-notis** kl 08:00 när det finns minnen för dagen
- **Resor med GPS-spår** — automatisk ruttvisualisering från geo-taggade bilder (≥ 2 dagar)
- **Platsklustring** — bilder grupperade per geografiskt område
- **Smarta samlingar** baserade på innehåll och metadata

### Lightbox & navigation
- **Touch-swipe** — svep vänster/höger för nästa/föregående bild
- **Pinch-zoom** — nyp med två fingrar för att zooma, panorera med ett finger när inzoomad
- Tangentbordsnavigering: ←/→ navigerar bilder, Esc stänger, +/- zoomar
- **Infodrager** med metadata, taggar, person-koppningar och sociala funktioner i accordion-layout

### Social
- **Kommentarer** per bild — lägg till, visa, ta bort egna (eller all som admin)
- **Emoji-reaktioner** — ❤️ 😂 😮 👍 😢 🔥, toggle-baserade, visas med antal direkt i lightboxen
- Kommentarer och reaktioner visas i ett dedikerat accordion-avsnitt i infodrawern

### Aktivitetsflöde
- Ny navigationspost **Aktivitet** (🔔) — human-läsbar vy av alla händelser
- Visar vad som ändrades: "Dennis lade till 47 foton", "Anna redigerade metadata på foto.jpg (betyg → 5 ★)"
- Klickbara thumbnails öppnar lightboxen direkt från flödet
- Paginering via "Ladda fler"-knapp

### Kamera & statistik
- **Kamerastatistik** i admindashboarden — histograms för ISO, bländare, slutartid, brännvidd och objektiv
- Kolumnerna `iso`, `aperture`, `shutter_speed`, `focal_length_mm`, `lens_model` indexerade direkt på `assets`

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
  - Modellen (~6 MB) laddas ner direkt från admingränssnittet
  - AI-taggar märks med ⚡ och lila färg i lightboxen
  - Backfill-knapp för att tagga befintliga foton
- Manuell hantering: skapa, namnge, slå ihop och ta bort personer
- Spara **födelseår och dödsår** på personer
- **Personrelationer** — koppla ihop personer med varandra
- Graceful degradation — appen startar utan AI-modeller

### Album & delning
- Manuella och smarta **album** med valfri sorteringsordning
- **Regelbyggare** för smarta album med AND/OR-logik (tagg, person, datum, plats, betyg m.m.)
- **Favoriter** — markera och filtrera dina bästa bilder
- **Intern delning** med specifika användare
- **Publika delningslänkar** med valfri giltighetstid och max antal visningar
- Vy för inkommande och utgående delningar med **visningsräknare och tidsstämpel för senaste visning**
- `view_count` och `last_viewed_at` uppdateras automatiskt när någon öppnar en delad länk

### Export
- Ladda ner **ZIP-arkiv** med originalfiler och **XMP-sidecar**-filer
- **Vattenstämpel** — SVG-text compositas med Sharp vid export, konfigurerbart i Admin → Inställningar
- Export körs asynkront via jobbkön och är nedladdningsbar när den är klar
- Batchexport med multiselect — markera valfritt antal bilder via Ctrl+klik / Shift+klik

### Digital fotoram
- Helskärms-slideshow tillgänglig på `/frame.html`
- Konfiguration i Admin → Inställningar: källa (album/favoriter/slumpmässigt), intervall (5–60 sek)
- Token-skyddad

### Molnbackup (inbyggt, kräver ingen extern installation)
- **Fullt integrerat i appen** — ingen extern installation av rclone behövs av användaren
- Stöd för **7 molnleverantörer** med egna formulär för varje:
  - **Google Drive** — inbyggt OAuth-flöde med popup-fönster direkt i appen
  - **Microsoft OneDrive** — inbyggt OAuth-flöde
  - **Dropbox** — inbyggt OAuth-flöde
  - **Amazon S3 / Wasabi / Cloudflare R2** — formulär med Access Key + Secret
  - **Backblaze B2** — formulär med Account ID + Application Key
  - **WebDAV / Nextcloud** — formulär med URL, användarnamn och lösenord
  - **SFTP** — formulär med värd, port, användarnamn och lösenord
- Schema: manuell, dagligen eller varje vecka
- Visar status (OK / Fel / Kör…), senast körd och rullningsbar logg per backup-konfiguration
- "Testa anslutning"-knapp innan riktig synkronisering körs

### Admin & säkerhet
- **Användarhantering**: skapa, redigera, aktivera och inaktivera konton
- **RBAC** med roller (`admin` / `user` / `guest`) och granulära rättigheter per användare
- **Audit-log** med CSV-export — spårar login, borttagning, delning och nedladdning
- **Jobbkö** — övervaka status för thumbnail, transcode, phash, object_detection och zip-jobb
- **Import-historik** — sessionsbaserad logg med antal importerade, hoppade och felaktiga filer
- **Dubblettrapport** baserat på SHA-256 och perceptuell hash
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
| **Molnbackup** | rclone 1.72 (inbyggt i Docker-imagen — inga externa verktyg behövs) |
| **Geo** | PostGIS (klustring, avstånd) + reverse geocoding |
| **Realtid** | Server-Sent Events (SSE) för live-uppdateringar |
| **Processhantering** | PM2 (kör Node + Python parallellt i produktion) |
| **Containers** | Docker + Docker Compose |

### Bakgrundsarbetare

| Worker | Uppgift |
|--------|---------|
| `fileWatcher.js` | Bevakar mediamappar via chokidar, köar nya filer, skapar import-sessioner |
| `indexer.js` | Extraherar metadata, reverse-geocodar GPS, detekterar dubbletter, köar jobb |
| `thumbnailer.js` | Genererar 400 px + 1 200 px WebP-thumbnails |
| `transcoder.js` | Transkoderar video till H.264 MP4 med FFmpeg |
| `aiEmbedder.js` | Kör ansiktsdetektering och skapar 512-dim embeddings |
| `jobRunner.js` | Polling-baserad jobbkoordinator (phash, object_detection, transcode, thumbnail) |
| `trashCleaner.js` | Cron — permanent raderar filer efter N dagar i papperskorgen |
| `dailyPushJob.js` | Cron kl 08:00 — skickar minnespush till alla prenumeranter |
| `motionPhotoBackfill.js` | Identifierar Motion Photos bland befintliga bilder vid uppstart |
| `backupScheduler.js` | Kör schemalagda molnbackuper (dagligen/varje vecka) via rclone |

### Autentisering & säkerhet

- JWT **access token** (15 min) i Authorization-header
- JWT **refresh token** (30 dagar) i httpOnly-cookie
- Automatisk token-förnyelse i API-klienten utan användarinteraktion
- bcrypt-hashning av lösenord
- Rate-limiting på inloggningsendpointen (10 försök/min)
- Granulär RBAC — per-användarbehörigheter kan t.ex. stänga av karta, ansikten eller borttagning
- OAuth 2.0-flöde med PKCE-liknande state-verifiering för molnbackup

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

### Tabeller (42 migrationer, 001–042)

| Tabell | Beskrivning |
|--------|-------------|
| `users` | Konton med roller och inloggningshistorik |
| `user_permissions` | Granulära rättigheter per användare |
| `user_settings` | JSONB-inställningar (face detection-tröskel m.m.) |
| `assets` | Alla foton/videor — metadata, sökvägar, status, rating, iso, aperture, shutter_speed, focal_length_mm, lens_model, phash |
| `asset_metadata` | Rådata från EXIF/IPTC/XMP per asset |
| `asset_tags` | Koppling asset ↔ tag (med `source` och `confidence` för AI-taggar) |
| `tags` | Normaliserade taggar med hierarkiska sökvägar (`source`: manual/ai/xmp) |
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
| `shares` | Intern och publik delning — token, giltighetstid, max-visningar, `view_count`, `last_viewed_at` |
| `jobs` | Asynkrona jobb (thumbnail, transcode, phash, object_detection, zip_export) |
| `audit_log` | Komplett logg över alla användarhandlingar (inkl. kommentarer, reaktioner, metadata-ändringar) |
| `watched_folders` | Bevakade mappar inkl. SMB/CIFS-konfiguration |
| `push_subscriptions` | Web Push-prenumerationer per användare |
| `import_sessions` | Sessionsbaserad import-historik — importerade, hoppade och felaktiga filer per körning |
| `comments` | Per-bild kommentarer med användarreferens och tidsstämplar |
| `reactions` | Per-bild emoji-reaktioner (unik per användare + emoji) |
| `backup_configs` | Molnbackup-konfigurationer — provider, schema, OAuth-tokens, logg och körhistorik |

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

Kör backend med `--watch` för automatisk omstart vid filändringar. Startar även InsightFace som separat tjänst.

### AI-modeller

#### Ansiktsigenkänning (valfritt)
Lägg ONNX-modellerna i mappen konfigurerad via `AI_DETECTOR_PATH` och `AI_RECOGNIZER_PATH`:

- Detektor: `SCRFD_500M_bnkps_shape640x640.onnx`
- Igenkänning: `w600k_r50.onnx`

#### Motivigenkänning YOLOv8 (valfritt)
Ladda ner direkt från admingränssnittet (Admin → AI → Ladda ner modell) eller manuellt:

```bash
wget -O models/yolov8n.onnx \
  https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
```

Appen startar och fungerar fullt ut utan modellerna — AI-funktionerna är inaktiverade tills modellerna finns på plats.

### Molnbackup
Konfigurera backuper direkt i appen under **Admin → ☁️ Backup**. Välj leverantör, fyll i formuläret — inga externa verktyg behövs. rclone är inbyggt i Docker-imagen.

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

# Publik bas-URL — används som OAuth-återanrops-URI vid molnbackup
APP_BASE_URL=http://localhost:3000

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
| Social | `/api/assets/:id/social` | Kommentarer, reaktioner per bild |
| Aktivitet | `/api/activity` | Aktivitetsflöde (audit_log, paginerat) |
| Delning | `/api/shares` | Inkommande, utgående, publika länkar med åtkomststatistik |
| Export | `/api/export` | Starta ZIP-export, vattenstämpel, ladda ner färdigt arkiv |
| Admin | `/api/admin` | Användare, jobb, import-sessioner, backup (CRUD + OAuth + kör), kamerastatistik |
| OAuth-callback | `/api/admin/oauth/callback` | Tar emot OAuth-kod från Google/Microsoft/Dropbox |
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
│   │   ├── server.js                   # Fastify-applikation och startpunkt
│   │   ├── config.js                   # Miljökonfiguration
│   │   ├── db/
│   │   │   ├── migrations/             # 42 SQL-migrationer (001–042)
│   │   │   ├── runMigrations.js        # Migrationskörare
│   │   │   └── pool.js                 # PostgreSQL-anslutningspool
│   │   ├── plugins/                    # Fastify-plugins (auth, cors, rate-limit, static)
│   │   ├── routes/                     # Routfiler (assets, albums, persons, social,
│   │   │                               #   shares, admin, stream, search, export …)
│   │   ├── services/                   # Affärslogik (AI, geo, metadata, jobb, SSE,
│   │   │                               #   rcloneService, importSessionService, explore …)
│   │   └── workers/                    # Bakgrundsprocesser (se tabell ovan)
│   ├── models/                         # ONNX-modellcache (yolov8n.onnx m.fl.)
│   ├── insightface_server.py           # Python Flask AI-backend
│   ├── pm2.config.js                   # PM2 multi-process-konfiguration
│   ├── Dockerfile                      # Produktionsbild (Node + Python + FFmpeg + rclone)
│   ├── Dockerfile.dev                  # Utvecklingsbild (Node + FFmpeg + rclone, watch-läge)
│   ├── Dockerfile.insightface          # Separat Python-tjänst
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── index.html                  # SPA-skal
│   │   ├── app.js                      # Ingångspunkt + router
│   │   ├── frame.html                  # Fristående digital fotoram
│   │   ├── manifest.json               # PWA-manifest
│   │   └── sw.js                       # Service Worker
│   └── src/
│       ├── api.js                      # API-klient med JWT auto-refresh
│       ├── state.js                    # Global tillståndshantering
│       ├── components/                 # lightbox, socialPanel, gridCell,
│       │                               # nav, selectionManager, shareModal …
│       └── views/                      # timeline, albums, mapview, persons,
│                                       # explore, admin, folders, sharing,
│                                       # upload, activity, search, duplicates …
├── postgres/
│   └── Dockerfile                      # PostgreSQL 16 + pgvector + PostGIS
├── docker-compose.yml                  # Produktion
└── docker-compose.dev.yml              # Utveckling (inkl. InsightFace-tjänst)
```

---

## Kortkommandon

### Bilder-vyn (ingen textinmatning aktiv)

| Tangent | Åtgärd |
|---------|--------|
| `P` | Flagga markerade bilder 🚩 |
| `X` | Markera som avvisad ✗ |
| `U` | Ta bort flagga |
| `1`–`5` | Sätt stjärnbetyg |
| `6` | Röd färgetikett |
| `7` | Gul färgetikett |
| `8` | Grön färgetikett |
| `9` | Blå färgetikett |
| `0` | Ta bort färgetikett |

> Kortkommandona appliceras på **alla markerade bilder** (Ctrl+klik / Shift+klik).

### Mappar-vyn

| Tangent | Åtgärd |
|---------|--------|
| `↑` / `↓` | Navigera bland filer/mappar |
| `→` | Öppna markerad mapp |
| `←` | Fokus till mappträdet |
| `Backspace` | Gå upp en nivå |
| `F2` | Byt namn |
| `Enter` | Öppna mapp eller bild |
| `Delete` | Radera till papperskorg |
| `G` / `L` | Växla grid- / listvy |
| `Ctrl+A` | Markera alla |
| `Ctrl+X` / `C` / `V` | Klipp ut / Kopiera / Klistra in |

---

## Roadmap

### Klar ✅

| # | Funktion | Beskrivning |
|---|----------|-------------|
| 1A | Perceptuell hash | dHash — nästan-identiska bilder med Hamming ≤ 10 |
| 1B | YOLOv8-nano auto-taggning | COCO-80 → svenska taggar, CPU-only, ⚡-ikon i UI |
| 2A | Touch-gester i lightbox | Swipe-navigation + pinch-zoom + touch-panorering |
| 2B | Decennietal/årsvy | Zoombar tidslinje: dekad → år → månad → dag |
| 2C | Tangentbordsnavigering i gallery | ↑↓←→ i fotogrid, Enter, Space, Ctrl+A |
| 2D | Digital fotoram | Helskärms-slideshow `/frame.html`, konfig i admin |
| 3A | Kamerastatistik | ISO/bländare/slutartid/brännvidd/objektiv-histograms i admin |
| 3B | Minnesvy + push-notis | "Denna dag i historien" + daglig push kl 08:00 |
| 3C | Lagringsanalys | Diskutrymme per år/album/person — "Lagring"-flik i admin |
| 4A | Vattenstämpel vid export | Sharp-compositor, kryssruta i urvalstoolbar, konfig i admin |
| 4B | Redigera EXIF (utökat) | GPS-karta, datum, kameramodell, XMP-writeback med exiftool |
| 5A | Molnbackup (rclone, inbyggt) | Google Drive/OneDrive/Dropbox via OAuth-popup + S3/B2/WebDAV/SFTP via formulär — allt i appen, ingen extern installation |
| 5B | Import-rapport | Sessionsbaserad logg per importkörning — Admin → Import |
| 6A | Kommentarer + reaktioner | Per-bild kommentarer och 6 emoji-reaktioner i lightbox |
| 6B | Aktivitetsflöde | Human-läsbar vy med detaljer om vad som ändrades, klickbara thumbnails |
| 6C | Åtkomstlogg | Delningskort visar visningsräknare och senaste visningstid |

### Kommande 🔜

| # | Funktion | Beskrivning |
|---|----------|-------------|
| 7A | Ortstaggar automatiska | Skapa hierarkiska platstaggar (`Platser/Sverige/Västra Götaland/Göteborg`) automatiskt vid import baserat på reverse geocoding |
| 7B | Live Photo hover-video | Para ihop `.jpg` med `.mov` (samma basnamn) vid import — spela upp videon automatiskt vid hover i galleriet |
| 7C | Projektmappar / fotobok | Album-subtyp med kapitel, rubrik + brödtext + cover-foto per sektion och manuell ordning |

---

## Licens

Privat projekt.
