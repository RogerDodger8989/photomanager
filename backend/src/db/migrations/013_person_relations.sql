CREATE TYPE relation_type AS ENUM ('parent', 'child', 'sibling', 'partner', 'other');

CREATE TABLE person_relations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_a   UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  person_b   UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  relation   relation_type NOT NULL,  -- relation från person_a:s perspektiv
  label      TEXT,                    -- fritext, t.ex. "farfar", "kusin"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_a, person_b, relation)
);

CREATE INDEX idx_person_relations_a ON person_relations(person_a);
CREATE INDEX idx_person_relations_b ON person_relations(person_b);
