const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'vocabmaster_auth_token_v1';

// Item 83 Fix: Exponential Backoff Retry Helper
export const retryWithBackoff = async (fn, maxRetries = 2, delayMs = 1000) => {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.status === 401 || err.status === 403 || err.status === 400 || attempt === maxRetries) {
        throw err;
      }
      await new Promise(res => setTimeout(res, delayMs * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
};

// Centralized Request Handler (Item 64, 66, 67, 68, 84 Fix: Assign error.status, credentials include & timeout cleared after reading body)
const requestFetch = async (url, options = {}, timeoutMs = 15000) => {
  if (!navigator.onLine) {
    const netErr = new Error('Không có kết nối Internet. Vui lòng kiểm tra lại mạng.');
    netErr.status = 0;
    throw netErr;
  }

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromExternalSignal = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) abortFromExternalSignal();
    else options.signal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(fullUrl, {
      ...options,
      credentials: 'include', // Item 68 Fix: Send HttpOnly cookies with request
      signal: controller.signal
    });

    const contentType = res.headers.get('content-type');
    let data = {};
    if (contentType && contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    } else {
      const text = await res.text().catch(() => '');
      data = { error: text || 'Phản hồi từ máy chủ không ở định dạng JSON.' };
    }

    clearTimeout(timer); // Item 84 Fix: Clear timer ONLY AFTER reading complete response body

    if (!res.ok) {
      const err = new Error(data.error || `Yêu cầu thất bại (Mã lỗi ${res.status}).`);
      err.status = res.status;
      err.data = data;

      if (res.status === 401 || res.status === 403) {
        apiService.removeToken();
        window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { status: res.status, error: data.error } }));
      }
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError' && didTimeout) {
      const timeoutErr = new Error(`Yêu cầu tới máy chủ bị quá thời gian (Timeout ${Math.round(timeoutMs / 1000)} giây). Vui lòng thử lại.`);
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromExternalSignal);
  }
};

export const apiService = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  removeToken: () => localStorage.removeItem(TOKEN_KEY),

  getAuthHeaders: () => {
    const token = apiService.getToken();
    return {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // Item 29 CSRF Header
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  },

  // Auth APIs
  register: async (username, password) => {
    const data = await requestFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ username, password })
    });
    if (data.token) apiService.setToken(data.token);
    return data;
  },

  login: async (username, password) => {
    const data = await requestFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ username, password })
    });
    if (data.token) apiService.setToken(data.token);
    return data;
  },

  // Item 65 Fix: Differentiate 401/403 from 500/Network error in getMe
  getMe: async () => {
    try {
      const data = await requestFetch('/api/auth/me', {
        headers: apiService.getAuthHeaders()
      });
      return data.user;
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        apiService.removeToken();
        return null;
      }
      // Re-throw 500 or Network errors so app does NOT drop user to offline local mode erroneously
      throw err;
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    const data = await requestFetch('/api/auth/change-password', {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ oldPassword, newPassword })
    });
    if (data.token) apiService.setToken(data.token);
    return data;
  },

  logout: async () => {
    try {
      await requestFetch('/api/auth/logout', {
        method: 'POST',
        headers: apiService.getAuthHeaders()
      });
    } catch (e) {
      console.error('Logout request failed:', e);
    } finally {
      apiService.removeToken();
      window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { status: 401 } }));
    }
  },

  // Sets APIs
  getSets: async () => {
    const data = await requestFetch('/api/sets', {
      headers: apiService.getAuthHeaders()
    });
    return data.sets;
  },

  saveSet: async (setData) => {
    return await requestFetch('/api/sets', {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify(setData)
    });
  },

  deleteSet: async (setId) => {
    return await requestFetch(`/api/sets/${encodeURIComponent(setId)}`, {
      method: 'DELETE',
      headers: apiService.getAuthHeaders()
    });
  },

  syncBatchSets: async (sets) => {
    const data = await requestFetch('/api/sets/sync-batch', {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ sets })
    });
    return data.sets;
  },

  recordWordStats: async (setId, cardId, isCorrect) => {
    return await requestFetch('/api/sets/word-stats', {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ setId, cardId, isCorrect })
    });
  },

  resetProgress: async (setId) => {
    return await requestFetch('/api/sets/reset-progress', {
      method: 'POST',
      headers: apiService.getAuthHeaders(),
      body: JSON.stringify({ setId })
    });
  }
};
