-- Reparera assets som råkat hamna i flera stackar.
-- Logik: en asset kan bara tillhöra EN stack. Om assets.stack_id ≠ den stack
-- där den faktiskt är listad som member i stack_assets, rensa bort den.

-- Steg 1: Ta bort stack_assets-rader där assets.stack_id pekar på en ANNAN stack
DELETE FROM stack_assets sa
WHERE NOT EXISTS (
  SELECT 1 FROM assets a
  WHERE a.id = sa.asset_id AND a.stack_id = sa.stack_id
);

-- Steg 2: Stackar med < 2 members efter rensningen – upplös dem
UPDATE assets SET stack_id = NULL
WHERE stack_id IN (
  SELECT s.id FROM stacks s
  WHERE (SELECT COUNT(*) FROM stack_assets sa WHERE sa.stack_id = s.id) < 2
);

DELETE FROM stacks
WHERE id NOT IN (
  SELECT DISTINCT stack_id FROM stack_assets
);
