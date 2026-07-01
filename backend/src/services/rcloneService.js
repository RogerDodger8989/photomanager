import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const exec = promisify(execFile);

// ── OAuth provider-definitioner ─────────────────────────────────────────────

const OAUTH_PROVIDERS = {
  gdrive: {
    label:    'Google Drive',
    authUrl:  'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope:    'https://www.googleapis.com/auth/drive',
    extraAuth: { access_type: 'offline', prompt: 'consent' },
    configType: 'drive',
    configExtra: 'scope = drive\n',
  },
  onedrive: {
    label:    'Microsoft OneDrive',
    authUrl:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope:    'Files.ReadWrite offline_access',
    extraAuth: {},
    configType: 'onedrive',
    configExtra: 'drive_type = personal\n',
  },
  dropbox: {
    label:    'Dropbox',
    authUrl:  'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope:    '',
    extraAuth: { token_access_type: 'offline' },
    configType: 'dropbox',
    configExtra: '',
  },
};

// Tillfällig state-store för pågående OAuth-flöden (10 min TTL)
const PENDING_OAUTH = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of PENDING_OAUTH) {
    if (v.expiresAt < now) PENDING_OAUTH.delete(k);
  }
}

// ── OAuth-flöde ─────────────────────────────────────────────────────────────

export function startOAuthFlow({ provider, clientId, clientSecret, remoteName, name, destPath, schedule }) {
  const p = OAUTH_PROVIDERS[provider];
  if (!p) throw new Error(`OAuth stöds ej för: ${provider}`);
  purgeExpired();

  const state = randomBytes(16).toString('hex');
  const redirectUri = `${config.app.baseUrl}/api/admin/oauth/callback`;

  PENDING_OAUTH.set(state, {
    provider, clientId, clientSecret, redirectUri,
    remoteName, name, destPath: destPath ?? 'PhotoManager', schedule: schedule ?? 'manual',
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    state,
    ...(p.scope ? { scope: p.scope } : {}),
    ...p.extraAuth,
  });

  return { authUrl: `${p.authUrl}?${params}`, state };
}

export async function handleOAuthCallback(code, state) {
  purgeExpired();
  const pending = PENDING_OAUTH.get(state);
  if (!pending) throw new Error('Okänt OAuth-state — länken har troligtvis gått ut (10 min).');
  PENDING_OAUTH.delete(state);

  const p = OAUTH_PROVIDERS[pending.provider];

  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     pending.clientId,
      client_secret: pending.clientSecret,
      redirect_uri:  pending.redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? 'Token-utbyte misslyckades');
  if (!data.refresh_token) throw new Error('Ingen refresh_token fick – verifiera att rätt scope begärdes.');

  const expiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  const token = JSON.stringify({
    access_token:  data.access_token,
    token_type:    data.token_type ?? 'Bearer',
    refresh_token: data.refresh_token,
    expiry,
  });

  const rcloneConfig = [
    `[${pending.remoteName}]`,
    `type = ${p.configType}`,
    `client_id = ${pending.clientId}`,
    `client_secret = ${pending.clientSecret}`,
    `token = ${token}`,
    p.configExtra,
  ].join('\n');

  const { rows } = await query(
    `INSERT INTO backup_configs (name, remote_name, rclone_config, dest_path, schedule, enabled)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id`,
    [pending.name, pending.remoteName, rcloneConfig, pending.destPath, pending.schedule]
  );

  return rows[0].id;
}

// ── Config-generering för nyckelbaserade providers ───────────────────────────

export async function generateKeyConfig({ provider, remoteName, ...params }) {
  switch (provider) {
    case 's3': {
      const endpoint = params.endpoint ? `endpoint = ${params.endpoint}\n` : '';
      return [
        `[${remoteName}]`,
        `type = s3`,
        `provider = ${params.s3Provider ?? 'AWS'}`,
        `access_key_id = ${params.accessKeyId}`,
        `secret_access_key = ${params.secretAccessKey}`,
        `region = ${params.region ?? 'auto'}`,
        endpoint,
      ].join('\n');
    }
    case 'b2':
      return [
        `[${remoteName}]`,
        `type = b2`,
        `account = ${params.accountId}`,
        `key = ${params.applicationKey}`,
      ].join('\n');

    case 'webdav': {
      const encPass = await obscurePassword(params.pass);
      return [
        `[${remoteName}]`,
        `type = webdav`,
        `url = ${params.url}`,
        `vendor = ${params.vendor ?? 'other'}`,
        `user = ${params.user}`,
        `pass = ${encPass}`,
      ].join('\n');
    }

    case 'sftp': {
      const encPass = await obscurePassword(params.pass);
      return [
        `[${remoteName}]`,
        `type = sftp`,
        `host = ${params.host}`,
        `port = ${params.port ?? '22'}`,
        `user = ${params.user}`,
        `pass = ${encPass}`,
      ].join('\n');
    }

    default:
      throw new Error(`Okänd provider: ${provider}`);
  }
}

async function obscurePassword(password) {
  const { stdout } = await exec('rclone', ['obscure', password]);
  return stdout.trim();
}

// ── Kör backup ───────────────────────────────────────────────────────────────

function writeTempConfig(remoteName, rcloneConfig) {
  const path = `/tmp/pm-rclone-${remoteName}-${Date.now()}.conf`;
  writeFileSync(path, rcloneConfig, { mode: 0o600 });
  return path;
}

export async function testRemote(backupId) {
  const { rows } = await query('SELECT remote_name, rclone_config FROM backup_configs WHERE id = $1', [backupId]);
  const cfg = rows[0];
  if (!cfg) throw new Error('Backup-konfiguration hittades inte');

  const confPath = writeTempConfig(cfg.remote_name, cfg.rclone_config);
  try {
    await exec('rclone', ['lsd', `${cfg.remote_name}:`, '--config', confPath], { timeout: 20_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').toString().slice(0, 2000) };
  } finally {
    try { unlinkSync(confPath); } catch {}
  }
}

export async function runBackup(backupId) {
  const { rows } = await query('SELECT * FROM backup_configs WHERE id = $1', [backupId]);
  const cfg = rows[0];
  if (!cfg) throw new Error('Backup-konfiguration hittades inte');

  const confPath = writeTempConfig(cfg.remote_name, cfg.rclone_config);
  const dest = `${cfg.remote_name}:${cfg.dest_path}`;

  try {
    const { stdout, stderr } = await exec(
      'rclone',
      ['sync', config.media.photosPath, dest, '--config', confPath, '-v', '--stats=30s'],
      { timeout: 6 * 60 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }
    );
    const log = `${stdout}\n${stderr}`.trim().slice(-8000);
    await query(
      `UPDATE backup_configs SET last_run = NOW(), last_status = 'success', last_log = $2 WHERE id = $1`,
      [backupId, log]
    );
    return { ok: true, log };
  } catch (err) {
    const log = `${err.stdout ?? ''}\n${err.stderr ?? err.message ?? ''}`.trim().slice(-8000);
    await query(
      `UPDATE backup_configs SET last_run = NOW(), last_status = 'error', last_log = $2 WHERE id = $1`,
      [backupId, log]
    );
    return { ok: false, log };
  } finally {
    try { unlinkSync(confPath); } catch {}
  }
}
