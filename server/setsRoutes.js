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

// Item 70: Fetch all sets with relational joined cards and atomic progress stats
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const setRows = await query(
      'SELECT * FROM vocab_sets WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );

    const sets = [];
    for (const setRow of setRows) {
      const cardRows = await query(
        `SELECT c.id, c.english, c.vietnamese, c.example, c.example_translation as exampleTranslation,
                COALESCE(cp.correct, 0) as correct, COALESCE(cp.wrong, 0) as wrong
         FROM cards c
         LEFT JOIN card_progress cp ON cp.card_id = c.id AND cp.user_id = ?
         WHERE c.set_id = ?
         ORDER BY c.position ASC`,
        [userId, setRow.id]
      );

      const cards = cardRows.map(c => ({
        id: c.id,
        english: c.english,
        vietnamese: c.vietnamese,
        example: c.example || '',
        exampleTranslation: c.exampleTranslation || '',
        stats: {
          correct: Math.max(0, parseInt(c.correct) || 0),
          wrong: Math.max(0, parseInt(c.wrong) || 0)
        }
      }));

      sets.push({
        id: setRow.id,
        title: setRow.title,
        description: setRow.description || '',
        cards,
        streak_count: setRow.streak_count || 0,
        last_streak_date: setRow.last_streak_date || null,
        createdAt: setRow.created_at || Date.now(),
        updatedAt: setRow.updated_at || Date.now()
      });
    }

    return res.json({ sets });
  } catch (err) {
    console.error('Get sets error:', err);
    return res.status(500).json({ error: 'Lỗi khi tải bộ từ vựng.' });
  }
});

// Item 70, 74, 75 & P0 Fix (15, 16, 7, 8, 9): Save or Update single set with withTransaction, scoped cards & orphan cleanup
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id, title, description, cards, createdAt } = req.body;

    if (!title || !Array.isArray(cards)) {
      return res.status(400).json({ error: 'Dữ liệu bộ từ vựng không hợp lệ.' });
    }

    const setObjId = getUserSetId(userId, id);
    const now = Date.now();
    const createdTime = typeof createdAt === 'number' ? createdAt : now;

    await withTransaction(async (tx) => {
      const existing = await tx.getOne('SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?', [setObjId, userId]);

      if (existing) {
        await tx.run(
          `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [title, description || '', now, setObjId, userId]
        );
      } else {
        await tx.run(
          `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [setObjId, userId, title, description || '', createdTime, now]
        );
      }

      // Save cards relationally with set-scoped ID (Item 7 & 8 Fix)
      const validCards = cards.filter(c => c.english && c.vietnamese);
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
          [cardId, setObjId, c.english.trim(), c.vietnamese.trim(), c.example || '', c.exampleTranslation || '', i]
        );

        if (c.stats) {
          const correctCount = Math.max(0, parseInt(c.stats.correct) || 0);
          const wrongCount = Math.max(0, parseInt(c.stats.wrong) || 0);
          if (correctCount > 0 || wrongCount > 0) {
            await tx.run(
              `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, card_id) DO UPDATE SET
                  correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                  wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                 updated_at = excluded.updated_at`,
              [userId, setObjId, cardId, correctCount, wrongCount, now]
            );
          }
        }
      }

      // Delete cards that were removed in editor & orphan card_progress (Item 9 Fix)
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

