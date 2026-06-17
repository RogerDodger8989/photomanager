-- Aktivera extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- för full-text fuzzy search

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');
CREATE TYPE asset_status AS ENUM ('active', 'trashed', 'deleted');
CREATE TYPE transcode_status AS ENUM ('pending', 'processing', 'done', 'failed', 'not_needed');
CREATE TYPE share_type AS ENUM ('internal', 'public_link');
CREATE TYPE access_level AS ENUM ('read', 'write');
CREATE TYPE face_source AS ENUM ('digikam', 'lightroom', 'manual', 'ai');
CREATE TYPE job_type AS ENUM ('thumbnail', 'transcode', 'index', 'ai_embed', 'trash_clean', 'zip_export');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'done', 'failed');
CREATE TYPE metadata_source AS ENUM ('exif', 'iptc', 'xmp');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      TEXT NOT NULL UNIQUE,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'user',
    avatar_path   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMPTZ
);

-- Dynamisk RBAC: admin kan slå på/av enskilda rättigheter per användare
-- Nyckelexempel: "nav.map", "nav.faces", "nav.sharing", "write.metadata", "write.delete"
CREATE TABLE user_permissions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    value          BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (user_id, permission_key)
);

-- Web Push-prenumerationer per användare
CREATE TABLE push_subscriptions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ASSETS (bilder & videor)
-- ============================================================

