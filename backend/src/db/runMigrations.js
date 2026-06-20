import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  '001_initial_schema.sql',
  '002_ai_suggestions.sql',
  '003_push_subscriptions.sql',
  '004_watched_folders.sql',
  '005_network_mounts.sql',
  '006_rating.sql',
  '007_asset_title_description.sql',
  '008_person_birth_year.sql',
  '009_person_death_year.sql',
  '010_asset_trash_path.sql',
  '011_source_folder.sql',
  '012_user_settings.sql',
  '013_person_relations.sql',
  '014_face_dismissed.sql',
];

export async function runMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await client.query('SELECT name FROM _migrations');
  const done = new Set(rows.map((r) => r.name));

  for (const file of MIGRATIONS) {
    if (done.has(file)) {
      console.log(`Migration ${file} redan körd — hoppar över.`);
      continue;
    }
    await client.query('BEGIN');
    const sql = readFileSync(resolve(__dirname, 'migrations', file), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`Migration ${file} klar.`);
  }
}
