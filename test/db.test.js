import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sqlite3Package from 'sqlite3';

const sqlite3 = sqlite3Package.default || sqlite3Package;

const seedLegacyDatabase = (databasePath) => new Promise((resolve, reject) => {
  const database = new sqlite3.Database(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token_version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE vocab_sets (
      id VARCHAR(255) PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      cards TEXT NOT NULL,
      streak_count INTEGER DEFAULT 0,
      last_streak_date TEXT,
      created_at BIGINT,
      updated_at BIGINT
    );
    CREATE TABLE cards (
      id VARCHAR(255) PRIMARY KEY,
      set_id VARCHAR(255) NOT NULL,
      english TEXT NOT NULL,
      vietnamese TEXT NOT NULL,
      example TEXT,
      example_translation TEXT,
      position INTEGER DEFAULT 0
    );
    CREATE TABLE card_progress (
      user_id INTEGER NOT NULL,
      set_id VARCHAR(255) NOT NULL,
      card_id VARCHAR(255) NOT NULL,
      correct INTEGER DEFAULT 0,
      wrong INTEGER DEFAULT 0,
      updated_at BIGINT,
      PRIMARY KEY (user_id, card_id)
    );
    INSERT INTO users (id, username, password_hash, token_version) VALUES (1, 'legacy-user', 'hash', 1);
    INSERT INTO vocab_sets (id, user_id, title, description, cards, created_at, updated_at)
      VALUES (
        '1_set',
        1,
        'Legacy set',
        '',
        '[{"id":"1_set_card","english":"hello","vietnamese":"xin chào","example":"Hello there","exampleTranslation":"Xin chào"}]',
        1,
        1
      );
    INSERT INTO cards (id, set_id, english, vietnamese, position)
      VALUES ('1_set_card', '1_set', 'hello', 'xin chào', 0);
    INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
      VALUES (1, '1_set', '1_set_card', 3, 2, 1);
  `, (err) => {
    database.close((closeErr) => {
      if (err || closeErr) reject(err || closeErr);
      else resolve();
    });
  });
});

test('SQLite initialization migrates legacy set/progress schemas safely and preserves data', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vocabmaster-db-test-'));
  const databasePath = path.join(tempDirectory, 'database.db');
  process.env.SQLITE_DB_PATH = databasePath;

  await seedLegacyDatabase(databasePath);

  const db = await import(`../server/db.js?db-test=${Date.now()}`);
  try {
    await db.initDb();

    const progressColumns = await db.query('PRAGMA table_info(card_progress)');
    const primaryKey = progressColumns
      .filter(column => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(column => column.name);
    assert.deepEqual(primaryKey, ['user_id', 'set_id', 'card_id']);

    const userColumns = await db.query('PRAGMA table_info(users)');
    assert.ok(userColumns.some(column => column.name === 'is_admin'));

    const setColumns = await db.query('PRAGMA table_info(vocab_sets)');
    assert.ok(!setColumns.some(column => column.name === 'cards'));

    const migratedCard = await db.getOne('SELECT english, vietnamese FROM cards WHERE id = ?', ['1_set_card']);
    assert.deepEqual(migratedCard, { english: 'hello', vietnamese: 'xin chào' });

    const progress = await db.getOne(
      'SELECT correct, wrong FROM card_progress WHERE user_id = ? AND set_id = ? AND card_id = ?',
      [1, '1_set', '1_set_card']
    );
    assert.deepEqual(progress, { correct: 3, wrong: 2 });

    await assert.rejects(
      db.withTransaction(async (tx) => {
        await tx.run('UPDATE card_progress SET correct = 99 WHERE user_id = 1');
        throw new Error('rollback');
      }),
      /rollback/
    );
    const afterRollback = await db.getOne('SELECT correct FROM card_progress WHERE user_id = 1');
    assert.equal(afterRollback.correct, 3);
  } finally {
    await db.closeDb();
    delete process.env.SQLITE_DB_PATH;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
