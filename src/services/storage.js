import { INITIAL_DEMO_SETS } from '../data/demoSets.js';
import { SetSchema } from './schema.js';

const STORAGE_KEY = 'vocabmaster_sets_v2';
const LEGACY_STORAGE_KEY = 'quizlet_vocab_sets_v1';
const INITIALIZED_KEY = 'vocabmaster_initialized_v2';
const LEGACY_INITIALIZED_KEY = 'quizlet_vocab_initialized_v1';
const THEME_KEY = 'vocabmaster_theme_v2';
const LEGACY_THEME_KEY = 'quizlet_vocab_theme_v1';
const SESSION_CACHE_KEY = 'vocabmaster_session_cache_v1';
const ACCOUNT_SETS_PREFIX = 'vocabmaster_account_sets_v1_';
const EDITOR_DRAFT_PREFIX = 'vocabmaster_editor_draft_v2_';

const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key, value, { required = false } = {}) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    if (required) {
      throw new Error('Bộ nhớ trình duyệt đã đầy hoặc bị chặn. Không thể lưu dữ liệu.');
    }
    return false;
  }
};

const safeRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is optional for cache/draft cleanup.
  }
};

const stringValue = (value, maxLength) => {
  if (typeof value === 'string') return value.trim().slice(0, maxLength);
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value).trim().slice(0, maxLength);
};

const numberCount = value => Math.max(0, Number.parseInt(value, 10) || 0);

const stableIdHash = value => {
  const text = String(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
};

export const sanitizeResourceId = (value, fallback) => {
  const raw = typeof value === 'string'
    ? value.trim()
    : (value === null || value === undefined || typeof value === 'object' ? '' : String(value).trim());
  if (!raw) return fallback;
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized === raw && sanitized.length <= 100) return sanitized;
  const suffix = `_${stableIdHash(raw)}`;
  const prefix = sanitized.slice(0, Math.max(1, 100 - suffix.length));
  return `${prefix}${suffix}`;
};

const uniqueId = (base, usedIds) => {
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, 100 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
};

const normalizeCard = (card, fallbackId, usedIds) => {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
  const english = stringValue(card.english, 500);
  const vietnamese = stringValue(card.vietnamese, 500);
  if (!english || !vietnamese) return null;
  const baseId = sanitizeResourceId(card.id, fallbackId);
  return {
    id: uniqueId(baseId, usedIds),
    english,
    vietnamese,
    example: stringValue(card.example, 1000),
    exampleTranslation: stringValue(card.exampleTranslation, 1000),
    stats: {
      correct: numberCount(card.stats?.correct),
      wrong: numberCount(card.stats?.wrong)
    }
  };
};

export const normalizeSetCollection = (input, { requireCards = false } = {}) => {
  if (!Array.isArray(input)) return [];
  const usedSetIds = new Set();

  return input.slice(0, 5000).map((set, setIndex) => {
    if (!set || typeof set !== 'object' || Array.isArray(set)) return null;
    const usedCardIds = new Set();
    const cards = (Array.isArray(set.cards) ? set.cards : [])
      .slice(0, 1000)
      .map((card, cardIndex) => normalizeCard(card, `card-${setIndex + 1}-${cardIndex + 1}`, usedCardIds))
      .filter(Boolean);
    if (requireCards && cards.length === 0) return null;

    const baseId = sanitizeResourceId(set.id, `set-${setIndex + 1}`);
    return {
      id: uniqueId(baseId, usedSetIds),
      title: stringValue(set.title, 250) || `Bộ từ vựng #${setIndex + 1}`,
      description: stringValue(set.description, 1000),
      cards,
      createdAt: Number.isFinite(Number(set.createdAt)) ? Number(set.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(set.updatedAt)) ? Number(set.updatedAt) : Date.now()
    };
  }).filter(Boolean);
};

export const normalizeStreak = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const lastStudyDate = typeof source.lastStudyDate === 'string'
    ? source.lastStudyDate
    : (typeof source.lastDate === 'string' ? source.lastDate : null);
  if (!lastStudyDate) return { count: 0, lastStudyDate: null };
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const toLocalDate = date => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  );
  if (lastStudyDate !== toLocalDate(now) && lastStudyDate !== toLocalDate(yesterday)) {
    return { count: 0, lastStudyDate: null };
  }
  return { count: numberCount(source.count), lastStudyDate };
};

