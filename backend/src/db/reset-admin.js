import bcrypt from 'bcrypt';
import { pool } from './pool.js';

const hash = await bcrypt.hash('admin', 12);

const res = await pool.query(
  `INSERT INTO users (username, email, password_hash, role)
   VALUES ('admin', 'admin@example.com', $1, 'admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = $1
   RETURNING username`,
  [hash]
);

console.log(`✓ Lösenord satt för: ${res.rows[0].username}`);
console.log('  Logga in med: admin / admin');
await pool.end();
