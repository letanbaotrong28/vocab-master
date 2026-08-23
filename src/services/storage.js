import { INITIAL_DEMO_SETS } from '../data/demoSets';
import { SetSchema } from './schema';

const STORAGE_KEY = 'quizlet_vocab_sets_v1';
const INITIALIZED_KEY = 'quizlet_vocab_initialized_v1';
const THEME_KEY = 'quizlet_vocab_theme_v1';
const STREAK_KEY = 'quizlet_vocab_streak_v1';

export const storageService = {
  // Get all sets, distinguish between uninitialized app vs user explicitly deleting all sets (Issue 7 fix)
  getSets: () => {
    try {
      const isInitialized = localStorage.getItem(INITIALIZED_KEY);
      const data = localStorage.getItem(STORAGE_KEY);

      if (!isInitialized || data === null) {
        localStorage.setItem(INITIALIZED_KEY, 'true');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DEMO_SETS));
        return INITIAL_DEMO_SETS;
      }

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
        return [];
      }
      return parsed;
    } catch (err) {
      console.error('Error reading from localStorage:', err);
      // Item 25 Fix: Clear corrupted JSON data permanently to prevent persistent reload errors
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      } catch {}
      return [];
    }
  },

  // Save all sets (Issue 24 fix: throw error if storage quota exceeded or blocked)
  saveSets: (sets) => {
    try {
      localStorage.setItem(INITIALIZED_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    } catch (err) {
      console.error('Error saving to localStorage:', err);
      throw new Error('Bộ nhớ trình duyệt (localStorage) đã đầy hoặc bị chặn. Không thể lưu dữ liệu.');
    }
  },

  // Save raw sets from sync
  saveSetsRaw: (sets) => {
    try {
      localStorage.setItem(INITIALIZED_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    } catch (err) {
      console.error('Error saving raw sets to localStorage:', err);
    }
  },

  // Save single set (Insert or Update)
  saveSet: (set) => {
    const sets = storageService.getSets();
    const index = sets.findIndex((s) => String(s.id) === String(set.id));
    const updatedSet = {
      ...set,
      updatedAt: Date.now()
    };

    if (index >= 0) {
      sets[index] = updatedSet;
    } else {
      updatedSet.createdAt = Date.now();
      sets.unshift(updatedSet);
    }
    storageService.saveSets(sets);
    return sets;
  },

  // Delete set
  deleteSet: (setId) => {
    const sets = storageService.getSets();
    const filtered = sets.filter((s) => String(s.id) !== String(setId));
    storageService.saveSets(filtered);
    return filtered;
  },

  // Update card accuracy stats
  updateWordStats: (setId, cardId, isCorrect) => {
    const sets = storageService.getSets();
    const setIndex = sets.findIndex((s) => String(s.id) === String(setId));
    if (setIndex === -1) return sets;

    const cards = sets[setIndex].cards.map((card) => {
      if (String(card.id) === String(cardId)) {
        const stats = card.stats || { correct: 0, wrong: 0 };
        const c = Math.max(0, parseInt(stats.correct) || 0);
        const w = Math.max(0, parseInt(stats.wrong) || 0);
        return {
          ...card,
          stats: {
            correct: isCorrect ? c + 1 : c,
            wrong: !isCorrect ? w + 1 : w
          }
        };
      }
      return card;
    });

    sets[setIndex].cards = cards;
    storageService.saveSets(sets);
    return sets;
  },

  // Reset progress stats for a set or all sets
  resetProgress: (setId) => {
    const sets = storageService.getSets();
    const updatedSets = sets.map((set) => {
      if (setId === 'all' || String(set.id) === String(setId)) {
        return {
          ...set,
          cards: set.cards.map((card) => ({
            ...card,
            stats: { correct: 0, wrong: 0 }
          }))
        };
      }
      return set;
    });
    storageService.saveSets(updatedSets);
    return updatedSets;
  },

  // Export JSON string
  exportData: () => {
    const sets = storageService.getSets();
    return JSON.stringify(sets, null, 2);
  },

  // Strict JSON Import Validation & Normalization (Issue 6, 20, 22, 23 fix)
  validateAndNormalizeJson: (jsonString) => {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Cú pháp tệp JSON không hợp lệ.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Tệp JSON phải chứa một danh sách các bộ từ vựng (Dạng Mảng / Array).');
    }

    if (parsed.length === 0) {
      throw new Error('Tệp JSON không chứa bộ từ vựng nào (Mảng rỗng).');
    }

    const usedSetIds = new Set();

    const normalized = parsed.map((set, setIdx) => {
      // Item 100 & 101 Fix: Use SetSchema to validate set shape and require at least 1 valid card
      const schemaCheck = SetSchema.validate(set);
      if (!schemaCheck.valid) {
        throw new Error(`Bộ từ #${setIdx + 1}: ${schemaCheck.error}`);
      }
      // Sanitize Set ID (remove dangerous special characters / ? #)
      let rawSetId = String(set.id || `imported-set-${Date.now()}-${setIdx}`)
        .replace(/[/?#]/g, '_')
        .trim();
      
      while (usedSetIds.has(rawSetId)) {
        rawSetId = `${rawSetId}_${Math.random().toString(36).substring(2, 6)}`;
      }
      usedSetIds.add(rawSetId);

      // Sanitize Title (must be non-empty string)
      let titleStr = '';
      if (typeof set.title === 'string') {
        titleStr = set.title.trim();
      } else if (set.title !== null && set.title !== undefined) {
        titleStr = String(set.title).trim();
      }
      if (!titleStr) titleStr = `Bộ từ vựng nhập vào #${setIdx + 1}`;

      // Sanitize Description
      let descStr = '';
      if (typeof set.description === 'string') {
        descStr = set.description.trim();
      } else if (set.description !== null && set.description !== undefined && typeof set.description !== 'object') {
        descStr = String(set.description).trim();
      }

      // Sanitize Cards
      const rawCards = Array.isArray(set.cards) ? set.cards : [];
      const usedCardIds = new Set();

      const validCards = rawCards.map((card, cardIdx) => {
        let rawCardId = String(card.id || `card-${Date.now()}-${setIdx}-${cardIdx}`)
          .replace(/[/?#]/g, '_')
          .trim();

        while (usedCardIds.has(rawCardId)) {
          rawCardId = `${rawCardId}_${Math.random().toString(36).substring(2, 6)}`;
        }
        usedCardIds.add(rawCardId);

        const eng = typeof card.english === 'string' ? card.english.trim() : String(card.english || '').trim();
        const vie = typeof card.vietnamese === 'string' ? card.vietnamese.trim() : String(card.vietnamese || '').trim();

        const ex = typeof card.example === 'string' ? card.example.trim() : (card.example && typeof card.example !== 'object' ? String(card.example).trim() : '');
        const exTrans = typeof card.exampleTranslation === 'string' ? card.exampleTranslation.trim() : (card.exampleTranslation && typeof card.exampleTranslation !== 'object' ? String(card.exampleTranslation).trim() : '');

        const correctCount = Math.max(0, parseInt(card?.stats?.correct) || 0);
        const wrongCount = Math.max(0, parseInt(card?.stats?.wrong) || 0);

        return {
          id: rawCardId,
          english: eng,
          vietnamese: vie,
          example: ex,
          exampleTranslation: exTrans,
          stats: { correct: correctCount, wrong: wrongCount }
        };
      }).filter(c => c.english.length > 0 && c.vietnamese.length > 0);

      return {
        id: rawSetId,
        title: titleStr,
        description: descStr,
        createdAt: typeof set.createdAt === 'number' ? set.createdAt : Date.now(),
        updatedAt: Date.now(),
        cards: validCards
      };
    });

    return normalized;
  },

  // Import JSON with validation & merging (Issue 19 fix)
  importData: (jsonString) => {
    const normalized = storageService.validateAndNormalizeJson(jsonString);
    const currentSets = storageService.getSets();

    const setMap = new Map();
    currentSets.forEach(s => setMap.set(String(s.id), s));
    normalized.forEach(s => setMap.set(String(s.id), s));

    const mergedSets = Array.from(setMap.values());
    storageService.saveSets(mergedSets);
    return mergedSets;
  },

  // Theme Management
  getTheme: () => {
    return localStorage.getItem(THEME_KEY) || 'light';
  },

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
  },

  // Streak Management (Items 45, 46, 48 Fixes)
  getLocalDateString: (timestamp = Date.now()) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getStreakKey: (userId) => {
    return userId ? `quizlet_vocab_streak_user_${userId}` : STREAK_KEY;
  },

  getStreak: (userId = null) => {
    try {
      const key = storageService.getStreakKey(userId);
      const raw = localStorage.getItem(key);
      if (!raw) return { count: 0, lastDate: null };
      const parsed = JSON.parse(raw);

      const today = storageService.getLocalDateString(Date.now());
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = storageService.getLocalDateString(yesterdayDate.getTime());
      const parsedCount = Math.max(0, parseInt(parsed.count, 10) || 0);

      if (parsed.lastDate === today || parsed.lastDate === yesterday) {
        return { count: parsedCount, lastDate: parsed.lastDate };
      } else {
        const resetStreak = { count: 0, lastDate: null };
        localStorage.setItem(key, JSON.stringify(resetStreak));
        return resetStreak;
      }
    } catch {
      return { count: 0, lastDate: null };
    }
  },

  recordStreakActivity: (userId = null) => {
    try {
      const key = storageService.getStreakKey(userId);
      const today = storageService.getLocalDateString(Date.now());
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = storageService.getLocalDateString(yesterdayDate.getTime());

      const currentStreak = storageService.getStreak(userId);
      const currentCount = Math.max(0, parseInt(currentStreak.count, 10) || 0);

      if (currentStreak.lastDate === today) {
        return currentStreak;
      }

      let newCount = 1;
      if (currentStreak.lastDate === yesterday) {
        newCount = currentCount + 1;
      }

      const updatedStreak = {
        count: newCount,
        lastDate: today
      };

      localStorage.setItem(key, JSON.stringify(updatedStreak));
      return updatedStreak;
    } catch (err) {
      console.error('Streak update error:', err);
      return { count: 0, lastDate: null };
    }
  }
};
