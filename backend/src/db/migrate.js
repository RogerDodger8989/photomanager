import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const migrations = [
      '001_initial_schema.sql',
      '002_ai_suggestions.sql',
      '003_push_subscriptions.sql',
    ];

    for (const file of migrations) {
      const sql = readFileSync(resolve(__dirname, 'migrations', file), 'utf8');
      await client.query(sql);
      console.log(`Migration ${file} klar.`);
    }

    // Seed admin-användare med korrekt bcrypt-hash
    const hash = await bcrypt.hash('admin', 12);
    await client.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@example.com', $1, 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [hash]);
    console.log('Admin-användare seedades (admin / admin).');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration misslyckades:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
