-- Stack-system: gruppera bilder i en synlig "hög" (DigiKam-stil)

CREATE TABLE IF NOT EXISTS stacks (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cover_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stack_assets (
    stack_id   UUID NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
    asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (stack_id, asset_id)
);

CREATE INDEX IF NOT EXISTS stack_assets_asset_idx ON stack_assets(asset_id);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS stack_id UUID REFERENCES stacks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS assets_stack_idx ON assets(stack_id) WHERE stack_id IS NOT NULL;
