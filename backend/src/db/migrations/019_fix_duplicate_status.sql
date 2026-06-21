-- Duplikater ska numera vara synliga i galleriet precis som vanliga bilder.
-- Återställ alla 'duplicate'-rader till 'active'.
UPDATE assets SET status = 'active' WHERE status = 'duplicate';
