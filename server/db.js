import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDeterministicCardId } from './idUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqliteDbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, 'database.db');

export const isPg = Boolean(process.env.DATABASE_URL);

let sqliteDb = null;
let sqlite3Driver = null;
let pgPool = null;
const MIGRATION_LOCK_ID = 84623157;
const LATEST_SCHEMA_VERSION = 5;

const sqliteQueryOn = (database, sql, params = []) => new Promise((resolve, reject) => {
  database.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const sqliteGetOneOn = (database, sql, params = []) => new Promise((resolve, reject) => {
  database.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row || null);
  });
});

const sqliteRunOn = (database, sql, params = []) => new Promise((resolve, reject) => {
  database.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const closeSqliteConnection = (database) => new Promise((resolve, reject) => {
  database.close((err) => {
    if (err) reject(err);
    else resolve();
  });
});

const openSqliteConnection = async () => {
  if (!sqlite3Driver) {
    const sqlite3Module = await import('sqlite3');
    sqlite3Driver = sqlite3Module.default || sqlite3Module;
  }

  return new Promise((resolve, reject) => {
    const database = new sqlite3Driver.Database(sqliteDbPath, (err) => {
      if (err) reject(err);
      else resolve(database);
    });
  });
};

const withSqliteTransaction = async (callback, { foreignKeys = true } = {}) => {
  const database = await openSqliteConnection();
  const tx = {
    query: (sql, params = []) => sqliteQueryOn(database, sql, params),
    getOne: (sql, params = []) => sqliteGetOneOn(database, sql, params),
    run: (sql, params = []) => sqliteRunOn(database, sql, params)
  };

  try {
    await tx.run('PRAGMA busy_timeout = 5000;');
    await tx.run(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'};`);
    await tx.run('BEGIN IMMEDIATE');
    const result = await callback(tx);
    await tx.run('COMMIT');
    return result;
  } catch (err) {
    await tx.run('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await closeSqliteConnection(database).catch((err) => {
      console.error('SQLite transaction connection close error:', err.message);
    });
  }
};

// Item 19, 56 & 63 Fix: Parse PostgreSQL BIGINT, Pool timeouts & error events
if (isPg) {
  pg.types.setTypeParser(20, (val) => (val ? parseInt(val, 10) : null));
  console.log('Connecting to Cloud PostgreSQL database...');
  let connectionString = process.env.DATABASE_URL;
  let urlSslMode = null;
  try {
    const parsedConnectionString = new URL(connectionString);
    urlSslMode = parsedConnectionString.searchParams.get('sslmode');
    // node-postgres 9 changes the meaning of sslmode=require. Strip it and use
    // the explicit TLS object below so certificate verification is unambiguous.
    parsedConnectionString.searchParams.delete('sslmode');
    connectionString = parsedConnectionString.toString();
  } catch {
    // pg will provide the actionable error for a malformed connection string.
  }
  const sslMode = process.env.PGSSLMODE || urlSslMode;
  pgPool = new pg.Pool({
    connectionString,
    ssl: sslMode === 'disable' ? false : {
      rejectUnauthorized: process.env.PGSSL_STRICT !== 'false'
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
    await closeSqliteConnection(sqliteDb);
    sqliteDb = null;
    console.log('SQLite connection closed gracefully.');
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
      if (inSingleQuote && formatted[i + 1] === "'") {
        result += "''";
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
        result += char;
      }
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
  return sqliteQueryOn(sqliteDb, sql, params);
};

export const getOne = async (sql, params = []) => {
  if (isPg) {
    const formattedSql = convertPlaceholders(sql);
    const res = await pgPool.query(formattedSql, params);
    return res.rows[0] || null;
  }
  return sqliteGetOneOn(sqliteDb, sql, params);
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
      console.error('Postgres Query Error:', err.message, 'SQL:', formattedSql);
      throw err;
    }
  }

  return sqliteRunOn(sqliteDb, sql, params);
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
  }

  return withSqliteTransaction(callback);
};

const parseLegacyCards = (value, setId) => {
  if (value === null || value === undefined || value === '') return [];
  let parsed;
  try {
    parsed = Array.isArray(value) ? value : JSON.parse(value);
  } catch (err) {
    throw new Error(`Legacy cards JSON for set "${setId}" is invalid: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Legacy cards JSON for set "${setId}" must be an array.`);
  }

  return parsed.map((card, index) => {
    if (!card || typeof card !== 'object') {
      throw new Error(`Legacy card ${index + 1} in set "${setId}" is not an object.`);
    }
    if (typeof card.english !== 'string' || !card.english.trim()) {
      throw new Error(`Legacy card ${index + 1} in set "${setId}" has no English term.`);
    }
    if (typeof card.vietnamese !== 'string' || !card.vietnamese.trim()) {
      throw new Error(`Legacy card ${index + 1} in set "${setId}" has no Vietnamese term.`);
    }
    return card;
  });
};

const getLegacyCardStats = (card) => ({
  correct: Math.min(2147483647, Math.max(0, Number.parseInt(card.stats?.correct, 10) || 0)),
  wrong: Math.min(2147483647, Math.max(0, Number.parseInt(card.stats?.wrong, 10) || 0))
});

const chooseLegacyCardId = (usedCardIds, setId, rawId, index) => {
  const normalized = rawId === undefined || rawId === null
    ? ''
    : String(rawId).normalize('NFC').trim();

  if (normalized && normalized.length <= 255) {
    const owner = usedCardIds.get(normalized);
    if (!owner || owner === setId) {
      usedCardIds.set(normalized, setId);
      return normalized;
    }
  }

  let attempt = 0;
  let cardId;
  do {
    cardId = createDeterministicCardId(setId, `${normalized || 'missing'}\0${index}\0${attempt}`);
    attempt += 1;
  } while (usedCardIds.has(cardId));
  usedCardIds.set(cardId, setId);
  return cardId;
};

const legacyCardMatches = (existing, card) => (
  existing
  && existing.english === card.english.trim()
  && existing.vietnamese === card.vietnamese.trim()
  && (existing.example || '') === (typeof card.example === 'string' ? card.example : '')
  && (existing.example_translation || '') === (typeof card.exampleTranslation === 'string' ? card.exampleTranslation : '')
);

const assertNoOrphans = async (dbQuery) => {
  const orphanSet = await dbQuery(
    `SELECT s.id FROM vocab_sets s LEFT JOIN users u ON u.id = s.user_id
     WHERE u.id IS NULL LIMIT 1`
  );
  if (orphanSet.length) throw new Error(`Orphan vocab set detected: ${orphanSet[0].id}`);

  const orphanCard = await dbQuery(
    `SELECT c.id FROM cards c LEFT JOIN vocab_sets s ON s.id = c.set_id
     WHERE s.id IS NULL LIMIT 1`
  );
  if (orphanCard.length) throw new Error(`Orphan card detected: ${orphanCard[0].id}`);

  const orphanProgress = await dbQuery(
    `SELECT p.card_id FROM card_progress p
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN vocab_sets s ON s.id = p.set_id AND s.user_id = p.user_id
     LEFT JOIN cards c ON c.id = p.card_id AND c.set_id = p.set_id
     WHERE u.id IS NULL OR s.id IS NULL OR c.id IS NULL LIMIT 1`
  );
  if (orphanProgress.length) {
    throw new Error(`Orphan or mismatched card progress detected: ${orphanProgress[0].card_id}`);
  }
};

const migrateSqliteRelationalSchema = async () => {
  const setColumns = await query('PRAGMA table_info(vocab_sets)');
  const cardColumns = await query('PRAGMA table_info(cards)');
  const progressColumns = await query('PRAGMA table_info(card_progress)');
  const setColumnNames = new Set(setColumns.map(column => column.name));
  const cardColumnNames = new Set(cardColumns.map(column => column.name));
  const progressColumnNames = new Set(progressColumns.map(column => column.name));

  for (const required of ['id', 'user_id', 'title']) {
    if (!setColumnNames.has(required)) throw new Error(`vocab_sets is missing required column "${required}".`);
  }
  for (const required of ['id', 'set_id', 'english', 'vietnamese']) {
    if (!cardColumnNames.has(required)) throw new Error(`cards is missing required column "${required}".`);
  }
  for (const required of ['user_id', 'set_id', 'card_id']) {
    if (!progressColumnNames.has(required)) throw new Error(`card_progress is missing required column "${required}".`);
  }

  const progressPrimaryKey = progressColumns
    .filter(column => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map(column => column.name)
    .join(',');
  const [setForeignKeys, cardForeignKeys, progressForeignKeys] = await Promise.all([
    query('PRAGMA foreign_key_list(vocab_sets)'),
    query('PRAGMA foreign_key_list(cards)'),
    query('PRAGMA foreign_key_list(card_progress)')
  ]);
  const hasCascade = (rows, fromColumns, table, toColumns) => {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.id)) groups.set(row.id, []);
      groups.get(row.id).push(row);
    }
    return Array.from(groups.values()).some(group => {
      const ordered = group.sort((a, b) => a.seq - b.seq);
      return ordered[0]?.table === table
        && String(ordered[0]?.on_delete).toUpperCase() === 'CASCADE'
        && ordered.map(row => row.from).join(',') === fromColumns.join(',')
        && ordered.map(row => row.to).join(',') === toColumns.join(',');
    });
  };
  const hasAllCascades = hasCascade(setForeignKeys, ['user_id'], 'users', ['id'])
    && hasCascade(cardForeignKeys, ['set_id'], 'vocab_sets', ['id'])
    && hasCascade(progressForeignKeys, ['user_id', 'set_id'], 'vocab_sets', ['user_id', 'id'])
    && hasCascade(progressForeignKeys, ['set_id', 'card_id'], 'cards', ['set_id', 'id']);
  const hasLegacyCards = setColumnNames.has('cards');
  const needsRebuild = hasLegacyCards
    || progressPrimaryKey !== 'user_id,set_id,card_id'
    || !hasAllCascades;
  if (!needsRebuild) return;

  await withSqliteTransaction(async (tx) => {
    // BEGIN IMMEDIATE is already held here. Re-read and parse legacy data only
    // after old application instances can no longer commit another JSON write.
    const lockedSetColumns = await tx.query('PRAGMA table_info(vocab_sets)');
    const lockedCardColumns = await tx.query('PRAGMA table_info(cards)');
    const lockedProgressColumns = await tx.query('PRAGMA table_info(card_progress)');
    const lockedSetColumnNames = new Set(lockedSetColumns.map(column => column.name));
    const lockedCardColumnNames = new Set(lockedCardColumns.map(column => column.name));
    const lockedProgressColumnNames = new Set(lockedProgressColumns.map(column => column.name));
    const lockedProgressPrimaryKey = lockedProgressColumns
      .filter(column => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(column => column.name)
      .join(',');
    const lockedSetForeignKeys = await tx.query('PRAGMA foreign_key_list(vocab_sets)');
    const lockedCardForeignKeys = await tx.query('PRAGMA foreign_key_list(cards)');
    const lockedProgressForeignKeys = await tx.query('PRAGMA foreign_key_list(card_progress)');
    const lockedHasAllCascades = hasCascade(lockedSetForeignKeys, ['user_id'], 'users', ['id'])
      && hasCascade(lockedCardForeignKeys, ['set_id'], 'vocab_sets', ['id'])
      && hasCascade(lockedProgressForeignKeys, ['user_id', 'set_id'], 'vocab_sets', ['user_id', 'id'])
      && hasCascade(lockedProgressForeignKeys, ['set_id', 'card_id'], 'cards', ['set_id', 'id']);
    const lockedHasLegacyCards = lockedSetColumnNames.has('cards');
    if (!lockedHasLegacyCards
      && lockedProgressPrimaryKey === 'user_id,set_id,card_id'
      && lockedHasAllCascades) return;

    for (const required of ['id', 'user_id', 'title']) {
      if (!lockedSetColumnNames.has(required)) throw new Error(`vocab_sets is missing required column "${required}".`);
    }
    for (const required of ['id', 'set_id', 'english', 'vietnamese']) {
      if (!lockedCardColumnNames.has(required)) throw new Error(`cards is missing required column "${required}".`);
    }
    for (const required of ['user_id', 'set_id', 'card_id']) {
      if (!lockedProgressColumnNames.has(required)) throw new Error(`card_progress is missing required column "${required}".`);
    }

    await assertNoOrphans(tx.query);
    const duplicateProgress = await tx.query(
      `SELECT user_id, set_id, card_id, COUNT(*) AS duplicate_count
       FROM card_progress GROUP BY user_id, set_id, card_id HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (duplicateProgress.length) {
      throw new Error(`Duplicate card progress prevents safe migration: ${duplicateProgress[0].card_id}`);
    }
    const legacySets = lockedHasLegacyCards
      ? await tx.query('SELECT id, user_id, cards FROM vocab_sets WHERE cards IS NOT NULL AND cards != ?', [''])
      : [];
    const parsedLegacySets = legacySets.map(set => ({ ...set, parsedCards: parseLegacyCards(set.cards, set.id) }));

    await tx.run('DROP TABLE IF EXISTS card_progress_new');
    await tx.run('DROP TABLE IF EXISTS cards_new');
    await tx.run('DROP TABLE IF EXISTS vocab_sets_new');
    await tx.run(`
      CREATE TABLE vocab_sets_new (
        id VARCHAR(255) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        streak_count INTEGER DEFAULT 0,
        last_streak_date TEXT,
        created_at BIGINT,
        updated_at BIGINT,
        UNIQUE (user_id, id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await tx.run(`
      CREATE TABLE cards_new (
        id VARCHAR(255) PRIMARY KEY,
        set_id VARCHAR(255) NOT NULL,
        english TEXT NOT NULL,
        vietnamese TEXT NOT NULL,
        example TEXT,
        example_translation TEXT,
        position INTEGER DEFAULT 0,
        UNIQUE (set_id, id),
        FOREIGN KEY (set_id) REFERENCES vocab_sets(id) ON DELETE CASCADE
      )
    `);
    await tx.run(`
      CREATE TABLE card_progress_new (
        user_id INTEGER NOT NULL,
        set_id VARCHAR(255) NOT NULL,
        card_id VARCHAR(255) NOT NULL,
        correct INTEGER DEFAULT 0,
        wrong INTEGER DEFAULT 0,
        updated_at BIGINT,
        PRIMARY KEY (user_id, set_id, card_id),
        FOREIGN KEY (user_id, set_id) REFERENCES vocab_sets(user_id, id) ON DELETE CASCADE,
        FOREIGN KEY (set_id, card_id) REFERENCES cards(set_id, id) ON DELETE CASCADE
      )
    `);

    const setExpression = (column, fallback) => lockedSetColumnNames.has(column) ? column : fallback;
    await tx.run(`
      INSERT INTO vocab_sets_new (id, user_id, title, description, streak_count, last_streak_date, created_at, updated_at)
      SELECT id, user_id, title,
             ${setExpression('description', "''")},
             ${setExpression('streak_count', '0')},
             ${setExpression('last_streak_date', 'NULL')},
             ${setExpression('created_at', 'NULL')},
             ${setExpression('updated_at', 'NULL')}
      FROM vocab_sets
    `);

    const cardExpression = (column, fallback) => lockedCardColumnNames.has(column) ? column : fallback;
    await tx.run(`
      INSERT INTO cards_new (id, set_id, english, vietnamese, example, example_translation, position)
      SELECT id, set_id, english, vietnamese,
             ${cardExpression('example', "''")},
             ${cardExpression('example_translation', "''")},
             ${cardExpression('position', '0')}
      FROM cards
    `);

    const progressExpression = (column, fallback) => lockedProgressColumnNames.has(column) ? column : fallback;
    await tx.run(`
      INSERT INTO card_progress_new (user_id, set_id, card_id, correct, wrong, updated_at)
      SELECT user_id, set_id, card_id,
             CASE
               WHEN ${progressExpression('correct', '0')} < 0 THEN 0
               WHEN ${progressExpression('correct', '0')} > 2147483647 THEN 2147483647
               ELSE COALESCE(${progressExpression('correct', '0')}, 0)
             END,
             CASE
               WHEN ${progressExpression('wrong', '0')} < 0 THEN 0
               WHEN ${progressExpression('wrong', '0')} > 2147483647 THEN 2147483647
               ELSE COALESCE(${progressExpression('wrong', '0')}, 0)
             END,
             ${progressExpression('updated_at', 'NULL')}
      FROM card_progress
    `);

    const existingCards = await tx.query(
      'SELECT id, set_id, english, vietnamese, example, example_translation FROM cards_new'
    );
    const usedCardIds = new Map(existingCards.map(card => [card.id, card.set_id]));
    const existingCardsById = new Map(existingCards.map(card => [card.id, card]));
    const claimedLegacyIds = new Set();
    for (const set of parsedLegacySets) {
      for (let index = 0; index < set.parsedCards.length; index += 1) {
        const card = set.parsedCards[index];
        let cardId = chooseLegacyCardId(usedCardIds, set.id, card.id, index);
        const conflictingCard = existingCardsById.get(cardId);
        if (conflictingCard && !legacyCardMatches(conflictingCard, card)) {
          cardId = chooseLegacyCardId(usedCardIds, set.id, null, index);
        }
        const claimKey = `${set.id}\0${cardId}`;
        if (claimedLegacyIds.has(claimKey)) {
          cardId = chooseLegacyCardId(usedCardIds, set.id, null, index);
        }
        claimedLegacyIds.add(`${set.id}\0${cardId}`);

        const normalizedCard = {
          id: cardId,
          set_id: set.id,
          english: card.english.trim(),
          vietnamese: card.vietnamese.trim(),
          example: typeof card.example === 'string' ? card.example : '',
          example_translation: typeof card.exampleTranslation === 'string' ? card.exampleTranslation : ''
        };
        existingCardsById.set(cardId, normalizedCard);

        await tx.run(
          `INSERT INTO cards_new (id, set_id, english, vietnamese, example, example_translation, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             english = excluded.english,
             vietnamese = excluded.vietnamese,
             example = excluded.example,
             example_translation = excluded.example_translation,
             position = excluded.position
           WHERE cards_new.set_id = excluded.set_id`,
          [
            cardId,
            set.id,
            normalizedCard.english,
            normalizedCard.vietnamese,
            normalizedCard.example,
            normalizedCard.example_translation,
            index
          ]
        );

        const stats = getLegacyCardStats(card);
        if (stats.correct || stats.wrong) {
          await tx.run(
            `INSERT INTO card_progress_new (user_id, set_id, card_id, correct, wrong, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
               correct = CASE WHEN excluded.correct > card_progress_new.correct THEN excluded.correct ELSE card_progress_new.correct END,
               wrong = CASE WHEN excluded.wrong > card_progress_new.wrong THEN excluded.wrong ELSE card_progress_new.wrong END,
               updated_at = CASE WHEN excluded.updated_at > card_progress_new.updated_at THEN excluded.updated_at ELSE card_progress_new.updated_at END`,
            [set.user_id, set.id, cardId, stats.correct, stats.wrong, Date.now()]
          );
        }
      }
    }

    await tx.run('DROP TABLE card_progress');
    await tx.run('DROP TABLE cards');
    await tx.run('DROP TABLE vocab_sets');
    await tx.run('ALTER TABLE vocab_sets_new RENAME TO vocab_sets');
    await tx.run('ALTER TABLE cards_new RENAME TO cards');
    await tx.run('ALTER TABLE card_progress_new RENAME TO card_progress');

    const foreignKeyViolations = await tx.query('PRAGMA foreign_key_check');
    if (foreignKeyViolations.length) {
      throw new Error(`Foreign-key validation failed after migration (${foreignKeyViolations.length} violation(s)).`);
    }
  }, { foreignKeys: false });
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const migratePostgresRelationalSchema = async () => {
  // Version 5 is written only after the relational constraints and integrity
  // checks complete. Avoid taking ACCESS EXCLUSIVE locks on every healthy
  // production restart once that migration has succeeded.
  const applied = await query('SELECT version FROM schema_migrations WHERE version = ?', [LATEST_SCHEMA_VERSION]);
  if (applied.length > 0) return;

  return withTransaction(async (tx) => {
  // Block writes from an old live replica before taking the legacy JSON
  // snapshot. The column is dropped only inside this same transaction.
  await tx.run('LOCK TABLE vocab_sets, cards, card_progress IN ACCESS EXCLUSIVE MODE');

  const [setColumns, primaryKeyRows, foreignKeys, uniqueConstraints] = await Promise.all([
    tx.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'vocab_sets'
    `),
    tx.query(`
      SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = current_schema()
        AND tc.table_name = 'card_progress'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `),
    tx.query(`
      SELECT con.conname AS constraint_name,
             child.relname AS table_name,
             parent.relname AS foreign_table_name,
             ARRAY(
               SELECT child_att.attname
               FROM unnest(con.conkey) WITH ORDINALITY AS key_item(attnum, ord)
               JOIN pg_attribute child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = key_item.attnum
               ORDER BY key_item.ord
             )::text[] AS columns,
             ARRAY(
               SELECT parent_att.attname
               FROM unnest(con.confkey) WITH ORDINALITY AS key_item(attnum, ord)
               JOIN pg_attribute parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = key_item.attnum
               ORDER BY key_item.ord
             )::text[] AS foreign_columns,
             CASE con.confdeltype WHEN 'c' THEN 'CASCADE' ELSE con.confdeltype::text END AS delete_rule
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
      WHERE namespace.nspname = current_schema()
        AND con.contype = 'f'
        AND child.relname IN ('vocab_sets', 'cards', 'card_progress')
    `),
    tx.query(`
      SELECT tc.table_name, tc.constraint_name,
             ARRAY_AGG(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = current_schema()
        AND tc.table_name IN ('vocab_sets', 'cards')
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      GROUP BY tc.table_name, tc.constraint_name
    `)
  ]);

  const setColumnNames = new Set(setColumns.map(column => column.column_name));
  const hasLegacyCards = setColumnNames.has('cards');
  const primaryKey = primaryKeyRows.map(row => row.column_name).join(',');
  const arraysEqual = (left, right) => Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
  const hasCascade = (table, columns, foreignTable, foreignColumns) => foreignKeys.some(fk => (
    fk.table_name === table
    && fk.foreign_table_name === foreignTable
    && fk.delete_rule === 'CASCADE'
    && arraysEqual(fk.columns, columns)
    && arraysEqual(fk.foreign_columns, foreignColumns)
  ));
  const hasUnique = (table, columns) => uniqueConstraints.some(constraint => (
    constraint.table_name === table && arraysEqual(constraint.columns, columns)
  ));
  const hasAllCascades = hasCascade('vocab_sets', ['user_id'], 'users', ['id'])
    && hasCascade('cards', ['set_id'], 'vocab_sets', ['id'])
    && hasCascade('card_progress', ['user_id', 'set_id'], 'vocab_sets', ['user_id', 'id'])
    && hasCascade('card_progress', ['set_id', 'card_id'], 'cards', ['set_id', 'id']);
  const hasOwnershipUniques = hasUnique('vocab_sets', ['user_id', 'id'])
    && hasUnique('cards', ['set_id', 'id']);

  if (!hasLegacyCards
    && primaryKey === 'user_id,set_id,card_id'
    && hasAllCascades
    && hasOwnershipUniques) return;

  await assertNoOrphans(tx.query);
  const duplicateProgress = await tx.query(
    `SELECT user_id, set_id, card_id, COUNT(*) AS duplicate_count
     FROM card_progress GROUP BY user_id, set_id, card_id HAVING COUNT(*) > 1 LIMIT 1`
  );
  if (duplicateProgress.length) {
    throw new Error(`Duplicate card progress prevents safe migration: ${duplicateProgress[0].card_id}`);
  }

  const legacySets = hasLegacyCards
    ? await tx.query('SELECT id, user_id, cards FROM vocab_sets WHERE cards IS NOT NULL')
    : [];
  const parsedLegacySets = legacySets.map(set => ({ ...set, parsedCards: parseLegacyCards(set.cards, set.id) }));

  if (primaryKey !== 'user_id,set_id,card_id') {
    const primaryConstraint = primaryKeyRows[0]?.constraint_name;
    if (primaryConstraint) {
      await tx.run(`ALTER TABLE card_progress DROP CONSTRAINT ${quoteIdentifier(primaryConstraint)}`);
    }
    await tx.run(`
      ALTER TABLE card_progress
      ADD CONSTRAINT card_progress_pkey PRIMARY KEY (user_id, set_id, card_id)
    `);
  }

  if (!hasUnique('vocab_sets', ['user_id', 'id'])) {
    await tx.run('ALTER TABLE vocab_sets ADD CONSTRAINT vocab_sets_user_id_id_key UNIQUE (user_id, id)');
  }
  if (!hasUnique('cards', ['set_id', 'id'])) {
    await tx.run('ALTER TABLE cards ADD CONSTRAINT cards_set_id_id_key UNIQUE (set_id, id)');
  }

  const existingCards = await tx.query(
    'SELECT id, set_id, english, vietnamese, example, example_translation FROM cards'
  );
  const usedCardIds = new Map(existingCards.map(card => [card.id, card.set_id]));
  const existingCardsById = new Map(existingCards.map(card => [card.id, card]));
  const claimedLegacyIds = new Set();
  for (const set of parsedLegacySets) {
    for (let index = 0; index < set.parsedCards.length; index += 1) {
      const card = set.parsedCards[index];
      let cardId = chooseLegacyCardId(usedCardIds, set.id, card.id, index);
      const conflictingCard = existingCardsById.get(cardId);
      if (conflictingCard && !legacyCardMatches(conflictingCard, card)) {
        cardId = chooseLegacyCardId(usedCardIds, set.id, null, index);
      }
      const claimKey = `${set.id}\0${cardId}`;
      if (claimedLegacyIds.has(claimKey)) {
        cardId = chooseLegacyCardId(usedCardIds, set.id, null, index);
      }
      claimedLegacyIds.add(`${set.id}\0${cardId}`);

      const normalizedCard = {
        id: cardId,
        set_id: set.id,
        english: card.english.trim(),
        vietnamese: card.vietnamese.trim(),
        example: typeof card.example === 'string' ? card.example : '',
        example_translation: typeof card.exampleTranslation === 'string' ? card.exampleTranslation : ''
      };
      existingCardsById.set(cardId, normalizedCard);

      await tx.run(
        `INSERT INTO cards (id, set_id, english, vietnamese, example, example_translation, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           english = EXCLUDED.english,
           vietnamese = EXCLUDED.vietnamese,
           example = EXCLUDED.example,
           example_translation = EXCLUDED.example_translation,
           position = EXCLUDED.position
         WHERE cards.set_id = EXCLUDED.set_id`,
        [
          cardId,
          set.id,
          normalizedCard.english,
          normalizedCard.vietnamese,
          normalizedCard.example,
          normalizedCard.example_translation,
          index
        ]
      );

      const stats = getLegacyCardStats(card);
      if (stats.correct || stats.wrong) {
        await tx.run(
          `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
             correct = GREATEST(card_progress.correct, EXCLUDED.correct),
             wrong = GREATEST(card_progress.wrong, EXCLUDED.wrong),
             updated_at = GREATEST(COALESCE(card_progress.updated_at, 0), EXCLUDED.updated_at)`,
          [set.user_id, set.id, cardId, stats.correct, stats.wrong, Date.now()]
        );
      }
    }
  }

  if (hasLegacyCards) {
    await tx.run('ALTER TABLE vocab_sets DROP COLUMN cards');
  }

  for (const foreignKey of foreignKeys) {
    await tx.run(
      `ALTER TABLE ${quoteIdentifier(foreignKey.table_name)} DROP CONSTRAINT ${quoteIdentifier(foreignKey.constraint_name)}`
    );
  }
  for (const [table, name, columns, foreignTable, foreignColumns] of [
    ['vocab_sets', 'vocab_sets_user_id_fkey', ['user_id'], 'users', ['id']],
    ['cards', 'cards_set_id_fkey', ['set_id'], 'vocab_sets', ['id']],
    ['card_progress', 'card_progress_user_set_fkey', ['user_id', 'set_id'], 'vocab_sets', ['user_id', 'id']],
    ['card_progress', 'card_progress_set_card_fkey', ['set_id', 'card_id'], 'cards', ['set_id', 'id']]
  ]) {
    await tx.run(`ALTER TABLE ${quoteIdentifier(table)} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(name)}`);
    await tx.run(
      `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(name)}
       FOREIGN KEY (${columns.map(quoteIdentifier).join(', ')})
       REFERENCES ${quoteIdentifier(foreignTable)} (${foreignColumns.map(quoteIdentifier).join(', ')})
       ON DELETE CASCADE`
    );
  }
  });
};

export const initDb = async () => {
  let migrationLockClient = null;
  if (isPg) {
    migrationLockClient = await pgPool.connect();
  }

  try {
    if (migrationLockClient) {
      await migrationLockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    }

  if (!isPg) {
    if (!sqliteDb) {
      sqliteDb = await openSqliteConnection();
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
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        streak_count INTEGER NOT NULL DEFAULT 0,
        last_study_date VARCHAR(10),
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
        is_admin INTEGER NOT NULL DEFAULT 0,
        streak_count INTEGER NOT NULL DEFAULT 0,
        last_study_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (isPg) {
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1`);
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`);
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0`);
    await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_study_date VARCHAR(10)`);
  } else {
    const userColumns = await query(`PRAGMA table_info(users)`);
    if (!userColumns.some(column => column.name === 'token_version')) {
      await run(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1`);
    }
    if (!userColumns.some(column => column.name === 'is_admin')) {
      await run(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userColumns.some(column => column.name === 'streak_count')) {
      await run(`ALTER TABLE users ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userColumns.some(column => column.name === 'last_study_date')) {
      await run(`ALTER TABLE users ADD COLUMN last_study_date TEXT`);
    }
  }
  await run(`UPDATE users SET streak_count = 0 WHERE streak_count IS NULL OR streak_count < 0`);

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
      UNIQUE (user_id, id),
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
      UNIQUE (set_id, id),
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

  if (isPg) {
    await migratePostgresRelationalSchema();
  } else {
    await migrateSqliteRelationalSchema();
  }

  // Carry forward the old per-set streak once, if an installation used it.
  // New learning activity is recorded exclusively on the owning user account.
  await run(`
    UPDATE users
    SET streak_count = COALESCE((
          SELECT MAX(CASE WHEN s.streak_count < 0 THEN 0 ELSE COALESCE(s.streak_count, 0) END)
          FROM vocab_sets s WHERE s.user_id = users.id
        ), streak_count),
        last_study_date = COALESCE(last_study_date, (
          SELECT MAX(s.last_streak_date) FROM vocab_sets s WHERE s.user_id = users.id
        ))
    WHERE streak_count = 0
  `);

  // Essential & Composite Database Indexes (Item 52 Fix)
  await run(`CREATE INDEX IF NOT EXISTS idx_vocab_sets_user ON vocab_sets(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cards_set_pos ON cards(set_id, position)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_card_progress_user_set ON card_progress(user_id, set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_card_progress_composite ON card_progress(user_id, set_id, card_id)`);

  // Never silently delete unexpected rows during startup. A failed integrity
  // check stops deployment and leaves the source data available for recovery.
  await assertNoOrphans(query);

  // Record the latest schema migration version.
  if (isPg) {
    await run(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING`,
      [LATEST_SCHEMA_VERSION, Date.now()]
    );
  } else {
    await run(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
      [LATEST_SCHEMA_VERSION, Date.now()]
    );
  }

    console.log(`Database (${isPg ? 'Cloud PostgreSQL' : 'Local SQLite'}) initialized with indexes and migrations.`);
  } finally {
    if (migrationLockClient) {
      try {
        await migrationLockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      } catch (unlockError) {
        console.error('PostgreSQL migration lock release error:', unlockError.message);
      } finally {
        migrationLockClient.release();
      }
    }
  }
};

export default sqliteDb;
