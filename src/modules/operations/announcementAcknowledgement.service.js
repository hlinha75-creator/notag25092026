const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDatabase } = require('../../database/connection');

function acknowledgementCount(announcementKey) {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS total
    FROM announcement_acknowledgements
    WHERE announcement_key = ?
  `).get(announcementKey);
  return Number(row?.total || 0);
}

function acknowledgementComponents(announcementKey, count = acknowledgementCount(announcementKey)) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`announcement:ack:${announcementKey}`)
        .setLabel(`OK (${count})`)
        .setEmoji('\u2705')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`announcement:list:${announcementKey}`)
        .setLabel('Ver lista')
        .setEmoji('\uD83D\uDC65')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function listAcknowledgements(announcementKey) {
  return getDatabase().prepare(`
    SELECT user_id, acknowledged_at
    FROM announcement_acknowledgements
    WHERE announcement_key = ?
    ORDER BY acknowledged_at ASC, user_id ASC
  `).all(announcementKey);
}

function acknowledgementListPages(announcementKey) {
  const rows = listAcknowledgements(announcementKey);
  if (rows.length === 0) return ['**Confirmaram OK (0):**\nNinguem confirmou ainda.'];

  const header = `**Confirmaram OK (${rows.length}):**`;
  const pages = [];
  let page = header;
  for (const [index, row] of rows.entries()) {
    const line = `${index + 1}. <@${row.user_id}>`;
    if (`${page}\n${line}`.length > 1900) {
      pages.push(page);
      page = `**Confirmaram OK (${rows.length}) - continuacao:**\n${line}`;
    } else {
      page += `\n${line}`;
    }
  }
  pages.push(page);
  return pages;
}

function registerAcknowledgement(announcementKey, userId) {
  if (!announcementKey || !userId) throw new Error('Aviso ou usuario invalido.');

  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO announcement_acknowledgements (announcement_key, user_id)
    VALUES (?, ?)
  `).run(announcementKey, userId);

  return { added: result.changes > 0, count: acknowledgementCount(announcementKey) };
}

module.exports = {
  acknowledgementComponents,
  acknowledgementCount,
  acknowledgementListPages,
  listAcknowledgements,
  registerAcknowledgement
};
