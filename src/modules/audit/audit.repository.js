const { getDatabase } = require('../../database/connection');

function createAuditLog({ type, actorId, targetId, beforeValue, afterValue, reason, metadata }) {
  return getDatabase()
    .prepare(`
      INSERT INTO audit_logs (type, actor_id, target_id, before_value, after_value, reason, metadata)
      VALUES (@type, @actorId, @targetId, @beforeValue, @afterValue, @reason, @metadata)
    `)
    .run({
      type,
      actorId: actorId || null,
      targetId: targetId || null,
      beforeValue: beforeValue == null ? null : String(beforeValue),
      afterValue: afterValue == null ? null : String(afterValue),
      reason: reason || null,
      metadata: metadata ? JSON.stringify(metadata) : null
    });
}

function listAuditLogs(limit = 500) {
  return getDatabase()
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
    .all(limit);
}

module.exports = {
  createAuditLog,
  listAuditLogs
};
