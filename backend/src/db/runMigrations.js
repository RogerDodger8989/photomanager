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
  '015_smart_album_rules.sql',
  '016_face_cluster_group.sql',
  '017_motion_photo.sql',
  '018_duplicate_status.sql',
  '019_fix_duplicate_status.sql',
  '020_tags_extended.sql',
  '021_folder_tag_rules_and_synonyms.sql',
  '022_stacks.sql',
  '023_tags_export_synonyms_and_base.sql',
  '024_fix_tag_name_casing.sql',
  '025_fix_decade_tag_casing.sql',
  '026_tags_drop_name_unique.sql',
  '027_fix_person_tag_flags.sql',
  '028_flags_colors.sql',
  '029_visibility_and_upload_perm.sql',
  '030_person_fields.sql',
  '031_person_custom_id.sql',
  '032_tag_custom_id.sql',
  '033_fix_stack_duplicates.sql',
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
