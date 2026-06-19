import bcrypt from 'bcrypt';
import { pool } from './pool.js';
import { runMigrations } from './runMigrations.js';

async function migrate() {
  const client = await pool.connect();
  try {
    await runMigrations(client);

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
