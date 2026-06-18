import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  '001_initial_schema.sql',
  '002_ai_suggestions.sql',
  '003_push_subscriptions.sql',
  '004_watched_folders.sql',
  '005_network_mounts.sql',
  '006_rating.sql',
  '007_asset_title_description.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    // Skapa migrationsspårnings-tabell om den inte finns
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Hämta redan körda migrationer
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

    // Seed admin-användare om den inte finns
    const { rows: existing } = await client.query(
      "SELECT id FROM users WHERE username = 'admin'"
    );
    if (existing.length === 0) {
      const hash = await bcrypt.hash('admin', 12);
      await client.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('admin', 'admin@example.com', $1, 'admin')
      `, [hash]);
      console.log('Admin-användare skapad (admin / admin).');
    }

    console.log('Alla migrationer klara.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration misslyckades:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
