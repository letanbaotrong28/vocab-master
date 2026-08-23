const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const LEGACY_TOKEN_KEY = 'vocabmaster_auth_token_v1';

const removeLegacyToken = () => {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Cookies are the only authentication source. Blocked localStorage is harmless.
  }
};

removeLegacyToken();

export const retryWithBackoff = async (fn, maxRetries = 2, delayMs = 600) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const shouldStop = [400, 401, 403, 404, 409, 413, 422].includes(error.status);
      if (shouldStop || attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * (2 ** attempt)));
    }
  }
  throw lastError;
};

const requestFetch = async (url, options = {}, timeoutMs = 15000) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const networkError = new Error('Không có kết nối Internet. Vui lòng kiểm tra lại mạng.');
    networkError.status = 0;
    throw networkError;
  }

  const {
    notifyUnauthorized = true,
    signal: externalSignal,
    ...fetchOptions
  } = options;
  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternalSignal();
    else externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(fullUrl, {
      ...fetchOptions,
      credentials: 'include',
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    let data;
    let invalidSuccessPayload = false;
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = {};
        invalidSuccessPayload = response.ok && response.status !== 204;
      }
    } else {
      const responseText = await response.text().catch(() => '');
      data = { error: responseText || 'Phản hồi từ máy chủ không ở định dạng JSON.' };
      invalidSuccessPayload = response.ok && response.status !== 204;
    }

    if (!response.ok) {
      const error = new Error(data.error || `Yêu cầu thất bại (mã ${response.status}).`);
      error.status = response.status;
      error.data = data;

      // Wrong credentials stay in the auth modal. Only an authenticated API call
      // is allowed to expire the current session globally.
      if (response.status === 401 && notifyUnauthorized && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:unauthorized', {
          detail: { status: response.status, error: data.error }
        }));
      }
      throw error;
    }

    if (invalidSuccessPayload) {
      const error = new Error('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại hoặc kiểm tra cấu hình triển khai.');
      error.status = 502;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError' && didTimeout) {
      const timeoutError = new Error(`Máy chủ không phản hồi sau ${Math.round(timeoutMs / 1000)} giây. Vui lòng thử lại.`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    if (error instanceof TypeError) {
      const networkError = new Error('Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng rồi thử lại.');
      networkError.status = 0;
      networkError.cause = error;
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
};

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest'
});

const withLocalDate = (path, localDate) => (
  localDate ? `${path}?localDate=${encodeURIComponent(localDate)}` : path
);

export const apiService = {
  getAuthHeaders: jsonHeaders,

  register: (username, password, localDate) => requestFetch('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ username, password, localDate }),
    notifyUnauthorized: false
  }),

  login: (username, password, localDate) => requestFetch('/api/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ username, password, localDate }),
    notifyUnauthorized: false
  }),

  getMe: async (localDate) => {
    try {
      return await requestFetch(withLocalDate('/api/auth/me', localDate), {
        headers: jsonHeaders(),
        notifyUnauthorized: false
      });
    } catch (error) {
      if (error.status === 401 || error.status === 404) return null;
      throw error;
    }
  },

  changePassword: (oldPassword, newPassword) => requestFetch('/api/auth/change-password', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ oldPassword, newPassword })
  }),

  logout: () => requestFetch('/api/auth/logout', {
    method: 'POST',
    headers: jsonHeaders()
  }),

  getSets: async () => {
    const data = await requestFetch('/api/sets', { headers: jsonHeaders() });
    return Array.isArray(data.sets) ? data.sets : [];
  },

  saveSet: (setData) => requestFetch('/api/sets', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(setData)
  }),

  deleteSet: (setId, expectedUpdatedAt) => requestFetch(`/api/sets/${encodeURIComponent(setId)}`, {
    method: 'DELETE',
    headers: jsonHeaders(),
    body: JSON.stringify({ expectedUpdatedAt })
  }),

  syncBatchSets: async (sets, { chunkSize = 200 } = {}) => {
    if (!Array.isArray(sets)) throw new Error('Danh sách bộ từ vựng không hợp lệ.');
    if (sets.length === 0) return apiService.getSets();

    for (const set of sets) {
      if (!Array.isArray(set?.cards) || set.cards.length === 0) {
        throw new Error(`Bộ từ "${set?.title || 'không tên'}" cần ít nhất một thẻ.`);
      }
      if (set.cards.length > 1000) {
        throw new Error(`Bộ từ "${set.title || 'không tên'}" vượt giới hạn 1.000 thẻ.`);
      }
    }

    let serverSets = [];
    const safeChunkSize = Math.max(1, Math.min(200, chunkSize));
    for (let start = 0; start < sets.length; start += safeChunkSize) {
      const chunk = sets.slice(start, start + safeChunkSize);
      const data = await requestFetch('/api/sets/sync-batch', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ sets: chunk })
      }, 30000);
      serverSets = Array.isArray(data.sets) ? data.sets : serverSets;
    }
    return serverSets;
  },

  recordWordStats: (setId, cardId, isCorrect, studyDate) => requestFetch('/api/sets/word-stats', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ setId, cardId, isCorrect, studyDate })
  }),

  resetProgress: (setId) => requestFetch('/api/sets/reset-progress', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ setId })
  })
};
