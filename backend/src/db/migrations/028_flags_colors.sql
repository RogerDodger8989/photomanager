-- Migration 028: Lägg till flag och color_label på assets
-- flag:        0=ingen, 1=flaggad, -1=avvisad
-- color_label: 0=ingen, 1=röd, 2=gul, 3=grön, 4=blå, 5=lila
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS flag        SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color_label SMALLINT NOT NULL DEFAULT 0;
