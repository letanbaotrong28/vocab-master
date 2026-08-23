const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const formatUtcDate = (date = new Date()) => date.toISOString().slice(0, 10);

export const isValidCalendarDate = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && formatUtcDate(parsed) === value;
};

const dayNumber = (value) => Date.parse(`${value}T00:00:00.000Z`) / 86400000;

export const validateClientDate = (value, now = new Date()) => {
  const localDate = value ?? formatUtcDate(now);
  if (!isValidCalendarDate(localDate)) {
    return { error: 'Ngày học phải có định dạng YYYY-MM-DD hợp lệ.' };
  }

  // A local calendar can legitimately be one day ahead/behind UTC. A wider
  // difference is rejected so clients cannot manufacture an arbitrary streak.
  const differenceFromUtc = Math.abs(dayNumber(localDate) - dayNumber(formatUtcDate(now)));
  if (differenceFromUtc > 1) {
    return { error: 'Ngày học không khớp với ngày hiện tại.' };
  }

  return { date: localDate };
};

export const calculateRecordedStreak = (currentCount, lastStudyDate, studyDate) => {
  const safeCount = Math.max(0, Number.parseInt(currentCount, 10) || 0);
  if (!isValidCalendarDate(lastStudyDate)) {
    return { count: 1, lastStudyDate: studyDate };
  }

  const difference = dayNumber(studyDate) - dayNumber(lastStudyDate);
  if (difference === 0) {
    return { count: Math.max(1, safeCount), lastStudyDate: studyDate };
  }
  if (difference === 1) {
    return { count: safeCount > 0 ? safeCount + 1 : 1, lastStudyDate: studyDate };
  }
  if (difference > 1) {
    return { count: 1, lastStudyDate: studyDate };
  }

  // An older/offline result must not rewind or inflate the current streak.
  return { count: safeCount, lastStudyDate };
};

export const getStreakSnapshot = (currentCount, lastStudyDate, localDate) => {
  const safeCount = Math.max(0, Number.parseInt(currentCount, 10) || 0);
  if (!isValidCalendarDate(lastStudyDate) || !isValidCalendarDate(localDate)) {
    return { count: 0, lastStudyDate: lastStudyDate || null };
  }

  const difference = dayNumber(localDate) - dayNumber(lastStudyDate);
  return {
    count: difference >= 0 && difference <= 1 ? safeCount : 0,
    lastStudyDate
  };
};
