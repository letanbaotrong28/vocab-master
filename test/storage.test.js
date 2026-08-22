import assert from 'node:assert';
import { test } from 'node:test';
import { CardSchema, SetSchema } from '../src/services/schema.js';

// Item 146 Fix: Test real production code directly from src/services/schema.js
test('CardSchema validates correct card objects', () => {
  const validCard = { english: 'hello', vietnamese: 'xin chào' };
  const res = CardSchema.validate(validCard);
  assert.strictEqual(res.valid, true);

  const invalidCard = { english: '', vietnamese: 'xin chào' };
  const invalidRes = CardSchema.validate(invalidCard);
  assert.strictEqual(invalidRes.valid, false);
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
