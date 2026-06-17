-- AI-förslag: kopplar ett ansikte till en potentiell person (pending admin-bekräftelse)
CREATE TABLE IF NOT EXISTS ai_suggestions (
    face_id    UUID PRIMARY KEY REFERENCES faces(id) ON DELETE CASCADE,
    person_id  UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    confidence FLOAT NOT NULL,      -- cosine similarity 0–1
    reviewed   BOOLEAN NOT NULL DEFAULT false,
    accepted   BOOLEAN,            -- true=bekräftad, false=avvisad, null=ej granskad
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_suggestions_unreviewed ON ai_suggestions(reviewed) WHERE reviewed = false;

-- Aktivera IVFFlat-index för snabb cosine-sökning när embeddings börjar samlas
-- (Körs manuellt efter att minst ~1000 ansikten indexerats)
-- CREATE INDEX idx_faces_embedding_ivfflat
--   ON faces USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);
