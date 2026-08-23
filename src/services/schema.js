const isPlainObject = value => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const validateOptionalText = (value, label, maxLength) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return `${label} phải là chuỗi ký tự.`;
  if (value.length > maxLength) return `${label} không được vượt quá ${maxLength} ký tự.`;
  return null;
};

const hasUnquotedDelimiter = (line, delimiter) => {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quote === char && line[index + 1] === char) index += 1;
      else quote = quote ? null : char;
      continue;
    }
    if (!quote && line.startsWith(delimiter, index)) return true;
  }
  return false;
};

export const parseDelimitedLine = (line, delimiter) => {
  const cells = [];
  let value = '';
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quote === char && line[index + 1] === char) {
        value += char;
        index += 1;
      } else {
        quote = quote ? null : char;
      }
      continue;
    }
    if (!quote && line.startsWith(delimiter, index)) {
      cells.push(value.trim());
      value = '';
      index += delimiter.length - 1;
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
};

export const parseBatchVocabulary = text => {
  if (typeof text !== 'string' || !text.trim()) return [];
  const rows = [];
  const seen = new Set();
  const delimiters = ['\t', '|', ';', ' - ', ',', ':', '='];

  text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) return;
    const delimiter = delimiters.find(candidate => (
      !(candidate === ':' && /^https?:\/\//i.test(line)) && hasUnquotedDelimiter(line, candidate)
    ));
    if (!delimiter) return;
    const cells = parseDelimitedLine(line, delimiter);
    if (cells.length < 2) return;
    const [english, vietnamese, example = '', exampleTranslation = ''] = cells;
    if (!english || !vietnamese) return;
    const duplicateKey = `${english.toLocaleLowerCase()}::${vietnamese.toLocaleLowerCase()}`;
    if (seen.has(duplicateKey)) return;
    seen.add(duplicateKey);
    rows.push({ english, vietnamese, example, exampleTranslation, lineIndex });
  });
  return rows;
};

export const CardSchema = {
  validate(card) {
    if (!isPlainObject(card)) return { valid: false, error: 'Thẻ từ vựng phải là một object.' };
    if (typeof card.english !== 'string' || !card.english.trim()) {
      return { valid: false, error: 'Thẻ từ vựng bắt buộc có từ tiếng Anh.' };
    }
    if (card.english.trim().length > 500) {
      return { valid: false, error: 'Từ tiếng Anh không được vượt quá 500 ký tự.' };
    }
    if (typeof card.vietnamese !== 'string' || !card.vietnamese.trim()) {
      return { valid: false, error: 'Thẻ từ vựng bắt buộc có nghĩa tiếng Việt.' };
    }
    if (card.vietnamese.trim().length > 500) {
      return { valid: false, error: 'Nghĩa tiếng Việt không được vượt quá 500 ký tự.' };
    }
    const exampleError = validateOptionalText(card.example, 'Câu ví dụ', 1000);
    if (exampleError) return { valid: false, error: exampleError };
    const translationError = validateOptionalText(card.exampleTranslation, 'Bản dịch ví dụ', 1000);
    if (translationError) return { valid: false, error: translationError };
    if (card.stats !== undefined && card.stats !== null) {
      if (!isPlainObject(card.stats)) {
        return { valid: false, error: 'Thống kê của thẻ không hợp lệ.' };
      }
      for (const field of ['correct', 'wrong']) {
        const value = card.stats[field];
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2147483647)) {
          return { valid: false, error: `Thống kê ${field} phải là số nguyên hợp lệ.` };
        }
      }
    }
    return { valid: true };
  }
};

export const SetSchema = {
  validate(set) {
    if (!isPlainObject(set)) return { valid: false, error: 'Bộ từ vựng phải là một object.' };
    if (typeof set.title !== 'string' || !set.title.trim()) {
      return { valid: false, error: 'Bộ từ vựng bắt buộc phải có tiêu đề.' };
    }
    if (set.title.trim().length > 250) {
      return { valid: false, error: 'Tiêu đề không được vượt quá 250 ký tự.' };
    }
    const descriptionError = validateOptionalText(set.description, 'Mô tả', 1000);
    if (descriptionError) return { valid: false, error: descriptionError };
    if (!Array.isArray(set.cards) || set.cards.length === 0) {
      return { valid: false, error: 'Bộ từ vựng phải chứa ít nhất một thẻ từ.' };
    }
    if (set.cards.length > 1000) {
      return { valid: false, error: 'Một bộ từ chỉ được chứa tối đa 1.000 thẻ.' };
    }

    for (let index = 0; index < set.cards.length; index += 1) {
      const result = CardSchema.validate(set.cards[index]);
      if (!result.valid) return { valid: false, error: `Thẻ thứ ${index + 1}: ${result.error}` };
    }
    return { valid: true };
  }
};
