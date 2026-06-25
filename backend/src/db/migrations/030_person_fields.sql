-- Extern länk och bio/notering per person
ALTER TABLE persons ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS notes TEXT;
