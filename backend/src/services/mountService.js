import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';

const exec = promisify(execFile);

function toLinuxUncPath(unc) {
  return unc.replace(/\\/g, '/').replace(/^\/\/+/, '//');
}

export async function mountCifsShare({ uncPath, mountPoint, username, password }) {
  mkdirSync(mountPoint, { recursive: true });

  const linuxPath = toLinuxUncPath(uncPath);
  const credFile  = `/tmp/pm-cifs-${Date.now()}.cred`;
  const credContent = username
    ? `username=${username}\npassword=${password || ''}\n`
    : 'username=guest\npassword=\n';

  try {
    writeFileSync(credFile, credContent, { mode: 0o600 });

    const opts = [
      `credentials=${credFile}`,
      'uid=1000',
      'gid=1000',
      'iocharset=utf8',
      'file_mode=0644',
      'dir_mode=0755',
      'vers=3.0',
    ].join(',');

    await exec('mount', ['-t', 'cifs', linuxPath, mountPoint, '-o', opts], {
      timeout: 15000,
    });
  } finally {
    try { unlinkSync(credFile); } catch {}
  }
}

export async function unmountShare(mountPoint) {
  if (!existsSync(mountPoint)) return;
  try {
    await exec('umount', ['-l', mountPoint], { timeout: 10000 });
  } catch {}
}

export function isMounted(mountPoint) {
  try {
    return readFileSync('/proc/mounts', 'utf8').includes(` ${mountPoint} `);
  } catch {
    return false;
  }
}
