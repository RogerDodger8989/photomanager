-- Tillåt taggar med samma namn men olika path (hierarkiska taggar med olika föräldrar).
-- Tidigare UNIQUE(name) förhindrade t.ex. "Konfirmation" att finnas under
-- "Aktivitet/Konfirmation" om det redan fanns en flat root-tagg "Konfirmation".
-- UNIQUE(path) räcker — varje unik path är per definition unik.

ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
