import express from 'express';
import { query, getOne, run, withTransaction } from './db.js';
import { authenticateToken } from './authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all set routes
router.use(authenticateToken);

// Helper to make set ID unique per user
const getUserSetId = (userId, rawId) => {
  if (!rawId) return `${userId}_set_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  return String(rawId).startsWith(`${userId}_`) ? String(rawId) : `${userId}_${rawId}`;
};

// Item 31-34 Fix: Robust backend input validator & length boundaries
const validateSetInput = (title, description, cards) => {
  if (typeof title !== 'string' || !title.trim()) {
    return 'Tên bộ từ vựng phải là chuỗi ký tự hợp lệ.';
  }
  if (title.trim().length > 250) {
    return 'Tên bộ từ vựng không được vượt quá 250 ký tự.';
  }
  if (description && (typeof description !== 'string' || description.length > 1000)) {
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
    if (c.example && (typeof c.example !== 'string' || c.example.length > 1000)) return `Ví dụ ở thẻ số ${i + 1} vượt quá 1000 ký tự.`;
  }
  return null;
};

// Item 44 & 45 Fix: Single 3-way JOIN query eliminates N+1 queries & explicit column selection
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const rows = await query(
      `SELECT s.id as set_id, s.title, s.description, s.streak_count, s.last_streak_date, s.created_at, s.updated_at,
              c.id as card_id, c.english, c.vietnamese, c.example, c.example_translation as example_translation, c.position,
              COALESCE(cp.correct, 0) as correct, COALESCE(cp.wrong, 0) as wrong
       FROM vocab_sets s
       LEFT JOIN cards c ON c.set_id = s.id
       LEFT JOIN card_progress cp ON cp.user_id = s.user_id AND cp.set_id = s.id AND cp.card_id = c.id
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC, c.position ASC`,
      [userId]
    );

    const setsMap = new Map();
    for (const r of rows) {
      if (!setsMap.has(r.set_id)) {
        setsMap.set(r.set_id, {
          id: r.set_id,
          title: r.title,
          description: r.description || '',
          cards: [],
          streak_count: r.streak_count || 0,
          last_streak_date: r.last_streak_date || null,
          createdAt: typeof r.created_at === 'number' ? r.created_at : parseInt(r.created_at, 10) || Date.now(),
          updatedAt: typeof r.updated_at === 'number' ? r.updated_at : parseInt(r.updated_at, 10) || Date.now()
        });
      }

      if (r.card_id) {
        setsMap.get(r.set_id).cards.push({
          id: r.card_id,
          english: r.english,
          vietnamese: r.vietnamese,
          example: r.example || '',
          exampleTranslation: r.example_translation || '',
          stats: {
            correct: Math.max(0, parseInt(r.correct) || 0),
            wrong: Math.max(0, parseInt(r.wrong) || 0)
          }
        });
      }
    }

    const sets = Array.from(setsMap.values());
    return res.json({ sets });
  } catch (err) {
    console.error('Get sets error:', err);
    return res.status(500).json({ error: 'Lỗi khi tải bộ từ vựng.' });
  }
});

// Item 31-36, 70, 74, 75: Save or Update single set with strict validation, scoped cards & orphan cleanup
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id, title, description, cards, createdAt } = req.body;

    const validationErr = validateSetInput(title, description, cards);
    if (validationErr) {
      return res.status(400).json({ error: validationErr });
    }

    const setObjId = getUserSetId(userId, id);
    const now = Date.now();
    const createdTime = typeof createdAt === 'number' ? createdAt : parseInt(createdAt, 10) || now;

    await withTransaction(async (tx) => {
      const existing = await tx.getOne('SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?', [setObjId, userId]);

      if (existing) {
        await tx.run(
          `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [title.trim(), (description || '').trim(), now, setObjId, userId]
        );
      } else {
        await tx.run(
          `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [setObjId, userId, title.trim(), (description || '').trim(), createdTime, now]
        );
      }

      const validCards = cards.filter(c => c && typeof c.english === 'string' && typeof c.vietnamese === 'string' && c.english.trim() && c.vietnamese.trim());
      const cardIdSet = new Set();

      for (let i = 0; i < validCards.length; i++) {
        const c = validCards[i];
        const rawCardId = String(c.id || `card_${i}`).replace(/[\/\?#]/g, '_').trim();
        const cardId = rawCardId.startsWith(`${setObjId}_`) ? rawCardId : `${setObjId}_${rawCardId}`;
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
          [cardId, setObjId, c.english.trim(), c.vietnamese.trim(), (c.example || '').trim(), (c.exampleTranslation || '').trim(), i]
        );

        if (c.stats) {
          const correctCount = Math.max(0, parseInt(c.stats.correct) || 0);
          const wrongCount = Math.max(0, parseInt(c.stats.wrong) || 0);
          if (correctCount > 0 || wrongCount > 0) {
            await tx.run(
              `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
                 correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                 wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                 updated_at = excluded.updated_at`,
              [userId, setObjId, cardId, correctCount, wrongCount, now]
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

    return res.json({ message: 'Đã lưu bộ từ vựng thành công.', setId: setObjId });
  } catch (err) {
    console.error('Save set error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi lưu bộ từ vựng.' });
  }
});

// Item 33, 37, 72: Sync/batch insert local sets with validation, withTransaction & scoped cards
router.post('/sync-batch', async (req, res) => {
  try {
    const userId = req.user.id;
    const { sets } = req.body;

    if (!Array.isArray(sets)) {
      return res.status(400).json({ error: 'Danh sách bộ từ không hợp lệ.' });
    }

    await withTransaction(async (tx) => {
      for (const setItem of sets) {
        if (!setItem || typeof setItem !== 'object' || typeof setItem.title !== 'string' || !setItem.title.trim()) continue;

        const setObjId = getUserSetId(userId, setItem.id);
        const createdTime = typeof setItem.createdAt === 'number' ? setItem.createdAt : parseInt(setItem.createdAt, 10) || Date.now();
        const now = Date.now();

        const existing = await tx.getOne('SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?', [setObjId, userId]);
        if (existing) {
          await tx.run(
            `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [setItem.title.trim(), (setItem.description || '').trim(), now, setObjId, userId]
          );
        } else {
          await tx.run(
            `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [setObjId, userId, setItem.title.trim(), (setItem.description || '').trim(), createdTime, now]
          );
        }

        const rawCards = Array.isArray(setItem.cards) ? setItem.cards : [];
        const syncedCardIds = new Set();

        for (let i = 0; i < rawCards.length; i++) {
          const c = rawCards[i];
          if (!c || typeof c.english !== 'string' || typeof c.vietnamese !== 'string' || !c.english.trim() || !c.vietnamese.trim()) continue;
          const rawCardId = String(c.id || `card_${i}`).replace(/[\/\?#]/g, '_').trim();
          const cardId = rawCardId.startsWith(`${setObjId}_`) ? rawCardId : `${setObjId}_${rawCardId}`;
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
            [cardId, setObjId, c.english.trim(), c.vietnamese.trim(), (c.example || '').trim(), (c.exampleTranslation || '').trim(), i]
          );

          if (c.stats) {
            const correctCount = Math.max(0, parseInt(c.stats.correct) || 0);
            const wrongCount = Math.max(0, parseInt(c.stats.wrong) || 0);
            if (correctCount > 0 || wrongCount > 0) {
              await tx.run(
                `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
                   correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                   wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                   updated_at = excluded.updated_at`,
                [userId, setObjId, cardId, correctCount, wrongCount, now]
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
        }
      }
    });

    // Fetch fresh relational sets list
    const rows = await query(
      `SELECT s.id as set_id, s.title, s.description, s.streak_count, s.last_streak_date, s.created_at, s.updated_at,
              c.id as card_id, c.english, c.vietnamese, c.example, c.example_translation as example_translation, c.position,
              COALESCE(cp.correct, 0) as correct, COALESCE(cp.wrong, 0) as wrong
       FROM vocab_sets s
       LEFT JOIN cards c ON c.set_id = s.id
       LEFT JOIN card_progress cp ON cp.user_id = s.user_id AND cp.set_id = s.id AND cp.card_id = c.id
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC, c.position ASC`,
      [userId]
    );

    const setsMap = new Map();
    for (const r of rows) {
      if (!setsMap.has(r.set_id)) {
        setsMap.set(r.set_id, {
          id: r.set_id,
          title: r.title,
          description: r.description || '',
          cards: [],
          createdAt: typeof r.created_at === 'number' ? r.created_at : parseInt(r.created_at, 10) || Date.now(),
          updatedAt: typeof r.updated_at === 'number' ? r.updated_at : parseInt(r.updated_at, 10) || Date.now()
        });
      }

      if (r.card_id) {
        setsMap.get(r.set_id).cards.push({
          id: r.card_id,
          english: r.english,
          vietnamese: r.vietnamese,
          example: r.example || '',
          exampleTranslation: r.example_translation || '',
          stats: {
            correct: Math.max(0, parseInt(r.correct) || 0),
            wrong: Math.max(0, parseInt(r.wrong) || 0)
          }
        });
      }
    }

    return res.json({ message: 'Đồng bộ bài học vào tài khoản thành công.', sets: Array.from(setsMap.values()) });
  } catch (err) {
    console.error('Batch sync error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đồng bộ.' });
  }
});

// Item 43 Fix: Delete set wrapped in transaction
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const setId = req.params.id;

    let deleted = false;
    await withTransaction(async (tx) => {
      const result = await tx.run('DELETE FROM vocab_sets WHERE id = ? AND user_id = ?', [setId, userId]);
      if (result.changes > 0) deleted = true;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Không tìm thấy bộ từ vựng cần xóa.' });
    }

    return res.json({ message: 'Đã xóa bộ từ vựng.' });
  } catch (err) {
    console.error('Delete set error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi xóa bộ từ vựng.' });
  }
});

// Item 39-41, 70, 77: Word stats with composite PK (user_id, set_id, card_id)
router.post('/word-stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId, cardId, isCorrect } = req.body;

    if (!setId || !cardId) {
      return res.status(400).json({ error: 'Thiếu thông tin setId hoặc cardId.' });
    }

    const isTrue = isCorrect === true || isCorrect === 'true' || isCorrect === 1;
    const now = Date.now();

    const card = await getOne(
      `SELECT c.id FROM cards c
       JOIN vocab_sets s ON s.id = c.set_id
       WHERE c.id = ? AND c.set_id = ? AND s.user_id = ?`,
      [cardId, setId, userId]
    );

    if (!card) {
      return res.status(404).json({ error: 'Không tìm thấy thẻ từ vựng hoặc bạn không có quyền truy cập.' });
    }

    if (isTrue) {
      await run(
        `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)
         ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
           correct = card_progress.correct + 1,
           updated_at = excluded.updated_at`,
        [userId, setId, cardId, now]
      );
    } else {
      await run(
        `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
         VALUES (?, ?, ?, 0, 1, ?)
         ON CONFLICT(user_id, set_id, card_id) DO UPDATE SET
           wrong = card_progress.wrong + 1,
           updated_at = excluded.updated_at`,
        [userId, setId, cardId, now]
      );
    }

    await run('UPDATE vocab_sets SET updated_at = ? WHERE id = ? AND user_id = ?', [now, setId, userId]);

    return res.json({ message: 'Đã cập nhật tiến trình từ vựng nguyên tử.' });
  } catch (err) {
    console.error('Word stats error:', err);
    return res.status(500).json({ error: 'Lỗi cập nhật tiến trình.' });
  }
});

// Item 42 Fix: Reset progress validates non-existent setId and returns 404
router.post('/reset-progress', async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId } = req.body;

    if (!setId) {
      return res.status(400).json({ error: 'Thiếu thông tin setId.' });
    }

    const now = Date.now();

    if (setId !== 'all') {
      const setExist = await getOne('SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?', [setId, userId]);
      if (!setExist) {
        return res.status(404).json({ error: 'Không tìm thấy bộ từ vựng cần đặt lại tiến trình.' });
      }
    }

    await withTransaction(async (tx) => {
      if (setId === 'all') {
        await tx.run('UPDATE card_progress SET correct = 0, wrong = 0, updated_at = ? WHERE user_id = ?', [now, userId]);
        await tx.run('UPDATE vocab_sets SET updated_at = ? WHERE user_id = ?', [now, userId]);
      } else {
        await tx.run('UPDATE card_progress SET correct = 0, wrong = 0, updated_at = ? WHERE user_id = ? AND set_id = ?', [now, userId, setId]);
        await tx.run('UPDATE vocab_sets SET updated_at = ? WHERE id = ? AND user_id = ?', [now, setId, userId]);
      }
    });

    return res.json({ message: 'Đã đặt lại tiến trình học.' });
  } catch (err) {
    console.error('Reset progress error:', err);
    return res.status(500).json({ error: 'Lỗi khi đặt lại tiến trình.' });
  }
});

export default router;