// Item 72 & P0 Fix (15, 16): Sync/batch insert local sets with withTransaction & scoped cards
router.post('/sync-batch', async (req, res) => {
  try {
    const userId = req.user.id;
    const { sets } = req.body;

    if (!Array.isArray(sets)) {
      return res.status(400).json({ error: 'Danh sách bộ từ không hợp lệ.' });
    }

    await withTransaction(async (tx) => {
      for (const setItem of sets) {
        const setObjId = getUserSetId(userId, setItem.id);
        const createdTime = typeof setItem.createdAt === 'number' ? setItem.createdAt : Date.now();
        const now = Date.now();

        const existing = await tx.getOne('SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?', [setObjId, userId]);
        if (existing) {
          await tx.run(
            `UPDATE vocab_sets SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [setItem.title, setItem.description || '', now, setObjId, userId]
          );
        } else {
          await tx.run(
            `INSERT INTO vocab_sets (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [setObjId, userId, setItem.title, setItem.description || '', createdTime, now]
          );
        }

        const rawCards = Array.isArray(setItem.cards) ? setItem.cards : [];
        for (let i = 0; i < rawCards.length; i++) {
          const c = rawCards[i];
          if (!c.english || !c.vietnamese) continue;
          const rawCardId = String(c.id || `card_${i}`).replace(/[\/\?#]/g, '_').trim();
          const cardId = rawCardId.startsWith(`${setObjId}_`) ? rawCardId : `${setObjId}_${rawCardId}`;

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
            [cardId, setObjId, c.english.trim(), c.vietnamese.trim(), c.example || '', c.exampleTranslation || '', i]
          );

          if (c.stats) {
            const correctCount = Math.max(0, parseInt(c.stats.correct) || 0);
            const wrongCount = Math.max(0, parseInt(c.stats.wrong) || 0);
            if (correctCount > 0 || wrongCount > 0) {
              await tx.run(
                `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, card_id) DO UPDATE SET
                   correct = CASE WHEN excluded.correct > card_progress.correct THEN excluded.correct ELSE card_progress.correct END,
                   wrong = CASE WHEN excluded.wrong > card_progress.wrong THEN excluded.wrong ELSE card_progress.wrong END,
                   updated_at = excluded.updated_at`,
                [userId, setObjId, cardId, correctCount, wrongCount, now]
              );
            }
          }
        }
      }
    });

    // Fetch fresh relational sets list
    const setRows = await query('SELECT * FROM vocab_sets WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
    const updatedSetsList = [];

    for (const setRow of setRows) {
      const cardRows = await query(
        `SELECT c.id, c.english, c.vietnamese, c.example, c.example_translation as exampleTranslation,
                COALESCE(cp.correct, 0) as correct, COALESCE(cp.wrong, 0) as wrong
         FROM cards c
         LEFT JOIN card_progress cp ON cp.card_id = c.id AND cp.user_id = ?
         WHERE c.set_id = ?
         ORDER BY c.position ASC`,
        [userId, setRow.id]
      );

      const cards = cardRows.map(c => ({
        id: c.id,
        english: c.english,
        vietnamese: c.vietnamese,
        example: c.example || '',
        exampleTranslation: c.exampleTranslation || '',
        stats: {
          correct: Math.max(0, parseInt(c.correct) || 0),
          wrong: Math.max(0, parseInt(c.wrong) || 0)
        }
      }));

      updatedSetsList.push({
        id: setRow.id,
        title: setRow.title,
        description: setRow.description || '',
        cards,
        createdAt: setRow.created_at,
        updatedAt: setRow.updated_at
      });
    }

    return res.json({ message: 'Đồng bộ bài học vào tài khoản thành công.', sets: updatedSetsList });
  } catch (err) {
    console.error('Batch sync error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đồng bộ.' });
  }
});

// Item 78: Delete a set (Foreign key CASCADE automatically deletes child cards & card_progress)
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const setId = req.params.id;

    const result = await run('DELETE FROM vocab_sets WHERE id = ? AND user_id = ?', [setId, userId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Không tìm thấy bộ từ vựng cần xóa.' });
    }

    return res.json({ message: 'Đã xóa bộ từ vựng.' });
  } catch (err) {
    console.error('Delete set error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi xóa bộ từ vựng.' });
  }
});

// Item 70 & 77 & P0 Fix (10): Set Ownership Verification for Card Progress stats
router.post('/word-stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId, cardId, isCorrect } = req.body;

    const isTrue = isCorrect === true || isCorrect === 'true' || isCorrect === 1;
    const now = Date.now();

    // Verify card exists AND belongs to a set owned by the current logged-in user (Item 10 Fix)
    const card = await getOne(
      `SELECT c.id FROM cards c
       JOIN vocab_sets s ON s.id = c.set_id
       WHERE c.id = ? AND c.set_id = ? AND s.user_id = ?`,
      [cardId, setId, userId]
    );

    if (!card) {
      return res.status(404).json({ error: 'Không tìm thấy thẻ từ vựng hoặc bạn không có quyền truy cập.' });
    }

    // Atomic SQL UPSERT on card_progress table
    if (isTrue) {
      await run(
        `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)
         ON CONFLICT(user_id, card_id) DO UPDATE SET
           correct = card_progress.correct + 1,
           updated_at = excluded.updated_at`,
        [userId, setId, cardId, now]
      );
    } else {
      await run(
        `INSERT INTO card_progress (user_id, set_id, card_id, correct, wrong, updated_at)
         VALUES (?, ?, ?, 0, 1, ?)
         ON CONFLICT(user_id, card_id) DO UPDATE SET
           wrong = card_progress.wrong + 1,
           updated_at = excluded.updated_at`,
        [userId, setId, cardId, now]
      );
    }

    // Update set timestamp
    await run('UPDATE vocab_sets SET updated_at = ? WHERE id = ? AND user_id = ?', [now, setId, userId]);

    return res.json({ message: 'Đã cập nhật tiến trình từ vựng nguyên tử.' });
  } catch (err) {
    console.error('Word stats error:', err);
    return res.status(500).json({ error: 'Lỗi cập nhật tiến trình.' });
  }
});

// Item 73 & P0 Fix (15, 16): Reset progress with withTransaction
router.post('/reset-progress', async (req, res) => {
  try {
    const userId = req.user.id;
    const { setId } = req.body;

    const now = Date.now();
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
