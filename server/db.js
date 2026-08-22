import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isPg = Boolean(process.env.DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

// Item 19, 56 & 63 Fix: Parse PostgreSQL BIGINT, Pool timeouts & error events
if (isPg) {
  pg.types.setTypeParser(20, (val) => (val ? parseInt(val, 10) : null));
  console.log('Connecting to Cloud PostgreSQL database...');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : {
      rejectUnauthorized: process.env.NODE_ENV === 'production' && process.env.PGSSL_STRICT === 'true'
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
  });

  pgPool.on('error', (err) => {
    console.error('Unexpected idle client error in PostgreSQL Pool:', err.message);
  });
}

// Item 26 & 27 Fix: Unified DB Graceful Close Helper with Pool Drain
export const closeDb = async () => {
  if (pgPool) {
    await pgPool.end();
    console.log('PostgreSQL connection pool drained cleanly.');
  }
  if (sqliteDb) {
    return new Promise((resolve) => {
      sqliteDb.close(() => {
        console.log('SQLite connection closed gracefully.');
        resolve();
      });
    });
  }
};

// Item 49 Fix: Smart SQL placeholder converter (ignores '?' inside single-quoted string literals)
const convertPlaceholders = (sql) => {
  if (!isPg) return sql;
  let formatted = sql.replace(/BEGIN\s+IMMEDIATE/gi, 'BEGIN');
  let paramIndex = 1;
  let inSingleQuote = false;
  let result = '';

  for (let i = 0; i < formatted.length; i++) {
    const char = formatted[i];
    if (char === "'") {
      inSingleQuote = !inSingleQuote;
      result += char;
    } else if (char === '?' && !inSingleQuote) {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }
  return result;
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

// Item 18 Fix: Do not swallow 23505 unique constraint errors (allows authRoutes to handle duplicate usernames)
export const run = async (sql, params = []) => {
  if (isPg) {
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
      return { lastID: null, changes: 0 };
    }

    let formattedSql = convertPlaceholders(sql);
    formattedSql = formattedSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    formattedSql = formattedSql.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');

    if (/^INSERT INTO users\b/i.test(formattedSql) && !/RETURNING/i.test(formattedSql)) {
      formattedSql += ' RETURNING id';
    }

    try {
      const res = await pgPool.query(formattedSql, params);
      const lastID = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
      return { lastID, changes: res.rowCount };
    } catch (err) {
      if (err.code === '42P07') {
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

export const withTransaction = async (callback) => {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        query: async (sql, params = []) => {
          const formattedSql = convertPlaceholders(sql);
          const res = await client.query(formattedSql, params);
          return res.rows;
        },
        getOne: async (sql, params = []) => {
          const formattedSql = convertPlaceholders(sql);
          const res = await client.query(formattedSql, params);
          return res.rows[0] || null;
        },
        run: async (sql, params = []) => {
          let formattedSql = convertPlaceholders(sql);
          formattedSql = formattedSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
          formattedSql = formattedSql.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');

          if (/^INSERT INTO users\b/i.test(formattedSql) && !/RETURNING/i.test(formattedSql)) {
            formattedSql += ' RETURNING id';
          }

          const res = await client.query(formattedSql, params);
          const lastID = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
          return { lastID, changes: res.rowCount };
        }
      };

      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } else {
    try {
      await run('BEGIN IMMEDIATE');
      const tx = { query, getOne, run };
      const result = await callback(tx);
      await run('COMMIT');
      return result;
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }
};

export const initDb = async () => {
  if (!isPg) {
    if (!sqliteDb) {
      const sqlite3Module = await import('sqlite3');
      const sqlite3 = sqlite3Module.default || sqlite3Module;
      const dbPath = path.join(__dirname, 'database.db');
      sqliteDb = new sqlite3.Database(dbPath);
    }
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

  // Relational Card Progress table with composite PK (user_id, set_id, card_id) (Item 39, 40, 41 Fix)
  await run(`
    CREATE TABLE IF NOT EXISTS card_progress (
      user_id INTEGER NOT NULL,
      set_id VARCHAR(255) NOT NULL,
      card_id VARCHAR(255) NOT NULL,
      correct INTEGER DEFAULT 0,
      wrong INTEGER DEFAULT 0,
      updated_at BIGINT,
      PRIMARY KEY (user_id, set_id, card_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (set_id) REFERENCES vocab_sets(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )
  `);

  // Migration for legacy SQLite table with cards NOT NULL column & JSON data (Item 5 & 6 Fix)
  if (!isPg) {
    try {
      const columns = await query(`PRAGMA table_info(vocab_sets)`);
      const cardsCol = columns.find(c => c.name === 'cards');
      if (cardsCol) {
        console.log('Migrating legacy JSON vocab_sets.cards data to relational cards table...');
        const legacySets = await query(`SELECT id, cards FROM vocab_sets WHERE cards IS NOT NULL AND cards != ''`);
        for (const set of legacySets) {
          try {
            const parsedCards = JSON.parse(set.cards);
            if (Array.isArray(parsedCards)) {
              for (let i = 0; i < parsedCards.length; i++) {
                const c = parsedCards[i];
                if (!c.english || !c.vietnamese) continue;
                const cardId = String(c.id || `${set.id}_card_${i}`).replace(/[\/\?#]/g, '_').trim();
                await run(
                  `INSERT INTO cards (id, set_id, english, vietnamese, example, example_translation, position)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     english = excluded.english,
                     vietnamese = excluded.vietnamese,
                     example = excluded.example,
                     example_translation = excluded.example_translation,
                     position = excluded.position`,
                  [cardId, set.id, c.english.trim(), c.vietnamese.trim(), c.example || '', c.exampleTranslation || '', i]
                );
              }
            }
          } catch (e) {
            console.warn(`Failed to parse legacy JSON cards for set ${set.id}:`, e.message);
          }
        }

        await run(`CREATE TABLE IF NOT EXISTS vocab_sets_new (
          id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          streak_count INTEGER DEFAULT 0,
          last_streak_date TEXT,
          created_at BIGINT,
          updated_at BIGINT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        await run(`INSERT INTO vocab_sets_new (id, user_id, title, description, streak_count, last_streak_date, created_at, updated_at)
                   SELECT id, user_id, title, description, streak_count, last_streak_date, created_at, updated_at FROM vocab_sets`);
        await run(`DROP TABLE vocab_sets`);
        await run(`ALTER TABLE vocab_sets_new RENAME TO vocab_sets`);
        console.log('Legacy JSON migration complete. vocab_sets table restructured without NOT NULL cards column.');
      }
    } catch (migErr) {
      console.warn('Migration warning:', migErr.message);
    }
  }

  // Essential & Composite Database Indexes (Item 52 Fix)
  await run(`CREATE INDEX IF NOT EXISTS idx_vocab_sets_user ON vocab_sets(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cards_set_pos ON cards(set_id, position)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_card_progress_user_set ON card_progress(user_id, set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_card_progress_composite ON card_progress(user_id, set_id, card_id)`);

  // Automatic Orphan Progress Cleanup on Startup (Item 52 Fix)
  try {
    await run(`DELETE FROM card_progress WHERE card_id NOT IN (SELECT id FROM cards)`);
  } catch (cleanErr) {
    console.warn('Orphan cleanup warning:', cleanErr.message);
  }

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
