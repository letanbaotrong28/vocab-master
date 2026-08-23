import express from 'express';
import { isPg, query, withTransaction } from './db.js';
import { authenticateToken } from './authMiddleware.js';
import { resolveCardId, resolveSetId } from './idUtils.js';
import { MutationBusyError, acquireUserMutationLock } from './mutationLock.js';
import { createConcurrencyLimiter, createMemoryRateLimiter } from './rateLimit.js';
import { calculateRecordedStreak, validateClientDate } from './streak.js';

const router = express.Router();

// Apply auth middleware to all set routes
router.use(authenticateToken);

const authenticatedLimitKey = (req) => `user:${req.user.id}`;
const wordStatsRateLimiter = createMemoryRateLimiter({
  maxRequests: 120,
  windowMs: 60000,
  key: authenticatedLimitKey
});
const resetProgressRateLimiter = createMemoryRateLimiter({
  maxRequests: 10,
  windowMs: 60000,
  key: authenticatedLimitKey
});
const syncBatchRateLimiter = createMemoryRateLimiter({
  maxRequests: 40,
  windowMs: 60000,
  key: authenticatedLimitKey
});
const syncBatchConcurrencyLimiter = createConcurrencyLimiter({
  maxConcurrent: 4,
  maxPerKey: 1,
  key: authenticatedLimitKey
});

class RequestValidationError extends Error {}
class SetConflictError extends Error {
  constructor(setId, message = 'Bộ từ đã được thay đổi ở một phiên khác.') {
    super(message);
    this.name = 'SetConflictError';
    this.setId = setId;
  }
}

const MAX_PROGRESS_COUNT = 2147483647;

const validateId = (value, label) => {
  if (!['string', 'number'].includes(typeof value)) return `${label} không hợp lệ.`;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return `${label} không hợp lệ.`;
  const normalized = String(value).normalize('NFC').trim();
  if (!normalized) return `${label} không được để trống.`;
  if (normalized.includes('\0')) return `${label} chứa ký tự không được hỗ trợ.`;
  if (normalized.length > 1000) return `${label} không được vượt quá 1000 ký tự.`;
  return null;
};

const validateTimestamp = (value) => {
  if (value === undefined || value === null) return null;
  const numericValue = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numericValue) || numericValue < 0 || numericValue > 8640000000000000) {
    return 'createdAt phải là mốc thời gian hợp lệ.';
  }
  return null;
};

const normalizeExpectedUpdatedAt = (value) => {
  if (value === undefined || value === null) return null;
  const numericValue = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(numericValue) && numericValue >= 0
    ? numericValue
    : Number.NaN;
};

const containsNullCharacter = value => typeof value === 'string' && value.includes('\0');

