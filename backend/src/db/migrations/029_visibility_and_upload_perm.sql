-- Synlighet per bild (Privat / Familj / Delad) + ny roll "family" + can_upload-flagga

-- 1. Ny roll
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'family';

-- 2. Synlighet-kolumn på assets (default 'family' = synlig för alla familje-members)
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'family'
  CHECK (visibility IN ('private', 'family', 'shared'));

-- 3. can_upload per användare (admin kan sätta oberoende av roll)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_upload BOOLEAN NOT NULL DEFAULT false;

-- Admins får can_upload = true
UPDATE users SET can_upload = true WHERE role = 'admin';

-- 4. Befintliga bilder → 'family' (synliga för alla befintliga users)
UPDATE assets SET visibility = 'family' WHERE visibility IS NULL;
