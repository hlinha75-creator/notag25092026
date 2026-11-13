const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const env = require('../config/env');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const MANAGED_BACKUP_PATTERN = /^notag-\d{4}-\d{2}-\d{2}T[0-9TZ-]+-[a-z0-9_-]+\.sqlite$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function listManagedBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  const resolvedDir = path.resolve(backupDir);
  return fs.readdirSync(resolvedDir)
    .filter((name) => MANAGED_BACKUP_PATTERN.test(name))
    .map((name) => {
      const filePath = path.resolve(resolvedDir, name);
      if (path.dirname(filePath) !== resolvedDir) return null;
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return { name, path: filePath, modifiedAt: stat.mtime, backupAt: backupDateFromName(name) || stat.mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.backupAt.getTime() - a.backupAt.getTime());
}

function backupDateFromName(name) {
  const match = String(name).match(/^notag-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const value = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour),
    Number(minute), Number(second), Number(millisecond)
  ));
  return Number.isNaN(value.getTime()) ? null : value;
}

function pruneBackups(backupDir, options = {}) {
  const recentDays = Math.max(1, Number(options.recentDays || 7));
  const maxCount = Math.max(1, Number(options.maxCount || 30));
  const now = options.now instanceof Date ? options.now : new Date();
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((recentDays - 1) * DAY_MS);
  const files = listManagedBackups(backupDir);
  const recent = files.filter((file) => file.backupAt.getTime() >= cutoff && file.backupAt.getTime() <= now.getTime());
  const keep = new Set(recent.slice(0, maxCount).map((file) => file.path));
  if (files[0]) keep.add(files[0].path);

  const removed = [];
  const archived = [];
  const archiveDir = options.archiveDir ? path.resolve(options.archiveDir) : null;
  if (archiveDir) fs.mkdirSync(archiveDir, { recursive: true });
  for (const file of files) {
    if (keep.has(file.path)) continue;
    if (archiveDir) {
      const destination = path.join(archiveDir, file.name);
      if (fs.existsSync(destination)) continue;
      fs.renameSync(file.path, destination);
      archived.push(destination);
    } else {
      fs.rmSync(file.path);
      removed.push(file.path);
    }
  }

  return { total: files.length, kept: files.length - removed.length - archived.length, removed, archived };
}

function backupDatabase(reason = 'manual') {
  const databasePath = path.resolve(env.databasePath);
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const safeReason = reason.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
  const backupPath = path.join(backupDir, `notag-${timestamp()}-${safeReason}.sqlite`);
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const escapedBackupPath = backupPath.replace(/'/g, "''");
    source.exec(`VACUUM INTO '${escapedBackupPath}'`);
  } finally {
    source.close();
  }
  try {
    const archiveDir = env.nodeEnv === 'development'
      ? (process.env.BACKUP_ARCHIVE_DIR || path.join(os.homedir(), 'Desktop', 'NOTAG-backups-antigos'))
      : null;
    pruneBackups(backupDir, { archiveDir });
  } catch (error) {
    console.warn(`[BACKUP] Cópia criada, mas a retenção falhou: ${error.message}`);
  }
  return backupPath;
}

function latestBackupFile() {
  const databasePath = path.resolve(env.databasePath);
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  if (!fs.existsSync(backupDir)) return null;
  const files = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, size: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files[0] || null;
}

function testLatestBackupRestore() {
  const latest = latestBackupFile();
  if (!latest) {
    return {
      ok: false,
      message: 'Nenhum backup .sqlite encontrado.',
      latest: null,
      checks: []
    };
  }

  const tempPath = path.join(os.tmpdir(), `notag-backup-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const checks = [];
  let db = null;

  try {
    fs.copyFileSync(latest.path, tempPath);
    db = new Database(tempPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    checks.push({ name: 'integrity_check', ok: integrity === 'ok', value: String(integrity) });
    for (const table of ['users', 'balances', 'balance_transactions', 'events', 'event_participants']) {
      checks.push(tableCountCheck(db, table));
    }
  } catch (error) {
    checks.push({ name: 'erro', ok: false, value: error.message });
  } finally {
    if (db) db.close();
    fs.rmSync(tempPath, { force: true });
  }

  return {
    ok: checks.every((check) => check.ok),
    message: checks.every((check) => check.ok)
      ? 'Backup abriu e passou nos testes basicos.'
      : 'Backup abriu com erro ou falhou em algum teste.',
    latest,
    checks
  };
}

function tableCountCheck(db, tableName) {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    if (!exists) return { name: tableName, ok: false, value: 'tabela ausente' };
    const count = db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get()?.total || 0;
    return { name: tableName, ok: true, value: `${count} linha(s)` };
  } catch (error) {
    return { name: tableName, ok: false, value: error.message };
  }
}

module.exports = {
  backupDatabase,
  latestBackupFile,
  pruneBackups,
  testLatestBackupRestore
};
