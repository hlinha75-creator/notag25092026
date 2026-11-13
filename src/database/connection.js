const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('../config/env');

let db;
let transactionDepth = 0;

function getDatabase() {
  if (db) return db;

  const databasePath = path.resolve(env.databasePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function transaction(fn) {
  return (...args) => {
    const database = getDatabase();
    if (transactionDepth > 0) {
      return fn(...args);
    }

    transactionDepth += 1;
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  };
}

module.exports = {
  getDatabase,
  transaction
};
