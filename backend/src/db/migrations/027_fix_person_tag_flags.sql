-- Sätt rätt flaggor på alla befintliga taggar under "Personer/" (eller som är "Personer").
-- is_face_tag=true, export_only_leaf=true, show_lifespan=true, export_synonyms=false
UPDATE tags
SET
  is_face_tag      = TRUE,
  export_only_leaf = TRUE,
  show_lifespan    = TRUE,
  export_synonyms  = FALSE
WHERE
  path = 'Personer'
  OR path ILIKE 'Personer/%';
