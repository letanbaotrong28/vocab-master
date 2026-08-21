import assert from 'node:assert';
import { test } from 'node:test';

// Test string normalization function
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

test('Synonym matching for accepted answers', () => {
  const expectedText = 'Hoàn thành, đạt được';
  const acceptedAnswers = expectedText.split(/[,/;/]/).map(ans => normalize(ans)).filter(Boolean);
  
  assert.strictEqual(acceptedAnswers.includes(normalize('Hoàn thành')), true);
  assert.strictEqual(acceptedAnswers.includes(normalize('đạt được')), true);
  assert.strictEqual(acceptedAnswers.includes(normalize('không đúng')), false);
});
