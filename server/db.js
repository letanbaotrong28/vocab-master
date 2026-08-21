import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isPg = Boolean(process.env.DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

if (isPg) {
  console.log('Connecting to Cloud PostgreSQL database...');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  const dbPath = path.join(__dirname, 'database.db');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Graceful closing handler
process.on('SIGINT', () => {
  if (sqliteDb) {
    sqliteDb.close(() => {
      console.log('SQLite connection closed gracefully.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Helper to convert SQLite '?' placeholders to PostgreSQL '$1, $2, $3...'
const convertPlaceholders = (sql) => {
  if (!isPg) return sql;
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
};

export const query = async (sql, params = []) => {
  if (isPg) {
    const formattedSql = convertPlaceholders(sql);
    const res = await pgPool.query(formattedSql, params);
    return res.rows;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const getOne = async (sql, params = []) => {
  if (isPg) {
    const formattedSql = convertPlaceholders(sql);
    const res = await pgPool.query(formattedSql, params);
    return res.rows[0] || null;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const run = async (sql, params = []) => {
  if (isPg) {
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
      return { lastID: null, changes: 0 };
    }

    let formattedSql = convertPlaceholders(sql);
    formattedSql = formattedSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    formattedSql = formattedSql.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');

    // Fix: Only append RETURNING id for users table insertion where SERIAL id exists
    if (/^INSERT INTO users\b/i.test(formattedSql) && !/RETURNING/i.test(formattedSql)) {
      formattedSql += ' RETURNING id';
    }

    try {
      const res = await pgPool.query(formattedSql, params);
      const lastID = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
      return { lastID, changes: res.rowCount };
    } catch (err) {
      if (err.code === '42P07' || err.code === '23505') {
        return { lastID: null, changes: 0 };
      }
      console.error('Postgres Query Error:', err.message, 'SQL:', formattedSql);
      throw err;
    }
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const initDb = async () => {
  if (!isPg) {
    try {
      await run('PRAGMA journal_mode = WAL;');
      await run('PRAGMA busy_timeout = 5000;');
      await run('PRAGMA foreign_keys = ON;');
    } catch (e) {
      console.warn('Pragma setup notice:', e.message);
    }
  }

  // Migration Versioning Schema Table
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at BIGINT
    )
  `);

  // Users table
  if (isPg) {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        token_version INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        token_version INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  try {
    await run(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1`);
  } catch (e) {
    // Column already exists
  }

  // Vocab Sets table
  await run(`
    CREATE TABLE IF NOT EXISTS vocab_sets (
      id VARCHAR(255) PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      streak_count INTEGER DEFAULT 0,
      last_streak_date TEXT,
      created_at BIGINT,
      updated_at BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Relational Cards table
  await run(`
    CREATE TABLE IF NOT EXISTS cards (
      id VARCHAR(255) PRIMARY KEY,
      set_id VARCHAR(255) NOT NULL,
      english TEXT NOT NULL,
      vietnamese TEXT NOT NULL,
      example TEXT,
      example_translation TEXT,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (set_id) REFERENCES vocab_sets(id) ON DELETE CASCADE
    )
  `);

  // Relational Card Progress table
  await run(`
    CREATE TABLE IF NOT EXISTS card_progress (
      user_id INTEGER NOT NULL,
      set_id VARCHAR(255) NOT NULL,
      card_id VARCHAR(255) NOT NULL,
      correct INTEGER DEFAULT 0,
      wrong INTEGER DEFAULT 0,
      updated_at BIGINT,
      PRIMARY KEY (user_id, card_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (set_id) REFERENCES vocab_sets(id) ON DELETE CASCADE
    )
  `);

  // Essential Database Indexes
  await run(`CREATE INDEX IF NOT EXISTS idx_vocab_sets_user ON vocab_sets(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_card_progress_user_set ON card_progress(user_id, set_id)`);

  // Record migration version 1 with standard SQL UPSERT
  if (isPg) {
    await run(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?) ON CONFLICT(version) DO UPDATE SET applied_at = EXCLUDED.applied_at`,
      [Date.now()]
    );
  } else {
    await run(
      `INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (1, ?)`,
      [Date.now()]
    );
  }

  console.log(`Database (${isPg ? 'Cloud PostgreSQL' : 'Local SQLite'}) initialized with WAL mode, Indexes & Migrations.`);
};

export default sqliteDb;
