import assert from 'node:assert';
import { test } from 'node:test';
import { CardSchema, SetSchema, parseBatchVocabulary, parseDelimitedLine } from '../src/services/schema.js';
import { sanitizeResourceId, storageService } from '../src/services/storage.js';

// Item 146 Fix: Test real production code directly from src/services/schema.js
test('CardSchema validates correct card objects', () => {
  const validCard = { english: 'hello', vietnamese: 'xin chào' };
  const res = CardSchema.validate(validCard);
  assert.strictEqual(res.valid, true);

  const invalidCard = { english: '', vietnamese: 'xin chào' };
  const invalidRes = CardSchema.validate(invalidCard);
  assert.strictEqual(invalidRes.valid, false);

  assert.strictEqual(CardSchema.validate({
    english: 'hello',
    vietnamese: 'xin chào',
    stats: { correct: 1.5, wrong: 0 }
  }).valid, false);
  assert.strictEqual(CardSchema.validate({
    english: 'hello',
    vietnamese: 'xin chào',
    stats: { correct: 2147483648, wrong: 0 }
  }).valid, false);
});

test('SetSchema validates correct set objects and requires min 1 card', () => {
  const validSet = {
    title: 'English Vocabulary',
    cards: [{ english: 'apple', vietnamese: 'quả táo' }]
  };
  const res = SetSchema.validate(validSet);
  assert.strictEqual(res.valid, true);

  const emptySet = {
    title: 'Empty Set',
    cards: []
  };
  const emptyRes = SetSchema.validate(emptySet);
  assert.strictEqual(emptyRes.valid, false);
});

const normalize = (str) => {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[-_]/g, ' ')
    .replace(/[.,/#!$%^&*;:{}=`~()?"'’]/g, '')
    .replace(/\s+/g, ' ');
};

test('Normalize hyphenated words to space separated words', () => {
  assert.strictEqual(normalize('well-known'), 'well known');
  assert.strictEqual(normalize('state-of-the-art'), 'state of the art');
});

test('Normalize string stripping punctuation and extra spaces', () => {
  assert.strictEqual(normalize('  Hello, World!?  '), 'hello world');
});

test('batch parser preserves empty cells and quoted delimiters', () => {
  assert.deepStrictEqual(
    parseDelimitedLine('"hello, friend","xin chào, bạn",,"Ví dụ, có phẩy"', ','),
    ['hello, friend', 'xin chào, bạn', '', 'Ví dụ, có phẩy']
  );
  assert.strictEqual(parseBatchVocabulary('hello,,example').length, 0);
  const rows = parseBatchVocabulary('"hello, friend","xin chào, bạn","Hello, friend!","Xin chào, bạn!"');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].english, 'hello, friend');
  assert.strictEqual(rows[0].exampleTranslation, 'Xin chào, bạn!');
});

test('batch parser treats apostrophes inside words as normal text', () => {
  const rows = parseBatchVocabulary("don't | không");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].english, "don't");
});

test('sanitized resource IDs remain deterministic and collision resistant', () => {
  const first = sanitizeResourceId('lesson/a', 'fallback');
  const second = sanitizeResourceId('lesson?a', 'fallback');
  assert.notStrictEqual(first, second);
  assert.strictEqual(first, sanitizeResourceId('lesson/a', 'fallback'));

  const longA = `${'x'.repeat(150)}A`;
  const longB = `${'x'.repeat(150)}B`;
  assert.notStrictEqual(sanitizeResourceId(longA, 'fallback'), sanitizeResourceId(longB, 'fallback'));
});

test('storage failures cannot create a guest streak or crash safe reads', () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };

  try {
    assert.strictEqual(storageService.getTheme(), 'light');
    assert.deepStrictEqual(storageService.getStreak(), { count: 0, lastStudyDate: null });
    assert.ok(Array.isArray(storageService.getSets()));
    assert.throws(
      () => storageService.saveSets([{ id: 'set-1', title: 'Set', cards: [] }]),
      /Bộ nhớ trình duyệt/
    );
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('cached streak belongs only to the matching account', () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };

  try {
    storageService.cacheSession({ id: 10, username: 'first' }, {
      count: 6,
      lastStudyDate: '2026-08-23'
    });
    assert.deepStrictEqual(storageService.getStreak(10), {
      count: 6,
      lastStudyDate: '2026-08-23'
    });
    assert.deepStrictEqual(storageService.getStreak(11), {
      count: 0,
      lastStudyDate: null
    });
    assert.deepStrictEqual(storageService.getStreak(), {
      count: 0,
      lastStudyDate: null
    });
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('editor drafts preserve the server revision used for conflict detection', () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };

  try {
    storageService.saveEditorDraft(7, 'set-1', {
      setId: 'set-1',
      title: 'Draft',
      description: '',
      batchText: '',
      expectedUpdatedAt: 1720000000000,
      cards: [{ id: 'card-1', english: 'hello', vietnamese: 'xin chào' }]
    });
    assert.strictEqual(
      storageService.getEditorDraft(7, 'set-1').expectedUpdatedAt,
      1720000000000
    );
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
