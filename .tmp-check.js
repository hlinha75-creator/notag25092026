const { getDatabase } = require('./src/database/connection');
const db = getDatabase();
const rows = db.prepare("SELECT e.id, e.event_code, e.status, cep.id AS decision_id, cep.user_id, cep.amount, cep.status AS payout_status, cep.decision, cep.expires_at FROM campaign_event_payouts cep JOIN events e ON e.id = cep.event_id WHERE cep.status = 'pending' ORDER BY cep.id DESC").all();
console.log(JSON.stringify(rows, null, 2));
