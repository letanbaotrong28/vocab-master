const TOKEN_KEY = 'vocabmaster_auth_token';
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Centralized Request Handler (Item 86 & 87 Fix: AbortController timeout & central error handling)
const requestFetch = async (url, options = {}, timeoutMs = 15000) => {
  if (!navigator.onLine) {
    throw new Error('Không có kết nối Internet. Vui lòng kiểm tra lại mạng.');
  }

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(fullUrl, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timer);

    const contentType = res.headers.get('content-type');
    let data = {};
    if (contentType && contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    } else {
      const text = await res.text().catch(() => '');
      data = { error: text || 'Phản hồi từ máy chủ không ở định dạng JSON.' };
    }

    if (!res.ok) {
      if (res.status === 401) {
        apiService.removeToken();
        throw new Error(data.error || 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.');
      }
      if (res.status === 403) {
        throw new Error(data.error || 'Bạn không có quyền thực hiện thao tác này.');
      }
      if (res.status === 413) {
        throw new Error('Dữ liệu gửi lên vượt quá dung lượng cho phép của máy chủ (Max 10MB).');
      }
      if (res.status >= 500) {
        throw new Error(data.error || 'Máy chủ gặp sự cố nội bộ. Vui lòng thử lại sau.');
      }
      throw new Error(data.error || `Yêu cầu thất bại (Mã lỗi ${res.status}).`);
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Yêu cầu tới máy chủ bị quá thời gian (Timeout 15 giây). Vui lòng thử lại.');
    }
    throw err;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  },

  // Auth APIs
  register: async (username, password) => {
    const data = await requestFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (data.token) apiService.setToken(data.token);
    return data;
  },

  login: async (username, password) => {
    const data = await requestFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (data.token) apiService.setToken(data.token);
    return data;
  },

  getMe: async () => {
    const token = apiService.getToken();
    if (!token) return null;

    try {
      const data = await requestFetch('/api/auth/me', {
        headers: apiService.getAuthHeaders()
      });
      return data.user;
    } catch (err) {
      // Item 34 Fix: Only remove token on 401 Unauthorized or 403 Forbidden. Do NOT log out user on 500 or offline errors.
      if (err.status === 401 || err.status === 403) {
        apiService.removeToken();
      }
      return null;
    }
  },

  logout: async () => {
    try {
      await requestFetch('/api/auth/logout', {
        method: 'POST',
        headers: apiService.getAuthHeaders()
      });
    } catch (e) {
      console.error('Logout revocation notice:', e);
    } finally {
      apiService.removeToken();
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