const toTimestamp = (value, fallback = Date.now()) => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const lockUserForMutation = async (tx, userId) => {
  await acquireUserMutationLock(tx, userId, isPg);
  const user = await tx.getOne(
    `SELECT id FROM users WHERE id = ?${isPg ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  if (!user) throw new Error('Authenticated user disappeared during a mutation.');
};

const sendMutationBusy = (res, error) => {
  if (!(error instanceof MutationBusyError)) return false;
  res.status(409).json({ error: error.message, code: error.code, retryable: true });
  return true;
};

// Item 31-34 Fix: Robust backend input validator & length boundaries
const validateSetInput = (id, title, description, cards, createdAt) => {
  const setIdError = validateId(id, 'ID bộ từ vựng');
  if (setIdError) return setIdError;
  const timestampError = validateTimestamp(createdAt);
  if (timestampError) return timestampError;
  if (typeof title !== 'string' || !title.trim()) {
    return 'Tên bộ từ vựng phải là chuỗi ký tự hợp lệ.';
  }
  if (containsNullCharacter(title) || containsNullCharacter(description)) {
    return 'Tên hoặc mô tả bộ từ chứa ký tự không được hỗ trợ.';
  }
  if (title.trim().length > 250) {
    return 'Tên bộ từ vựng không được vượt quá 250 ký tự.';
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return 'Mô tả bộ từ vựng phải là chuỗi ký tự.';
  }
  if (typeof description === 'string' && description.length > 1000) {
    return 'Mô tả bộ từ vựng không được vượt quá 1000 ký tự.';
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    return 'Bộ từ vựng cần có ít nhất 1 thẻ từ hợp lệ.';
  }
  if (cards.length > 1000) {
    return 'Số lượng thẻ tối đa trong một bộ từ là 1000 thẻ.';
  }
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!c || typeof c !== 'object') return `Thẻ số ${i + 1} không hợp lệ.`;
    if (typeof c.english !== 'string' || !c.english.trim()) return `Thẻ số ${i + 1} thiếu từ tiếng Anh.`;
    if (typeof c.vietnamese !== 'string' || !c.vietnamese.trim()) return `Thẻ số ${i + 1} thiếu nghĩa tiếng Việt.`;
    if (c.english.trim().length > 500 || c.vietnamese.trim().length > 500) return `Từ vựng ở thẻ số ${i + 1} vượt quá 500 ký tự.`;
    if (c.example !== undefined && c.example !== null && typeof c.example !== 'string') return `Ví dụ ở thẻ số ${i + 1} phải là chuỗi ký tự.`;
    if (typeof c.example === 'string' && c.example.length > 1000) return `Ví dụ ở thẻ số ${i + 1} vượt quá 1000 ký tự.`;
    if (c.exampleTranslation !== undefined && c.exampleTranslation !== null && typeof c.exampleTranslation !== 'string') return `Bản dịch ví dụ ở thẻ số ${i + 1} phải là chuỗi ký tự.`;
    if (typeof c.exampleTranslation === 'string' && c.exampleTranslation.length > 1000) return `Bản dịch ví dụ ở thẻ số ${i + 1} vượt quá 1000 ký tự.`;
    if ([c.english, c.vietnamese, c.example, c.exampleTranslation].some(containsNullCharacter)) {
      return `Thẻ số ${i + 1} chứa ký tự không được hỗ trợ.`;
    }
    const cardIdError = validateId(c.id, `ID ở thẻ số ${i + 1}`);
    if (cardIdError) return cardIdError;
    if (c.stats !== undefined && c.stats !== null) {
      if (typeof c.stats !== 'object' || Array.isArray(c.stats)) {
        return `Thống kê ở thẻ số ${i + 1} không hợp lệ.`;
      }
      for (const field of ['correct', 'wrong']) {
        const value = c.stats[field];
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > MAX_PROGRESS_COUNT)) {
          return `Thống kê ${field} ở thẻ số ${i + 1} phải là số nguyên từ 0 đến ${MAX_PROGRESS_COUNT}.`;
        }
      }
    }
  }
  return null;
};

const rowsToSets = (rows) => {
  const setsMap = new Map();
  for (const row of rows) {
    if (!setsMap.has(row.set_id)) {
      setsMap.set(row.set_id, {
        id: row.set_id,
        title: row.title,
        description: row.description || '',
        cards: [],
        createdAt: toTimestamp(row.created_at),
        updatedAt: toTimestamp(row.updated_at)
      });
    }

    if (row.card_id) {
      setsMap.get(row.set_id).cards.push({
        id: row.card_id,
        english: row.english,
        vietnamese: row.vietnamese,
        example: row.example || '',
        exampleTranslation: row.example_translation || '',
        stats: {
          correct: Math.max(0, Number.parseInt(row.correct, 10) || 0),
          wrong: Math.max(0, Number.parseInt(row.wrong, 10) || 0)
        }
      });
    }
  }
  return Array.from(setsMap.values());
};

const getUserSets = async (userId, setId = null) => {
  const rows = await query(
    `SELECT s.id as set_id, s.title, s.description, s.created_at, s.updated_at,
            c.id as card_id, c.english, c.vietnamese, c.example, c.example_translation as example_translation, c.position,
            COALESCE(cp.correct, 0) as correct, COALESCE(cp.wrong, 0) as wrong
     FROM vocab_sets s
     LEFT JOIN cards c ON c.set_id = s.id
     LEFT JOIN card_progress cp ON cp.user_id = s.user_id AND cp.set_id = s.id AND cp.card_id = c.id
     WHERE s.user_id = ?${setId ? ' AND s.id = ?' : ''}
     ORDER BY s.updated_at DESC, c.position ASC`,
    setId ? [userId, setId] : [userId]
  );
  return rowsToSets(rows);
};

const prepareIncomingCards = async (tx, setId, cards) => {
  const prepared = [];
  const cardIds = new Set();
  for (let index = 0; index < cards.length; index += 1) {
    const source = cards[index];
    const id = await resolveCardId(tx, setId, source.id);
    if (cardIds.has(id)) {
      throw new RequestValidationError(`Hai thẻ trong cùng bộ không được dùng chung ID (thẻ số ${index + 1}).`);
    }
    cardIds.add(id);
    prepared.push({
      ...source,
      id,
      english: source.english.trim(),
      vietnamese: source.vietnamese.trim(),
      example: (source.example || '').trim(),
      exampleTranslation: (source.exampleTranslation || '').trim()
    });
  }
  return prepared;
};

const contentMatches = async (tx, existingSet, title, description, preparedCards) => {
  if (existingSet.title !== title.trim() || existingSet.description !== (description || '').trim()) return false;
  const currentCards = await tx.query(
    `SELECT id, english, vietnamese, example, example_translation, position
     FROM cards WHERE set_id = ? ORDER BY position ASC`,
    [existingSet.id]
  );
  if (currentCards.length !== preparedCards.length) return false;
  return currentCards.every((current, index) => {
    const incoming = preparedCards[index];
    return current.id === incoming.id
      && current.english === incoming.english
      && current.vietnamese === incoming.vietnamese
      && (current.example || '') === incoming.example
      && (current.example_translation || '') === incoming.exampleTranslation
      && Number(current.position) === index;
  });
};

const conflictResponse = (res, currentSet = null) => res.status(409).json({
  error: 'Bộ từ đã được thay đổi ở một phiên khác. Vui lòng tải lại dữ liệu mới nhất.',
  code: 'SET_CONFLICT',
  ...(currentSet ? { currentSet } : {})
});

// Item 44 & 45 Fix: Single 3-way JOIN query eliminates N+1 queries & explicit column selection
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    return res.json({ sets: await getUserSets(userId) });
  } catch (err) {
    if (sendMutationBusy(res, err)) return;
    console.error('Get sets error:', err);
    return res.status(500).json({ error: 'Lỗi khi tải bộ từ vựng.' });
  }
});

// Item 31-36, 70, 74, 75: Save or Update single set with strict validation, scoped cards & orphan cleanup
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id, title, description, cards, createdAt, expectedUpdatedAt } = req.body || {};

    const validationErr = validateSetInput(id, title, description, cards, createdAt);
    if (validationErr) {
      return res.status(400).json({ error: validationErr });
    }
    const expectedRevision = normalizeExpectedUpdatedAt(expectedUpdatedAt);
    if (Number.isNaN(expectedRevision)) {
      return res.status(400).json({ error: 'expectedUpdatedAt phải là mốc thời gian hợp lệ.' });
    }

    const now = Date.now();
    const createdTime = toTimestamp(createdAt, now);
    let savedSetId = null;

    await withTransaction(async (tx) => {
      await lockUserForMutation(tx, userId);
      const setObjId = await resolveSetId(tx, userId, id);
      savedSetId = setObjId;
      const existing = await tx.getOne(
        `SELECT id, title, description, created_at, updated_at FROM vocab_sets
         WHERE id = ? AND user_id = ?${isPg ? ' FOR UPDATE' : ''}`,
        [setObjId, userId]
      );
      const preparedCards = await prepareIncomingCards(tx, setObjId, cards);

      if (existing) {
        const isSameContent = await contentMatches(tx, existing, title, description, preparedCards);
        if (expectedRevision !== Number(existing.updated_at)) {
          if (isSameContent) return;
          throw new SetConflictError(setObjId);
        }
        if (isSameContent) return;
      }

      const nextRevision = existing
        ? Math.max(now, Number(existing.updated_at) + 1)
        : now;

      if (existing) {
        await tx.run(
          `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [title.trim(), (description || '').trim(), nextRevision, setObjId, userId]
        );
      } else {
        await tx.run(
          `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [setObjId, userId, title.trim(), (description || '').trim(), createdTime, nextRevision]
        );
      }

      const cardIdSet = new Set();

      for (let i = 0; i < preparedCards.length; i++) {
        const c = preparedCards[i];
        const cardId = c.id;
        cardIdSet.add(cardId);

        await tx.run(
          `INSERT INTO cards (id, set_id, english, vietnamese, example, example_translation, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             english = excluded.english,
             vietnamese = excluded.vietnamese,
             example = excluded.example,
             example_translation = excluded.example_translation,
             position = excluded.position
           WHERE cards.set_id = excluded.set_id`,
          [cardId, setObjId, c.english, c.vietnamese, c.example, c.exampleTranslation, i]
        );

        if (c.stats) {
          const correctCount = c.stats.correct ?? 0;
          const wrongCount = c.stats.wrong ?? 0;
          if (correctCount > 0 || wrongCount > 0) {
            await tx.run(
              `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
                 correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                 wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                 updated_at = excluded.updated_at`,
              [userId, setObjId, cardId, correctCount, wrongCount, nextRevision]
            );
          }
        }
      }

      if (cardIdSet.size > 0) {
        const placeholders = Array.from(cardIdSet).map(() => '?').join(',');
        await tx.run(
          `DELETE FROM card_progress WHERE set_id = ? AND card_id NOT IN (${placeholders})`,
          [setObjId, ...Array.from(cardIdSet)]
        );
        await tx.run(
          `DELETE FROM cards WHERE set_id = ? AND id NOT IN (${placeholders})`,
          [setObjId, ...Array.from(cardIdSet)]
        );
      } else {
        await tx.run(`DELETE FROM card_progress WHERE set_id = ?`, [setObjId]);
        await tx.run(`DELETE FROM cards WHERE set_id = ?`, [setObjId]);
      }
    });

    const [savedSet] = await getUserSets(userId, savedSetId);
    return res.json({ message: 'Đã lưu bộ từ vựng thành công.', setId: savedSetId, set: savedSet });
  } catch (err) {
    if (err instanceof SetConflictError) {
      const [currentSet] = await getUserSets(req.user.id, err.setId).catch(() => []);
      return conflictResponse(res, currentSet);
    }
    if (err instanceof RequestValidationError) {
      return res.status(400).json({ error: err.message, code: 'ID_COLLISION' });
    }
    console.error('Save set error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi lưu bộ từ vựng.' });
  }
});

// Item 33, 37, 72: Sync/batch insert local sets with validation, withTransaction & scoped cards
router.post('/sync-batch', syncBatchRateLimiter, syncBatchConcurrencyLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sets } = req.body || {};

    if (!Array.isArray(sets)) {
      return res.status(400).json({ error: 'Danh sách bộ từ không hợp lệ.' });
    }
    if (sets.length === 0 || sets.length > 200) {
      return res.status(400).json({ error: 'Mỗi lần đồng bộ phải có từ 1 đến 200 bộ từ vựng.' });
    }

    for (let i = 0; i < sets.length; i++) {
      const setItem = sets[i];
      if (!setItem || typeof setItem !== 'object') {
        return res.status(400).json({ error: `Bộ từ số ${i + 1} không hợp lệ.` });
      }
      const validationErr = validateSetInput(setItem.id, setItem.title, setItem.description, setItem.cards, setItem.createdAt);
      if (validationErr) {
        return res.status(400).json({ error: `Bộ từ số ${i + 1}: ${validationErr}` });
      }
      if (Number.isNaN(normalizeExpectedUpdatedAt(setItem.expectedUpdatedAt))) {
        return res.status(400).json({ error: `Bộ từ số ${i + 1}: expectedUpdatedAt không hợp lệ.` });
      }
    }

    await withTransaction(async (tx) => {
      await lockUserForMutation(tx, userId);
      const syncedSetIds = new Set();
      for (const setItem of sets) {
        const setObjId = await resolveSetId(tx, userId, setItem.id);
        if (syncedSetIds.has(setObjId)) {
          throw new RequestValidationError('Danh sách đồng bộ chứa hai bộ từ vựng dùng chung ID.');
        }
        syncedSetIds.add(setObjId);
        const createdTime = toTimestamp(setItem.createdAt);
        const now = Date.now();
        const expectedRevision = normalizeExpectedUpdatedAt(setItem.expectedUpdatedAt);

        const existing = await tx.getOne(
          `SELECT id, title, description, created_at, updated_at FROM vocab_sets
           WHERE id = ? AND user_id = ?${isPg ? ' FOR UPDATE' : ''}`,
          [setObjId, userId]
        );
        const rawCards = Array.isArray(setItem.cards) ? setItem.cards : [];
        const preparedCards = await prepareIncomingCards(tx, setObjId, rawCards);
        if (existing) {
          const isSameContent = await contentMatches(tx, existing, setItem.title, setItem.description, preparedCards);
          if (expectedRevision !== Number(existing.updated_at)) {
            if (isSameContent) continue;
            throw new SetConflictError(setObjId);
          }
          if (isSameContent) continue;
        }
        const nextRevision = existing
          ? Math.max(now, Number(existing.updated_at) + 1)
          : now;
        if (existing) {
          await tx.run(
            `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [setItem.title.trim(), (setItem.description || '').trim(), nextRevision, setObjId, userId]
          );
        } else {
          await tx.run(
            `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [setObjId, userId, setItem.title.trim(), (setItem.description || '').trim(), createdTime, nextRevision]
          );
        }

        const syncedCardIds = new Set();

        for (let i = 0; i < preparedCards.length; i++) {
          const c = preparedCards[i];
          const cardId = c.id;
          syncedCardIds.add(cardId);

          await tx.run(
            `INSERT INTO cards (id, set_id, english, vietnamese, example, example_translation, position)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               english = excluded.english,
               vietnamese = excluded.vietnamese,
               example = excluded.example,
               example_translation = excluded.example_translation,
               position = excluded.position
             WHERE cards.set_id = excluded.set_id`,
            [cardId, setObjId, c.english, c.vietnamese, c.example, c.exampleTranslation, i]
          );

          if (c.stats) {
            const correctCount = c.stats.correct ?? 0;
            const wrongCount = c.stats.wrong ?? 0;
            if (correctCount > 0 || wrongCount > 0) {
              await tx.run(
                `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
                   correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                   wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                   updated_at = excluded.updated_at`,
                [userId, setObjId, cardId, correctCount, wrongCount, nextRevision]
              );
            }
          }
        }

        // Item 37 Fix: Delete local deleted cards in batch sync
        if (syncedCardIds.size > 0) {
          const placeholders = Array.from(syncedCardIds).map(() => '?').join(',');
          await tx.run(
            `DELETE FROM card_progress WHERE set_id = ? AND card_id NOT IN (${placeholders})`,
            [setObjId, ...Array.from(syncedCardIds)]
          );
          await tx.run(
            `DELETE FROM cards WHERE set_id = ? AND id NOT IN (${placeholders})`,
            [setObjId, ...Array.from(syncedCardIds)]
          );
        } else {
          await tx.run(`DELETE FROM card_progress WHERE set_id = ?`, [setObjId]);
          await tx.run(`DELETE FROM cards WHERE set_id = ?`, [setObjId]);
        }
      }
    });

    return res.json({ message: 'Đồng bộ bài học vào tài khoản thành công.', sets: await getUserSets(userId) });
  } catch (err) {
    if (err instanceof SetConflictError) {
      const [currentSet] = await getUserSets(req.user.id, err.setId).catch(() => []);
      return conflictResponse(res, currentSet);
    }
    if (sendMutationBusy(res, err)) return;
    if (err instanceof RequestValidationError) {
      return res.status(400).json({ error: err.message, code: 'ID_COLLISION' });
    }
    console.error('Batch sync error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đồng bộ.' });
  }
});

// Item 43 Fix: Delete set wrapped in transaction
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const setId = req.params.id;
    const expectedRevision = normalizeExpectedUpdatedAt(req.body?.expectedUpdatedAt);

    const setIdError = validateId(setId, 'ID bộ từ vựng');
    if (setIdError) return res.status(400).json({ error: setIdError });
    if (expectedRevision === null || Number.isNaN(expectedRevision)) {
      return res.status(400).json({ error: 'expectedUpdatedAt là bắt buộc khi xóa bộ từ.' });
    }

    let deleted = false;
    await withTransaction(async (tx) => {
      await lockUserForMutation(tx, userId);
      const existing = await tx.getOne(
        `SELECT id, updated_at FROM vocab_sets WHERE id = ? AND user_id = ?${isPg ? ' FOR UPDATE' : ''}`,
        [setId, userId]
      );
      if (!existing) return;
      if (Number(existing.updated_at) !== expectedRevision) throw new SetConflictError(setId);
      const result = await tx.run('DELETE FROM vocab_sets WHERE id = ? AND user_id = ?', [setId, userId]);
      if (result.changes > 0) deleted = true;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Không tìm thấy bộ từ vựng cần xóa.' });
    }

    return res.json({ message: 'Đã xóa bộ từ vựng.' });
  } catch (err) {
    if (err instanceof SetConflictError) {
      const [currentSet] = await getUserSets(req.user.id, err.setId).catch(() => []);
      return conflictResponse(res, currentSet);
    }
    if (sendMutationBusy(res, err)) return;
    console.error('Delete set error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi xóa bộ từ vựng.' });
  }
});

// Item 39-41, 70, 77: Word stats with composite PK (user_id, set_id, card_id)
router.post('/word-stats', wordStatsRateLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId, cardId, isCorrect, studyDate } = req.body || {};

    const setIdError = validateId(setId, 'setId');
    if (setIdError) return res.status(400).json({ error: setIdError });
    const cardIdError = validateId(cardId, 'cardId');
    if (cardIdError) return res.status(400).json({ error: cardIdError });
    if (typeof isCorrect !== 'boolean') {
      return res.status(400).json({ error: 'isCorrect phải là giá trị boolean.' });
    }

    const dateResult = validateClientDate(studyDate);
    if (dateResult.error) {
      return res.status(400).json({ error: dateResult.error, code: 'INVALID_STUDY_DATE' });
    }

    const now = Date.now();
    let cardExists = false;
    let streak = null;
    await withTransaction(async (tx) => {
      await acquireUserMutationLock(tx, userId, isPg);
      const user = await tx.getOne(
        `SELECT streak_count, last_study_date FROM users WHERE id = ?${isPg ? ' FOR UPDATE' : ''}`,
        [userId]
      );
      if (!user) throw new Error('Authenticated user disappeared while recording progress.');

      const ownedSet = await tx.getOne(
        `SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?${isPg ? ' FOR UPDATE' : ''}`,
        [setId, userId]
      );
      if (!ownedSet) return;
      const card = await tx.getOne(
        `SELECT id FROM cards WHERE id = ? AND set_id = ?${isPg ? ' FOR UPDATE' : ''}`,
        [cardId, setId]
      );
      if (!card) return;
      cardExists = true;

      if (isCorrect) {
        await tx.run(
          `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
           VALUES (?, ?, ?, 1, 0, ?)
           ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
             correct = CASE
               WHEN card_progress.correct >= ${MAX_PROGRESS_COUNT} THEN ${MAX_PROGRESS_COUNT}
               ELSE card_progress.correct + 1
             END,
             updated_at = excluded.updated_at`,
          [userId, setId, cardId, now]
        );
      } else {
        await tx.run(
          `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
           VALUES (?, ?, ?, 0, 1, ?)
           ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
             wrong = CASE
               WHEN card_progress.wrong >= ${MAX_PROGRESS_COUNT} THEN ${MAX_PROGRESS_COUNT}
               ELSE card_progress.wrong + 1
             END,
             updated_at = excluded.updated_at`,
          [userId, setId, cardId, now]
        );
      }

      streak = calculateRecordedStreak(user.streak_count, user.last_study_date, dateResult.date);
      await tx.run(
        'UPDATE users SET streak_count = ?, last_study_date = ? WHERE id = ?',
        [streak.count, streak.lastStudyDate, userId]
      );
    });

    if (!cardExists) {
      return res.status(404).json({ error: 'Không tìm thấy thẻ từ vựng hoặc bạn không có quyền truy cập.' });
    }

    return res.json({ success: true, message: 'Đã cập nhật tiến trình từ vựng nguyên tử.', streak });
  } catch (err) {
    if (sendMutationBusy(res, err)) return;
    console.error('Word stats error:', err);
    return res.status(500).json({ error: 'Lỗi cập nhật tiến trình.' });
  }
});

// Item 42 Fix: Reset progress validates non-existent setId and returns 404
router.post('/reset-progress', resetProgressRateLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId } = req.body || {};

    if (setId !== 'all') {
      const setIdError = validateId(setId, 'setId');
      if (setIdError) return res.status(400).json({ error: setIdError });
    }

    const now = Date.now();

    let setExists = setId === 'all';
    await withTransaction(async (tx) => {
      await lockUserForMutation(tx, userId);
      if (setId === 'all') {
        await tx.run('UPDATE card_progress SET correct = 0, wrong = 0, updated_at = ? WHERE user_id = ?', [now, userId]);
      } else {
        const existing = await tx.getOne(
          `SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?${isPg ? ' FOR UPDATE' : ''}`,
          [setId, userId]
        );
        if (!existing) return;
        setExists = true;
        await tx.run('UPDATE card_progress SET correct = 0, wrong = 0, updated_at = ? WHERE user_id = ? AND set_id = ?', [now, userId, setId]);
      }
    });

    if (!setExists) {
      return res.status(404).json({ error: 'Không tìm thấy bộ từ vựng cần đặt lại tiến trình.' });
    }

    return res.json({ message: 'Đã đặt lại tiến trình học.' });
  } catch (err) {
    if (sendMutationBusy(res, err)) return;
    console.error('Reset progress error:', err);
    return res.status(500).json({ error: 'Lỗi khi đặt lại tiến trình.' });
  }
});

export default router;
