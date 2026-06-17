import bcrypt from 'bcrypt';
import { query } from '../db/pool.js';

export async function findUserByUsername(username) {
  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = true',
    [username]
  );
  return rows[0] ?? null;
}

export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

export async function updateLastLogin(userId) {
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
}

export async function getUserPermissions(userId) {
  const { rows } = await query(
    'SELECT permission_key, value FROM user_permissions WHERE user_id = $1',
    [userId]
  );
  // Returnera som { "nav.map": true, "write.metadata": false, ... }
  return Object.fromEntries(rows.map((r) => [r.permission_key, r.value]));
}

export async function logAudit(userId, action, targetId = null, targetType = null, meta = null, ip = null, ua = null) {
  await query(
    `INSERT INTO audit_log (user_id, action, target_id, target_type, meta, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, targetId, targetType, meta ? JSON.stringify(meta) : null, ip, ua]
  );
}
