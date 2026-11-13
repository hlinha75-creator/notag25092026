const { getDatabase, transaction } = require('../../database/connection');

function getOrder(id) {
  return getDatabase().prepare('SELECT * FROM wtb_buy_orders WHERE id = ?').get(id);
}

function getOrderBySourceMessage(sourceMessageId) {
  return getDatabase().prepare('SELECT * FROM wtb_buy_orders WHERE source_message_id = ?').get(sourceMessageId);
}

function createOrder(data) {
  const ownerId = data.ownerId || data.buyerId;
  const listingType = data.listingType || 'buy';
  const result = getDatabase().prepare(`
    INSERT INTO wtb_buy_orders (
      guild_id, channel_id, source_message_id, buyer_id, owner_id, listing_type,
      title, items, terms, image_attachment_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.guildId,
    data.channelId,
    data.sourceMessageId,
    ownerId,
    ownerId,
    listingType,
    data.title,
    data.items,
    data.terms,
    data.imageAttachmentName || null
  );
  return getOrder(result.lastInsertRowid);
}

function attachPublishedMessage(id, messageId) {
  getDatabase().prepare(`
    UPDATE wtb_buy_orders SET message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(messageId, id);
  return getOrder(id);
}

function removeUnpublishedOrder(id) {
  return getDatabase().prepare(`
    DELETE FROM wtb_buy_orders WHERE id = ? AND message_id IS NULL
  `).run(id);
}

const setOrderThread = transaction(({ id, threadId }) => {
  const result = getDatabase().prepare(`
    UPDATE wtb_buy_orders SET thread_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND thread_id IS NULL
  `).run(threadId, id);
  return { changed: result.changes > 0, order: getOrder(id) };
});

function updateOrder({ id, title, items, terms }) {
  const result = getDatabase().prepare(`
    UPDATE wtb_buy_orders
    SET title = ?, items = ?, terms = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, items, terms, id);
  return { changed: result.changes > 0, order: getOrder(id) };
}

function setOrderStatus({ id, status }) {
  const closedAt = status === 'closed' ? new Date().toISOString() : null;
  const result = getDatabase().prepare(`
    UPDATE wtb_buy_orders
    SET status = ?, closed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status <> ?
  `).run(status, closedAt, id, status);
  return { changed: result.changes > 0, order: getOrder(id) };
}

const createOffer = transaction(({ orderId, offererId, sellerId, items, note }) => {
  const order = getOrder(orderId);
  if (!order || order.status !== 'open') return { changed: false, order, offer: null };
  const memberId = offererId || sellerId;
  const result = getDatabase().prepare(`
    INSERT INTO wtb_offers (order_id, seller_id, offerer_id, items, note) VALUES (?, ?, ?, ?, ?)
  `).run(orderId, memberId, memberId, items, note || null);
  return {
    changed: true,
    order,
    offer: getDatabase().prepare('SELECT * FROM wtb_offers WHERE id = ?').get(result.lastInsertRowid)
  };
});

function getOffer(id) {
  return getDatabase().prepare('SELECT * FROM wtb_offers WHERE id = ?').get(id);
}

const confirmOffer = transaction(({ id }) => {
  const result = getDatabase().prepare(`
    UPDATE wtb_offers
    SET status = 'confirmed', confirmed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'offered'
  `).run(new Date().toISOString(), id);
  const offer = getOffer(id);
  return { changed: result.changes > 0, offer, order: offer ? getOrder(offer.order_id) : null };
});

const withdrawOffer = transaction(({ id, offererId, sellerId }) => {
  const memberId = offererId || sellerId;
  const result = getDatabase().prepare(`
    UPDATE wtb_offers
    SET status = 'withdrawn', withdrawn_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND offerer_id = ? AND status = 'offered'
  `).run(new Date().toISOString(), id, memberId);
  const offer = getOffer(id);
  return { changed: result.changes > 0, offer, order: offer ? getOrder(offer.order_id) : null };
});

function offerSummary(orderId) {
  const counts = getDatabase().prepare(`
    SELECT
      SUM(CASE WHEN status = 'offered' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
    FROM wtb_offers WHERE order_id = ?
  `).get(orderId);
  const confirmed = getDatabase().prepare(`
    SELECT offerer_id, items FROM wtb_offers
    WHERE order_id = ? AND status = 'confirmed'
    ORDER BY confirmed_at DESC, id DESC LIMIT 5
  `).all(orderId);
  return {
    offered: Number(counts?.offered || 0),
    confirmed: Number(counts?.confirmed || 0),
    confirmedOffers: confirmed
  };
}

function listPublishedOrders(limit = 200) {
  return getDatabase().prepare(`
    SELECT * FROM wtb_buy_orders
    WHERE message_id IS NOT NULL
    ORDER BY id DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  attachPublishedMessage,
  confirmOffer,
  createOffer,
  createOrder,
  getOffer,
  getOrder,
  getOrderBySourceMessage,
  listPublishedOrders,
  offerSummary,
  removeUnpublishedOrder,
  setOrderStatus,
  setOrderThread,
  updateOrder,
  withdrawOffer
};
