/**
 * VocabMaster Shared Data Validation Schema (Item 122)
 * Ensures consistency across Import/Export, API Requests, LocalStorage, and Database.
 */

export const CardSchema = {
  validate(card) {
    if (!card || typeof card !== 'object') {
      return { valid: false, error: 'Thẻ từ vựng phải là một object.' };
    }
    if (!card.english || typeof card.english !== 'string' || !card.english.trim()) {
      return { valid: false, error: 'Thẻ từ vựng bắt buộc có từ tiếng Anh.' };
    }
    if (!card.vietnamese || typeof card.vietnamese !== 'string' || !card.vietnamese.trim()) {
      return { valid: false, error: 'Thẻ từ vựng bắt buộc có nghĩa tiếng Việt.' };
    }
    return { valid: true };
  }
};

export const SetSchema = {
  validate(set) {
    if (!set || typeof set !== 'object') {
      return { valid: false, error: 'Bộ từ vựng phải là một object.' };
    }
    if (!set.title || typeof set.title !== 'string' || !set.title.trim()) {
      return { valid: false, error: 'Bộ từ vựng bắt buộc phải có tiêu đề.' };
    }
    if (!Array.isArray(set.cards) || set.cards.length === 0) {
      return { valid: false, error: 'Bộ từ vựng phải chứa ít nhất 1 thẻ từ.' };
    }

    for (let i = 0; i < set.cards.length; i++) {
      const cardRes = CardSchema.validate(set.cards[i]);
      if (!cardRes.valid) {
        return { valid: false, error: `Thẻ thứ ${i + 1}: ${cardRes.error}` };
      }
    }

    return { valid: true };
  }
};