CREATE TABLE assets (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Filsystem
    file_path        TEXT NOT NULL UNIQUE, -- relativ från MEDIA_PHOTOS_PATH
    file_name        TEXT NOT NULL,
    file_hash        TEXT,                 -- SHA-256
    mime_type        TEXT,
    file_size        BIGINT,
    status           asset_status NOT NULL DEFAULT 'active',
    trashed_at       TIMESTAMPTZ,

    -- Egenskaper
    width            INTEGER,
    height           INTEGER,
    duration         FLOAT,               -- video: sekunder

    -- Tidsstämplar
    taken_at         TIMESTAMPTZ,         -- från EXIF DateTimeOriginal
    file_created_at  TIMESTAMPTZ,
    indexed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Geodata
    location         GEOGRAPHY(POINT, 4326),
    location_label   TEXT,                -- "Göteborg, Sverige"

    -- Genererade filer
    thumb_small_path TEXT,                -- 400px WebP
    thumb_large_path TEXT,                -- 1200px WebP
    transcoded_path  TEXT,                -- H.264 MP4
    transcode_status transcode_status NOT NULL DEFAULT 'not_needed',

    -- Ägare & statistik
    owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    view_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_assets_status        ON assets(status);
CREATE INDEX idx_assets_taken_at      ON assets(taken_at DESC NULLS LAST);
CREATE INDEX idx_assets_owner_id      ON assets(owner_id);
CREATE INDEX idx_assets_file_hash     ON assets(file_hash);
CREATE INDEX idx_assets_location      ON assets USING GIST(location);
CREATE INDEX idx_assets_transcode     ON assets(transcode_status) WHERE transcode_status IN ('pending', 'processing');

-- Råa metadata-värden (all EXIF/IPTC/XMP sparas här)
CREATE TABLE asset_metadata (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source     metadata_source NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    UNIQUE (asset_id, source, key)
);

CREATE INDEX idx_metadata_asset_id ON asset_metadata(asset_id);

-- ============================================================
-- PERSONS & FACES
-- ============================================================

CREATE TABLE persons (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          TEXT NOT NULL,
    owner_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    cover_face_id UUID,                  -- sätts efter att faces skapats
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE faces (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    source    face_source NOT NULL DEFAULT 'manual',

    -- Koordinater som andel av bilddimensioner (0.0–1.0), upplösningsoberoende
    region_x  FLOAT NOT NULL,
    region_y  FLOAT NOT NULL,
    region_w  FLOAT NOT NULL,
    region_h  FLOAT NOT NULL,

    -- AI-vektor för ansiktsigenkänning (512-dim ArcFace)
    embedding VECTOR(512),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_faces_asset_id  ON faces(asset_id);
CREATE INDEX idx_faces_person_id ON faces(person_id);
-- Vektor-index för cosine similarity-sökning (skapas när AI aktiveras)
-- CREATE INDEX idx_faces_embedding ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Sätt cover_face_id som FK nu när faces finns
ALTER TABLE persons ADD CONSTRAINT fk_cover_face FOREIGN KEY (cover_face_id) REFERENCES faces(id) ON DELETE SET NULL;

-- ============================================================
-- TAGGAR
-- ============================================================

CREATE TABLE tags (
    id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE  -- normaliserat, lowercase
);

CREATE TABLE asset_tags (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);

-- ============================================================
-- HÄNDELSER (Fas B: tidslinjegruppering)
-- ============================================================

CREATE TABLE events (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           TEXT,                 -- "Semester i Spanien", kan vara auto-genererat
    date_from      TIMESTAMPTZ NOT NULL,
    date_to        TIMESTAMPTZ NOT NULL,
    location       GEOGRAPHY(POINT, 4326),
    location_label TEXT,
    cover_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    owner_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_assets (
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, asset_id)
);

-- ============================================================
-- ALBUM
-- ============================================================

CREATE TABLE albums (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           TEXT NOT NULL,
    description    TEXT,
    owner_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    cover_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    is_smart       BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE album_assets (
    album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (album_id, asset_id)
);

-- ============================================================
-- FAVORITER
-- ============================================================

CREATE TABLE favorites (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, asset_id)
);

-- ============================================================
-- DELNING
-- ============================================================

CREATE TABLE shares (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    share_type   share_type NOT NULL,
    asset_id     UUID REFERENCES assets(id) ON DELETE CASCADE,
    album_id     UUID REFERENCES albums(id) ON DELETE CASCADE,
    created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with  UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = publik länk
    token        TEXT UNIQUE,                                   -- publik token
    expires_at   TIMESTAMPTZ,                                  -- NULL = aldrig
    access_level access_level NOT NULL DEFAULT 'read',
    view_count   INTEGER NOT NULL DEFAULT 0,
    max_views    INTEGER,                                       -- NULL = obegränsat
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT share_has_target CHECK (asset_id IS NOT NULL OR album_id IS NOT NULL)
);

CREATE INDEX idx_shares_token      ON shares(token) WHERE token IS NOT NULL;
CREATE INDEX idx_shares_created_by ON shares(created_by);
CREATE INDEX idx_shares_shared_with ON shares(shared_with) WHERE shared_with IS NOT NULL;

-- ============================================================
-- JOBBKÖ
-- ============================================================

CREATE TABLE jobs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type    job_type NOT NULL,
    asset_id    UUID REFERENCES assets(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- för ZIP-export
    status      job_status NOT NULL DEFAULT 'pending',
    payload     JSONB,         -- extra data (t.ex. export-options)
    result_path TEXT,          -- resultatfil (t.ex. ZIP-sökväg)
    error_msg   TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status   ON jobs(status) WHERE status IN ('pending', 'running');
CREATE INDEX idx_jobs_type     ON jobs(job_type, status);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,   -- 'login', 'view', 'delete', 'share', 'download', etc.
    target_id  UUID,
    target_type TEXT,           -- 'asset', 'album', 'share', 'user'
    ip_address TEXT,
    user_agent TEXT,
    meta       JSONB,           -- extra kontextdata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id    ON audit_log(user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================================
-- FULL-TEXT SEARCH INDEX
-- ============================================================

-- Sökbart index på filnamn + location_label + taggar
CREATE INDEX idx_assets_filename_trgm ON assets USING GIN(file_name gin_trgm_ops);
CREATE INDEX idx_tags_name_trgm       ON tags USING GIN(name gin_trgm_ops);

-- ============================================================
-- TRIGGER: updated_at automatiskt
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_albums_updated_at
  BEFORE UPDATE ON albums
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Admin-användaren skapas av migrate.js med korrekt bcrypt-hash