const accountSetsKey = userId => `${ACCOUNT_SETS_PREFIX}${encodeURIComponent(String(userId))}`;
const draftKey = (userId, editorKey) => (
  `${EDITOR_DRAFT_PREFIX}${encodeURIComponent(String(userId || 'guest'))}_${encodeURIComponent(String(editorKey || 'new'))}`
);

export const storageService = {
  getSets: () => {
    try {
      const initialized = safeGet(INITIALIZED_KEY) || safeGet(LEGACY_INITIALIZED_KEY);
      const raw = safeGet(STORAGE_KEY) ?? safeGet(LEGACY_STORAGE_KEY);

      if (!initialized || raw === null) {
        const demoSets = normalizeSetCollection(INITIAL_DEMO_SETS, { requireCards: true });
        safeSet(INITIALIZED_KEY, 'true');
        safeSet(STORAGE_KEY, JSON.stringify(demoSets));
        return demoSets;
      }

      const normalized = normalizeSetCollection(JSON.parse(raw), { requireCards: false });
      safeSet(STORAGE_KEY, JSON.stringify(normalized));
      safeSet(INITIALIZED_KEY, 'true');
      return normalized;
    } catch (error) {
      console.warn('Không thể đọc dữ liệu cục bộ:', error);
      return [];
    }
  },

  saveSets: (sets) => {
    const normalized = normalizeSetCollection(sets, { requireCards: false });
    safeSet(INITIALIZED_KEY, 'true', { required: true });
    safeSet(STORAGE_KEY, JSON.stringify(normalized), { required: true });
    return normalized;
  },

  saveSetsRaw: sets => {
    try {
      return storageService.saveSets(sets);
    } catch {
      return [];
    }
  },

  saveSet: set => {
    const sets = storageService.getSets();
    const normalized = normalizeSetCollection([set], { requireCards: true })[0];
    if (!normalized) throw new Error('Bộ từ vựng không hợp lệ.');
    const index = sets.findIndex(item => String(item.id) === String(normalized.id));
    const updated = { ...normalized, updatedAt: Date.now() };
    if (index >= 0) sets[index] = updated;
    else sets.unshift({ ...updated, createdAt: normalized.createdAt || Date.now() });
    return storageService.saveSets(sets);
  },

  deleteSet: setId => storageService.saveSets(
    storageService.getSets().filter(set => String(set.id) !== String(setId))
  ),

  updateWordStats: (setId, cardId, isCorrect) => {
    const sets = storageService.getSets().map(set => {
      if (String(set.id) !== String(setId)) return set;
      return {
        ...set,
        cards: set.cards.map(card => {
          if (String(card.id) !== String(cardId)) return card;
          const stats = card.stats || { correct: 0, wrong: 0 };
          return {
            ...card,
            stats: {
              correct: numberCount(stats.correct) + (isCorrect === true ? 1 : 0),
              wrong: numberCount(stats.wrong) + (isCorrect === false ? 1 : 0)
            }
          };
        })
      };
    });
    return storageService.saveSets(sets);
  },

  resetProgress: (setId = 'all') => storageService.saveSets(
    storageService.getSets().map(set => (
      setId === 'all' || String(set.id) === String(setId)
        ? { ...set, cards: set.cards.map(card => ({ ...card, stats: { correct: 0, wrong: 0 } })) }
        : set
    ))
  ),

  exportData: () => JSON.stringify(storageService.getSets(), null, 2),

  validateAndNormalizeJson: jsonString => {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Cú pháp tệp JSON không hợp lệ.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Tệp JSON phải chứa một danh sách bộ từ vựng.');
    }
    if (parsed.length === 0) throw new Error('Tệp JSON không chứa bộ từ vựng nào.');
    if (parsed.length > 5000) throw new Error('Tệp JSON vượt giới hạn 5.000 bộ từ vựng.');

    parsed.forEach((set, index) => {
      const result = SetSchema.validate(set);
      if (!result.valid) throw new Error(`Bộ từ #${index + 1}: ${result.error}`);
      if (set.cards.length > 1000) throw new Error(`Bộ từ #${index + 1} vượt giới hạn 1.000 thẻ.`);
    });

    const normalized = normalizeSetCollection(parsed, { requireCards: true });
    if (normalized.length !== parsed.length) throw new Error('Một hoặc nhiều bộ từ không hợp lệ.');
    return normalized;
  },

  importData: jsonString => {
    const normalized = storageService.validateAndNormalizeJson(jsonString);
    const merged = new Map(storageService.getSets().map(set => [String(set.id), set]));
    normalized.forEach(set => merged.set(String(set.id), set));
    return storageService.saveSets(Array.from(merged.values()));
  },

  getTheme: () => {
    const saved = safeGet(THEME_KEY) ?? safeGet(LEGACY_THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  },

  setTheme: theme => safeSet(THEME_KEY, theme === 'dark' ? 'dark' : 'light'),

  getLocalDateString: (timestamp = Date.now()) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // Guests never own a streak. Account streak is only cached from the server.
  getStreak: userId => {
    if (!userId) return { count: 0, lastStudyDate: null };
    const cached = storageService.getCachedSession();
    if (String(cached?.user?.id) !== String(userId)) return { count: 0, lastStudyDate: null };
    return normalizeStreak(cached.streak);
  },

  recordStreakActivity: userId => storageService.getStreak(userId),

  cacheSession: (user, streak) => {
    if (!user?.id) return;
    safeSet(SESSION_CACHE_KEY, JSON.stringify({ user, streak: normalizeStreak(streak), savedAt: Date.now() }));
  },

  getCachedSession: () => {
    try {
      const parsed = JSON.parse(safeGet(SESSION_CACHE_KEY) || 'null');
      if (!parsed?.user?.id || !parsed.user.username) return null;
      return { ...parsed, streak: normalizeStreak(parsed.streak) };
    } catch {
      return null;
    }
  },

  clearCachedSession: () => safeRemove(SESSION_CACHE_KEY),

  cacheAccountSets: (userId, sets) => {
    if (!userId) return;
    const normalized = normalizeSetCollection(sets, { requireCards: false });
    safeSet(accountSetsKey(userId), JSON.stringify(normalized));
  },

  getCachedAccountSets: userId => {
    if (!userId) return [];
    try {
      return normalizeSetCollection(JSON.parse(safeGet(accountSetsKey(userId)) || '[]'), { requireCards: false });
    } catch {
      return [];
    }
  },

  getEditorDraft: (userId, editorKey) => {
    try {
      const draft = JSON.parse(safeGet(draftKey(userId, editorKey)) || 'null');
      const isRecent = draft?.savedAt && Date.now() - draft.savedAt < 7 * 24 * 60 * 60 * 1000;
      if (!isRecent || !Array.isArray(draft.cards)) return null;
      const usedCardIds = new Set();
      const cards = draft.cards.slice(0, 1000).map((card, index) => {
        if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
        const baseId = sanitizeResourceId(card.id, `draft-card-${index + 1}`);
        return {
          id: uniqueId(baseId, usedCardIds),
          english: stringValue(card.english, 500),
          vietnamese: stringValue(card.vietnamese, 500),
          example: stringValue(card.example, 1000),
          exampleTranslation: stringValue(card.exampleTranslation, 1000),
          stats: {
            correct: numberCount(card.stats?.correct),
            wrong: numberCount(card.stats?.wrong)
          }
        };
      }).filter(Boolean);
      if (cards.length === 0) return null;
      const expectedUpdatedAt = Number(draft.expectedUpdatedAt);
      return {
        setId: typeof draft.setId === 'string' ? sanitizeResourceId(draft.setId, '') : null,
        title: stringValue(draft.title, 250),
        description: stringValue(draft.description, 1000),
        batchText: stringValue(draft.batchText, 100000),
        cards,
        expectedUpdatedAt: Number.isSafeInteger(expectedUpdatedAt) && expectedUpdatedAt >= 0
          ? expectedUpdatedAt
          : null,
        savedAt: draft.savedAt
      };
    } catch {
      return null;
    }
  },

  saveEditorDraft: (userId, editorKey, draft) => safeSet(
    draftKey(userId, editorKey),
    JSON.stringify({ ...draft, savedAt: Date.now() })
  ),

  removeEditorDraft: (userId, editorKey) => safeRemove(draftKey(userId, editorKey))
};
