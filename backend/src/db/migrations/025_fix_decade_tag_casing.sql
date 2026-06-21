-- Rätta fel-casade decennium-taggar: "1950-Talet" → "1950-talet"
UPDATE tags
SET
  name = lower(name),
  path = replace(path, name, lower(name))
WHERE name ~ '^\d+-[A-Z]';
