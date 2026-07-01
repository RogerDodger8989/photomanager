import { query } from '../db/pool.js';
import { runBackup } from '../services/rcloneService.js';

const INTERVALS = {
  daily:  24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

async function runDueBackups() {
  const { rows } = await query(
    `SELECT id, name, schedule, last_run FROM backup_configs
     WHERE enabled = true AND schedule IN ('daily', 'weekly')`
  );

  for (const cfg of rows) {
    const intervalMs = INTERVALS[cfg.schedule];
    const due = !cfg.last_run || (Date.now() - new Date(cfg.last_run).getTime()) >= intervalMs;
    if (!due) continue;

    console.log(`BackupScheduler: kör schemalagd backup "${cfg.name}"...`);
    try {
      await runBackup(cfg.id);
    } catch (err) {
      console.error(`BackupScheduler: fel vid backup "${cfg.name}":`, err.message);
    }
  }
}

export function startBackupScheduler() {
  const CHECK_INTERVAL = 30 * 60 * 1000; // kolla var 30:e minut
  setInterval(() => runDueBackups().catch(console.error), CHECK_INTERVAL);
  console.log('BackupScheduler: startad (kontrollerar schemalagda backuper var 30:e minut)');
}
