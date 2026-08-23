import crypto from 'crypto';

const MAX_EXTERNAL_ID_LENGTH = 1000;

const normalizeExternalId = (rawId) => {
  if (rawId === undefined || rawId === null) return null;
  const value = String(rawId).normalize('NFC').trim();
  if (!value || value.length > MAX_EXTERNAL_ID_LENGTH) return null;
  return value;
};

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Resolve a client-provided set id without lossy character replacement.
 * Existing ids are kept for backwards compatibility; new client ids are mapped
 * to a namespaced SHA-256 digest so two distinct ids can never collapse merely
 * because they contain punctuation or are longer than a database column.
 */
export const resolveSetId = async (tx, userId, rawId) => {
  const normalized = normalizeExternalId(rawId);

  if (!normalized) {
    throw new TypeError('A valid client set id is required.');
  }

  const existing = await tx.getOne(
    'SELECT id FROM vocab_sets WHERE id = ? AND user_id = ?',
    [normalized, userId]
  );
  if (existing) return existing.id;

  return `u${userId}_s_${digest(normalized)}`;
};

/**
 * Resolve a card id within a set. Card ids are globally unique in the current
 * schema, so the set id is included in the digest. An id already belonging to
 * this set is preserved, which keeps old links and progress records stable.
 */
export const resolveCardId = async (tx, setId, rawId) => {
  const normalized = normalizeExternalId(rawId);

  if (!normalized) {
    throw new TypeError('A valid client card id is required.');
  }

  const existing = await tx.getOne(
    'SELECT id FROM cards WHERE id = ? AND set_id = ?',
    [normalized, setId]
  );
  if (existing) return existing.id;

  return `c_${digest(`${setId}\0${normalized}`)}`;
};

export const createDeterministicCardId = (setId, source) => (
  `c_${digest(`${setId}\0${String(source).normalize('NFC')}`)}`
);

export const isUsableExternalId = (rawId) => normalizeExternalId(rawId) !== null;
