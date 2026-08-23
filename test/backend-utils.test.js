import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCardId, resolveSetId } from '../server/idUtils.js';
import {
  calculateRecordedStreak,
  getStreakSnapshot,
  isValidCalendarDate,
  validateClientDate
} from '../server/streak.js';

const emptyTransaction = {
  getOne: async () => null
};

test('server ids are deterministic and punctuation cannot cause collisions', async () => {
  const firstSet = await resolveSetId(emptyTransaction, 7, 'lesson/a');
  const secondSet = await resolveSetId(emptyTransaction, 7, 'lesson?a');
  assert.notEqual(firstSet, secondSet);
  assert.equal(firstSet, await resolveSetId(emptyTransaction, 7, 'lesson/a'));

  const firstCard = await resolveCardId(emptyTransaction, firstSet, 'card/a');
  const secondCard = await resolveCardId(emptyTransaction, firstSet, 'card?a');
  assert.notEqual(firstCard, secondCard);
  assert.equal(firstCard, await resolveCardId(emptyTransaction, firstSet, 'card/a'));

  await assert.rejects(resolveSetId(emptyTransaction, 7, ''), /valid client set id/);
  await assert.rejects(resolveCardId(emptyTransaction, firstSet, null), /valid client card id/);
});

test('account streak increments once per calendar day and resets after a gap', () => {
  assert.deepEqual(calculateRecordedStreak(0, null, '2026-08-20'), {
    count: 1,
    lastStudyDate: '2026-08-20'
  });
  assert.deepEqual(calculateRecordedStreak(1, '2026-08-20', '2026-08-20'), {
    count: 1,
    lastStudyDate: '2026-08-20'
  });
  assert.deepEqual(calculateRecordedStreak(1, '2026-08-20', '2026-08-21'), {
    count: 2,
    lastStudyDate: '2026-08-21'
  });
  assert.deepEqual(calculateRecordedStreak(0, '2026-08-20', '2026-08-21'), {
    count: 1,
    lastStudyDate: '2026-08-21'
  });
  assert.deepEqual(calculateRecordedStreak(8, '2026-08-20', '2026-08-23'), {
    count: 1,
    lastStudyDate: '2026-08-23'
  });
  assert.deepEqual(calculateRecordedStreak(8, '2026-08-23', '2026-08-22'), {
    count: 8,
    lastStudyDate: '2026-08-23'
  });
});

test('streak dates are strict and account snapshot expires after a missed day', () => {
  assert.equal(isValidCalendarDate('2026-02-29'), false);
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.deepEqual(
    validateClientDate('2026-08-24', new Date('2026-08-23T23:00:00.000Z')),
    { date: '2026-08-24' }
  );
  assert.ok(validateClientDate('2026-08-25', new Date('2026-08-23T23:00:00.000Z')).error);
  assert.deepEqual(getStreakSnapshot(4, '2026-08-22', '2026-08-23'), {
    count: 4,
    lastStudyDate: '2026-08-22'
  });
  assert.deepEqual(getStreakSnapshot(4, '2026-08-21', '2026-08-23'), {
    count: 0,
    lastStudyDate: '2026-08-21'
  });
});
