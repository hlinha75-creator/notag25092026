const { getDatabase } = require('../database/connection');
const operationalData = require('../modules/albion/operationalData.service');
const seasonPoints = require('../modules/albion/seasonPoints.service');
const financeRepo = require('../modules/finance/finance.repository');
const { eventTypes } = require('../modules/events/eventTypes');

function scalar(sql, params = []) {
  const row = getDatabase().prepare(sql).get(...params);
  return Number(row?.value || 0);
}

function tableExists(name) {
  return Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function latestPveRanking(limit = 10) {
  const db = getDatabase();
  const dates = db.prepare(`
    SELECT DISTINCT snapshot_date
    FROM albion_fame_daily_snapshots
    ORDER BY snapshot_date DESC
    LIMIT 8
  `).all().map((row) => row.snapshot_date).sort();

  if (dates.length >= 2) {
    const start = dates[0];
    const end = dates.at(-1);
    const rows = db.prepare(`
      WITH first_day AS (
        SELECT albion_key, pve_fame FROM albion_fame_daily_snapshots WHERE snapshot_date = ?
      ), last_day AS (
        SELECT albion_key, albion_name, pve_fame FROM albion_fame_daily_snapshots WHERE snapshot_date = ?
      )
      SELECT l.albion_name, MAX(0, l.pve_fame - f.pve_fame) AS amount
      FROM last_day l
      JOIN first_day f ON f.albion_key = l.albion_key
      ORDER BY amount DESC, l.albion_name COLLATE NOCASE
      LIMIT ?
    `).all(start, end, limit);
    return { label: `${start} a ${end}`, source: 'albion_fame_daily_snapshots', rows };
  }

  const latest = db.prepare(`
    SELECT import_id, week_key, created_at
    FROM albion_pve_rankings
    ORDER BY created_at DESC, import_id DESC
    LIMIT 1
  `).get();
  if (!latest) return { label: 'Sem importação', source: 'albion_pve_rankings', rows: [] };
  const rows = db.prepare(`
    SELECT albion_name, amount
    FROM albion_pve_rankings
    WHERE import_id = ?
    ORDER BY rank ASC
    LIMIT ?
  `).all(latest.import_id, limit);
  return { label: latest.week_key, source: 'albion_pve_rankings', rows };
}

function participationRanking(limit = 10) {
  const rows = getDatabase().prepare(`
    SELECT
      COALESCE(u.albion_name, u.discord_name, ep.discord_id) AS albion_name,
      COUNT(DISTINCT ep.event_id) AS events,
      COALESCE(SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)), 0) AS seconds
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    LEFT JOIN users u ON u.discord_id = ep.discord_id
    WHERE datetime(COALESCE(e.ended_at, e.started_at, e.created_at)) >= datetime('now', '-7 days')
      AND e.status <> 'cancelled'
      AND ep.is_spectator = 0
    GROUP BY ep.discord_id
    ORDER BY events DESC, seconds DESC, albion_name COLLATE NOCASE
    LIMIT ?
  `).all(limit);
  return { label: 'Últimos 7 dias', source: 'event_participants', rows };
}

function seasonDashboard() {
  const ranking = seasonPoints.calculateSeasonRanking();
  const linkedNames = new Set(getDatabase().prepare(`
    SELECT lower(albion_name) AS albion_key
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
  `).all().map((row) => row.albion_key));
  return {
    ...ranking,
    rows: ranking.rows.map((row) => ({
      ...row,
      linked: linkedNames.has(row.name.toLowerCase())
    }))
  };
}

function fameDashboard() {
  if (!tableExists('albion_fame_category_imports')) return { imports: [], rows: [] };
  const db = getDatabase();
  const categories = [
    ['pve', 'PvE', 'pve_fame'],
    ['pvp', 'PvP', 'pvp_fame'],
    ['gathering', 'Coleta', 'gathering_fame'],
    ['crafting', 'Craft', 'crafting_fame']
  ];
  const imports = categories.map(([category, label]) => ({
    category,
    label,
    latest: db.prepare(`
      SELECT id, source_name, rows_count, linked_count, unmatched_count, missing_count,
             reductions_count, imported_by, created_at
      FROM albion_fame_category_imports
      WHERE category = ? AND undone_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(category) || null
  }));
  const rows = db.prepare(`
    SELECT ft.albion_key, ft.albion_name, ft.pve_fame, ft.pvp_fame,
           ft.gathering_fame, ft.crafting_fame, ft.updated_at,
           u.discord_id, u.discord_name, u.registration_status
    FROM albion_fame_totals ft
    LEFT JOIN users u ON u.discord_id = (
      SELECT candidate.discord_id
      FROM users candidate
      WHERE lower(candidate.albion_name) = lower(ft.albion_name)
      ORDER BY CASE WHEN candidate.registration_status = 'member' THEN 0 ELSE 1 END,
               candidate.updated_at DESC,
               candidate.discord_id ASC
      LIMIT 1
    )
  `).all().map((row) => ({ ...row, linked: Boolean(row.discord_id) }));

  for (const [, , column] of categories) {
    const values = [...new Set(rows.map((row) => Number(row[column] || 0)).filter((value) => value > 0))].sort((a, b) => b - a);
    const scoreByValue = new Map(values.map((value, index) => [value, values.length <= 1 ? 100 : ((values.length - 1 - index) / (values.length - 1)) * 100]));
    for (const row of rows) {
      const value = Number(row[column] || 0);
      row[`${column}_score`] = value > 0 ? Number(scoreByValue.get(value).toFixed(2)) : 0;
      row[`${column}_rank`] = null;
    }
  }

  for (const row of rows) {
    const totalFame = Number(row.pve_fame || 0) + Number(row.pvp_fame || 0)
      + Number(row.gathering_fame || 0) + Number(row.crafting_fame || 0);
    row.overall_score = totalFame > 0
      ? Number(((row.pve_fame_score + row.pvp_fame_score + row.gathering_fame_score + row.crafting_fame_score) / 4).toFixed(2))
      : null;
    row.overall_rank = null;
  }

  const overallOrdered = rows.filter((row) => row.overall_score !== null)
    .sort((a, b) => b.overall_score - a.overall_score || a.albion_name.localeCompare(b.albion_name));
  overallOrdered.forEach((row, index) => {
    row.overall_rank = index + 1;
  });

  for (const [, , column] of categories) {
    rows.filter((row) => Number(row[column] || 0) > 0)
      .sort((a, b) => Number(b[column]) - Number(a[column])
        || Number(b.overall_score || 0) - Number(a.overall_score || 0)
        || a.albion_name.localeCompare(b.albion_name))
      .forEach((row, index) => { row[`${column}_rank`] = index + 1; });
  }

  rows.sort((a, b) => (a.overall_rank || Number.MAX_SAFE_INTEGER) - (b.overall_rank || Number.MAX_SAFE_INTEGER) || a.albion_name.localeCompare(b.albion_name));
  return { imports, rows };
}

function publicFameRankings(limit = 5) {
  const db = getDatabase();
  const categories = [
    ['pve', 'PvE'],
    ['pvp', 'PvP'],
    ['gathering', 'Coleta'],
    ['crafting', 'Craft']
  ];
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));

  return {
    metric: 'gain_since_previous_import',
    categories: categories.map(([category, label]) => {
      const imports = db.prepare(`
        SELECT id, created_at
        FROM albion_fame_category_imports
        WHERE category = ? AND undone_at IS NULL
        ORDER BY id DESC
        LIMIT 2
      `).all(category);
      const latest = imports[0] || null;
      const previous = imports[1] || null;
      const rows = latest && previous
        ? db.prepare(`
          SELECT current.albion_name AS name,
                 current.amount AS current_amount,
                 previous.amount AS previous_amount,
                 current.amount - previous.amount AS gain
          FROM albion_fame_category_rows current
          JOIN albion_fame_category_rows previous
            ON previous.import_id = ?
           AND previous.albion_key = current.albion_key
          WHERE current.import_id = ?
            AND current.amount > previous.amount
          ORDER BY gain DESC, current.amount DESC, current.albion_name COLLATE NOCASE ASC
          LIMIT ?
        `).all(previous.id, latest.id, safeLimit).map((row, index) => ({
          rank: index + 1,
          name: row.name,
          amount: Number(row.gain || 0),
          currentAmount: Number(row.current_amount || 0),
          previousAmount: Number(row.previous_amount || 0)
        }))
        : [];

      return {
        category,
        label,
        updatedAt: latest?.created_at || null,
        comparisonFrom: previous?.created_at || null,
        comparisonAvailable: Boolean(latest && previous),
        rows
      };
    })
  };
}

function activeCampaign() {
  const campaign = getDatabase().prepare(`
    SELECT
      c.id, c.code, c.title, c.goal_amount, c.status, c.updated_at,
      COALESCE(SUM(CASE WHEN cc.status = 'approved' THEN cc.amount ELSE 0 END), 0) AS raised,
      COUNT(DISTINCT CASE WHEN cc.status = 'approved' THEN cc.user_id END) AS contributors
    FROM campaigns c
    LEFT JOIN campaign_contributions cc ON cc.campaign_id = c.id
    WHERE c.status = 'open'
    GROUP BY c.id
    ORDER BY c.id ASC
    LIMIT 1
  `).get();
  return campaign || null;
}

function recentDeposits(limit = 12) {
  return getDatabase().prepare(`
    SELECT
      bt.id, bt.type, bt.amount, bt.reason, bt.created_at,
      COALESCE(u.albion_name, u.discord_name, bt.user_id) AS albion_name
    FROM balance_transactions bt
    LEFT JOIN users u ON u.discord_id = bt.user_id
    WHERE bt.amount > 0 AND lower(bt.type) LIKE '%deposit%'
    ORDER BY bt.id DESC
    LIMIT ?
  `).all(limit);
}

function depositSummary() {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
    FROM balance_transactions
    WHERE amount > 0
      AND lower(type) LIKE '%deposit%'
      AND datetime(created_at) >= datetime('now', '-7 days')
  `).get();
  return { count: Number(row?.count || 0), amount: Number(row?.amount || 0) };
}

function listMembers(limit = 100) {
  return getDatabase().prepare(`
    SELECT
      u.discord_id, u.albion_name, u.discord_name, u.registration_status, u.updated_at,
      COALESCE(b.balance, 0) AS balance,
      COUNT(DISTINCT ep.event_id) AS events_total
    FROM users u
    LEFT JOIN balances b ON b.discord_id = u.discord_id
    LEFT JOIN event_participants ep ON ep.discord_id = u.discord_id
    WHERE NOT EXISTS (
      SELECT 1 FROM linked_discord_accounts l
      WHERE l.linked_discord_id = u.discord_id AND l.primary_discord_id <> l.linked_discord_id
    )
    GROUP BY u.discord_id
    ORDER BY CASE WHEN u.registration_status = 'member' THEN 0 ELSE 1 END,
             COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
    LIMIT ?
  `).all(limit);
}

function listEvents(limit = 50) {
  return getDatabase().prepare(`
    SELECT
      e.id, e.event_code, e.creator_id, e.finalized_by, e.title, e.description,
      e.location, e.scheduled_time, e.status, COALESCE(e.audience, 'public') AS audience,
      COALESCE(e.content_type, 'other') AS content_type,
      e.tank_slots, e.healer_slots, e.support_slots, e.dps_slots,
      e.created_at, e.started_at, e.ended_at, e.review_required,
      COALESCE(creator.albion_name, creator.discord_name, e.creator_id) AS creator_name,
      COALESCE(finalizer.albion_name, finalizer.discord_name, e.finalized_by) AS finalizer_name,
      SUM(CASE WHEN ep.is_spectator = 0 AND COALESCE(ep.is_paused, 0) = 0 THEN 1 ELSE 0 END) AS participants,
      SUM(CASE WHEN ep.is_spectator = 1 THEN 1 ELSE 0 END) AS spectators,
      COALESCE(er.net_loot, 0) AS net_loot,
      er.status AS review_status,
      CASE
        WHEN EXISTS (SELECT 1 FROM world_boss_events wb WHERE wb.event_id = e.id) THEN 'world_boss'
        WHEN EXISTS (SELECT 1 FROM raid_avalon_events ra WHERE ra.event_id = e.id) THEN 'raid_avalon'
        WHEN EXISTS (SELECT 1 FROM custom_events ce WHERE ce.event_id = e.id) THEN 'custom'
        ELSE 'standard'
      END AS event_kind
    FROM events e
    LEFT JOIN event_participants ep ON ep.event_id = e.id
    LEFT JOIN event_reviews er ON er.event_id = e.id
    LEFT JOIN users creator ON creator.discord_id = e.creator_id
    LEFT JOIN users finalizer ON finalizer.discord_id = e.finalized_by
    GROUP BY e.id
    ORDER BY e.id DESC
    LIMIT ?
  `).all(limit);
}

function listTransactions(limit = 50) {
  return getDatabase().prepare(`
    SELECT
      bt.id, bt.type, bt.amount, bt.before_balance, bt.after_balance, bt.reason, bt.created_at,
      COALESCE(u.albion_name, u.discord_name, bt.user_id) AS albion_name
    FROM balance_transactions bt
    LEFT JOIN users u ON u.discord_id = bt.user_id
    ORDER BY bt.id DESC
    LIMIT ?
  `).all(limit);
}

function listWithdrawRequests(limit = 100) {
  return getDatabase().prepare(`
    SELECT
      wr.*,
      COALESCE(u.albion_name, u.discord_name, wr.user_id) AS member_name,
      COALESCE(u.discord_name, wr.user_id) AS discord_name,
      COALESCE(b.balance, 0) AS current_balance
    FROM withdraw_requests wr
    LEFT JOIN users u ON u.discord_id = wr.user_id
    LEFT JOIN balances b ON b.discord_id = wr.user_id
    ORDER BY
      CASE wr.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      wr.id DESC
    LIMIT ?
  `).all(limit);
}

function listAudit(limit = 50) {
  return getDatabase().prepare(`
    SELECT id, type, actor_id, target_id, reason, created_at
    FROM audit_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function activityByDay() {
  return getDatabase().prepare(`
    WITH RECURSIVE days(day) AS (
      SELECT date('now', '-6 days')
      UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    )
    SELECT days.day, COUNT(DISTINCT e.id) AS events, COUNT(ep.id) AS participations
    FROM days
    LEFT JOIN events e ON date(COALESCE(e.ended_at, e.started_at, e.created_at)) = days.day AND e.status <> 'cancelled'
    LEFT JOIN event_participants ep ON ep.event_id = e.id AND ep.is_spectator = 0 AND COALESCE(ep.is_paused, 0) = 0
    GROUP BY days.day
    ORDER BY days.day
  `).all();
}

function freshness() {
  const candidates = [
    ['balance_transactions', 'created_at'],
    ['events', 'updated_at'],
    ['users', 'updated_at'],
    ['albion_fame_daily_snapshots', 'captured_at'],
    ['albion_pve_rankings', 'created_at']
  ].filter(([table]) => tableExists(table));
  const values = candidates.map(([table, column]) => (
    getDatabase().prepare(`SELECT MAX(${column}) AS value FROM ${table}`).get()?.value
  )).filter(Boolean).sort();
  return values.at(-1) || null;
}

function getDashboardData() {
  const campaign = activeCampaign();
  const memberBalances = financeRepo.listActivePositiveBalances();
  const totalMemberBalance = memberBalances.reduce((total, row) => total + Number(row.balance || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    freshness: freshness(),
    overview: {
      activeMembers: scalar("SELECT COUNT(*) AS value FROM users WHERE registration_status = 'member'"),
      totalMemberBalance,
      campaign,
      deposits7d: depositSummary(),
      recentDeposits: recentDeposits(),
      activity: activityByDay()
    },
    rankings: {
      pve: latestPveRanking(),
      participation: participationRanking(),
      season: seasonDashboard(),
      fame: fameDashboard()
    },
    members: listMembers(),
    eventTypes,
    events: listEvents(),
    finance: {
      memberBalances,
      transactions: listTransactions(),
      withdrawals: listWithdrawRequests(),
      campaign
    },
    operations: {
      activeEvents: scalar("SELECT COUNT(*) AS value FROM events WHERE status IN ('created', 'running', 'review', 'pending_payment')"),
      reviewsPending: scalar("SELECT COUNT(*) AS value FROM event_reviews WHERE status IN ('draft', 'submitted')"),
      registrationsPending: scalar("SELECT COUNT(*) AS value FROM registrations WHERE status = 'pending'"),
      paymentRequestsPending: tableExists('payment_requests')
        ? scalar("SELECT COUNT(*) AS value FROM payment_requests WHERE status = 'requested'") : 0,
      withdrawRequestsPending: scalar("SELECT COUNT(*) AS value FROM withdraw_requests WHERE status IN ('requested', 'approved')")
    },
    albionOperational: operationalData.getOperationalDashboardData(),
    audit: listAudit()
  };
}

module.exports = { fameDashboard, getDashboardData, latestPveRanking, participationRanking, publicFameRankings, seasonDashboard };
