const { randomUUID } = require('node:crypto');

const attempts = new Map();
const ttlMs = 30 * 60 * 1000;

function remember({ creatorId, contentType, values }) {
  cleanup();
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  attempts.set(id, {
    id,
    creatorId: String(creatorId),
    contentType: String(contentType || 'other'),
    values: { ...values },
    createdAt: Date.now()
  });
  return id;
}

function take(id, creatorId) {
  cleanup();
  const attempt = attempts.get(String(id));
  if (!attempt) throw new Error('Essa tentativa expirou. Abra novamente a criação do evento.');
  if (attempt.creatorId !== String(creatorId)) {
    throw new Error('Somente quem preencheu o evento pode retomar esta tentativa.');
  }
  attempts.delete(attempt.id);
  return attempt;
}

function cleanup(now = Date.now()) {
  for (const [id, attempt] of attempts) {
    if (now - attempt.createdAt >= ttlMs) attempts.delete(id);
  }
}

module.exports = { remember, take };
