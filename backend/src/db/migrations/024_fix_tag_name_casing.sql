-- Återställ korrekt casing på taggnamn som felaktigt sparades som gemener.
-- Använder INITCAP men ENDAST på rent alfabetiska ord (inga siffror, inga bindestreck).
-- "anna persson" → "Anna Persson"
-- "1950-talet" → lämnas oförändrat (börjar med siffra)

UPDATE tags
SET
  name = INITCAP(name),
  path = (
    SELECT string_agg(INITCAP(seg), '/' ORDER BY ordinality)
    FROM unnest(string_to_array(path, '/')) WITH ORDINALITY AS t(seg, ordinality)
  )
WHERE name = lower(name)
  AND name ~ '^[[:alpha:]]'           -- bara taggar som börjar med bokstav (ej siffra)
  AND lower(name) NOT IN ('personer', 'år', 'bilder');
