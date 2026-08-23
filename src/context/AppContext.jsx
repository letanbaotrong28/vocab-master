import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storageService, normalizeSetCollection, normalizeStreak } from '../services/storage';
import { apiService, retryWithBackoff } from '../services/apiService';
import { AppContext } from './appContextValue';

const ZERO_STREAK = Object.freeze({ count: 0, lastStudyDate: null });
const VALID_VIEWS = new Set(['home', 'create', 'edit', 'flashcards', 'learn', 'typing', 'progress']);
const PROTECTED_VIEWS = new Set(['create', 'edit', 'flashcards', 'learn', 'typing', 'progress']);
const SET_REQUIRED_VIEWS = new Set(['edit', 'flashcards', 'learn', 'typing', 'progress']);
const STUDY_VIEWS = new Set(['flashcards', 'learn', 'typing', 'progress']);

const retryBusyMutation = async (operation, maxAttempts = 3) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = error.data?.code === 'MUTATION_BUSY' && attempt < maxAttempts - 1;
      if (!canRetry) throw error;
      await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }
  return null;
};

const buildRouteHash = (view, setId, cardIds) => {
  let hash = `#${view}`;
  if (setId !== null && setId !== undefined) hash += `/${encodeURIComponent(String(setId))}`;
  if (Array.isArray(cardIds) && cardIds.length > 0) {
    const query = new URLSearchParams();
    query.set('cards', cardIds.map(String).join(','));
    hash += `?${query.toString()}`;
  }
  return hash;
};

const parseRouteHash = rawHash => {
  const raw = String(rawHash || '').replace(/^#/, '');
  if (!raw) return { view: 'home', setId: null, cardIds: null };
  const [path, queryString = ''] = raw.split('?');
  const parts = path.split('/');
  const view = VALID_VIEWS.has(parts[0]) ? parts[0] : 'home';
  let setId = null;
  try {
    setId = parts[1] ? decodeURIComponent(parts[1]) : null;
  } catch {
    return { view: 'home', setId: null, cardIds: null };
  }
  const cardIds = new URLSearchParams(queryString).get('cards')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 1000) || null;
  return { view, setId, cardIds };
};

export const AppProvider = ({ children }) => {
  const [sets, setSets] = useState([]);
  const [activeView, setActiveView] = useState('home');
  const [currentSetId, setCurrentSetId] = useState(null);
  const [editingSetId, setEditingSetId] = useState(null);
  const [studyCardIds, setStudyCardIds] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState(() => storageService.getTheme());
  const [streak, setStreak] = useState(ZERO_STREAK);
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isStudyViewTransitioning, setIsStudyViewTransitioning] = useState(false);
  const [toast, setToast] = useState(null);
  const [isImportExportOpenState, setIsImportExportOpenState] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    confirmText: 'Xác nhận',
    danger: false
  });

  const toastTimerRef = useRef(null);
  const navigationGuardRef = useRef(null);
  const studyWriteQueueRef = useRef(Promise.resolve());
  const activeUserIdRef = useRef(null);
  const progressRevisionRef = useRef(0);
  const previousHashRef = useRef(typeof window === 'undefined' ? '#home' : (window.location.hash || '#home'));
  const importOpenRef = useRef(false);
  const studyViewTransitionTimerRef = useRef(null);

  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, id: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (studyViewTransitionTimerRef.current) clearTimeout(studyViewTransitionTimerRef.current);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    importOpenRef.current = isImportExportOpenState;
  }, [isImportExportOpenState]);

  const applyHomeState = useCallback(({ replaceHash = false } = {}) => {
    setActiveView('home');
    setCurrentSetId(null);
    setEditingSetId(null);
    setStudyCardIds(null);
    setIsImportExportOpenState(false);
    const homeHash = '#home';
    if (typeof window !== 'undefined' && window.location.hash !== homeHash) {
      if (replaceHash) window.history.replaceState(null, '', homeHash);
      else window.history.pushState(null, '', homeHash);
    }
    previousHashRef.current = homeHash;
  }, []);

  const commitAuthenticatedSession = useCallback((nextUser, nextStreak, nextSets) => {
    const safeStreak = normalizeStreak(nextStreak);
    const safeSets = normalizeSetCollection(nextSets, { requireCards: false });
    setUser(nextUser);
    activeUserIdRef.current = nextUser.id;
    setStreak(safeStreak);
    setSets(safeSets);
    storageService.cacheSession(nextUser, safeStreak);
    storageService.cacheAccountSets(nextUser.id, safeSets);
  }, []);

  const clearAuthenticatedSession = useCallback(({ announce = false } = {}) => {
    activeUserIdRef.current = null;
    setUser(null);
    setStreak(ZERO_STREAK);
    setSets(storageService.getSets());
    storageService.clearCachedSession();
    setIsAuthModalOpen(false);
    applyHomeState({ replaceHash: true });
    if (announce) showToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'warning', 5000);
  }, [applyHomeState, showToast]);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      setIsAuthLoading(true);
      const localDate = storageService.getLocalDateString();
      try {
        const authData = await apiService.getMe(localDate);
        if (cancelled) return;
        if (!authData?.user) {
          setUser(null);
          setStreak(ZERO_STREAK);
          setSets(storageService.getSets());
          storageService.clearCachedSession();
          return;
        }

        try {
          const serverSets = await retryWithBackoff(() => apiService.getSets(), 2, 400);
          if (!cancelled) commitAuthenticatedSession(authData.user, authData.streak, serverSets);
        } catch (setsError) {
          if (cancelled) return;
          const cachedSets = storageService.getCachedAccountSets(authData.user.id);
          commitAuthenticatedSession(authData.user, authData.streak, cachedSets);
          showToast('Đã đăng nhập nhưng tạm thời chưa thể làm mới dữ liệu. Đang hiển thị bản lưu gần nhất.', 'warning', 6000);
          console.warn('Unable to refresh account sets:', setsError);
        }
      } catch (error) {
        if (cancelled) return;
        const cached = storageService.getCachedSession();
        if (cached?.user) {
          commitAuthenticatedSession(
            cached.user,
            cached.streak,
            storageService.getCachedAccountSets(cached.user.id)
          );
          showToast('Không thể kết nối máy chủ. Đang giữ phiên và dữ liệu đã lưu gần nhất.', 'warning', 6000);
        } else {
          setUser(null);
          setStreak(ZERO_STREAK);
          setSets(storageService.getSets());
          showToast('Không thể kiểm tra phiên đăng nhập. Vui lòng thử lại khi mạng ổn định.', 'warning', 6000);
        }
        console.warn('Authentication startup failed:', error);
      } finally {
        if (!cancelled) setIsAuthLoading(false);
      }
    };

    const timer = setTimeout(loadSession, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clearAuthenticatedSession, commitAuthenticatedSession, showToast]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthenticatedSession({ announce: true });
      setIsAuthModalOpen(true);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [clearAuthenticatedSession]);

  const requireAuth = useCallback((message = 'Bạn cần đăng nhập hoặc tạo tài khoản để sử dụng tính năng này.') => {
    if (user) return true;
    setIsAuthModalOpen(true);
    showToast(message, 'info', 4500);
    return false;
  }, [showToast, user]);

  const loginUser = useCallback(async (username, password) => {
    const localDate = storageService.getLocalDateString();
    const data = await apiService.login(username, password, localDate);
    try {
      const serverSets = await retryWithBackoff(() => apiService.getSets(), 2, 400);
      commitAuthenticatedSession(data.user, data.streak, serverSets);
    } catch (error) {
      await apiService.logout().catch(() => {});
      throw new Error(error.message || 'Đăng nhập thành công nhưng không thể tải dữ liệu tài khoản. Vui lòng thử lại.');
    }
    setIsAuthModalOpen(false);
    applyHomeState({ replaceHash: true });
    showToast(`Chào mừng quay trở lại, ${data.user.username}!`, 'success');
  }, [applyHomeState, commitAuthenticatedSession, showToast]);

  const registerUser = useCallback(async (username, password) => {
    const localDate = storageService.getLocalDateString();
    const data = await apiService.register(username, password, localDate);
    let syncWarning = null;
    let serverSets = [];
    try {
      const localSets = storageService.getSets().filter(set => Array.isArray(set.cards) && set.cards.length > 0);
      serverSets = localSets.length > 0
        ? await apiService.syncBatchSets(localSets)
        : await apiService.getSets();
    } catch (error) {
      syncWarning = error;
      try {
        serverSets = await apiService.getSets();
      } catch {
        serverSets = storageService.getCachedAccountSets(data.user.id);
      }
    }
    commitAuthenticatedSession(data.user, data.streak, serverSets);
    setIsAuthModalOpen(false);
    applyHomeState({ replaceHash: true });
    if (syncWarning) {
      showToast(`Đã tạo tài khoản ${data.user.username}, nhưng một phần dữ liệu cục bộ chưa đồng bộ. Bạn có thể nhập lại sau.`, 'warning', 7000);
    } else {
      showToast(`Đăng ký thành công. Chào mừng ${data.user.username}!`, 'success');
    }
  }, [applyHomeState, commitAuthenticatedSession, showToast]);

  const logoutUser = useCallback(async () => {
    try {
      await apiService.logout();
    } catch (error) {
      showToast(error.message || 'Không thể đăng xuất trên máy chủ. Vui lòng thử lại.', 'warning', 5000);
      return false;
    }
    clearAuthenticatedSession();
    showToast('Đã đăng xuất khỏi thiết bị này.', 'info');
    return true;
  }, [clearAuthenticatedSession, showToast]);

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme => {
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      storageService.setTheme(nextTheme);
      return nextTheme;
    });
  }, []);

  const setNavigationGuard = useCallback(guard => {
    navigationGuardRef.current = typeof guard === 'function' ? guard : null;
  }, []);

  const navigateTo = useCallback((view, setId = null, options = {}) => {
    const safeView = VALID_VIEWS.has(view) ? view : 'home';
    if (PROTECTED_VIEWS.has(safeView) && !requireAuth()) return false;
    if (!options.skipGuard && navigationGuardRef.current && safeView !== activeView) {
      if (!navigationGuardRef.current()) return false;
    }
    if (SET_REQUIRED_VIEWS.has(safeView)) {
      const exists = sets.some(set => String(set.id) === String(setId));
      if (!setId || !exists) {
        showToast('Không tìm thấy bộ từ vựng cần mở.', 'warning');
        applyHomeState({ replaceHash: true });
        return false;
      }
    }

    const cardIds = Array.isArray(options.cardIds) ? options.cardIds.map(String) : null;
    const shouldMaskStudyChange = safeView !== activeView
      && (STUDY_VIEWS.has(safeView) || STUDY_VIEWS.has(activeView));

    if (shouldMaskStudyChange) {
      if (studyViewTransitionTimerRef.current) {
        clearTimeout(studyViewTransitionTimerRef.current);
      }
      setIsStudyViewTransitioning(true);
      studyViewTransitionTimerRef.current = setTimeout(() => {
        setIsStudyViewTransitioning(false);
        studyViewTransitionTimerRef.current = null;
      }, 120);
    }

    setActiveView(safeView);
    setStudyCardIds(cardIds);
    if (safeView === 'home' || safeView === 'create') {
      setCurrentSetId(null);
      setEditingSetId(null);
    } else {
      setCurrentSetId(setId);
      setEditingSetId(safeView === 'edit' ? setId : null);
    }

    const hash = buildRouteHash(safeView, setId, cardIds);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    previousHashRef.current = hash;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    return true;
  }, [activeView, applyHomeState, requireAuth, sets, showToast]);

  useEffect(() => {
    if (isAuthLoading) return undefined;

    const applyHashRoute = (fromHistory = false) => {
      const targetHash = window.location.hash || '#home';
      if (fromHistory && targetHash !== previousHashRef.current && navigationGuardRef.current) {
        const allowNavigation = navigationGuardRef.current();
        if (!allowNavigation) {
          window.history.pushState(null, '', previousHashRef.current || '#home');
          return;
        }
      }

      const route = parseRouteHash(targetHash);
      if (PROTECTED_VIEWS.has(route.view) && !user) {
        applyHomeState({ replaceHash: true });
        requireAuth('Vui lòng đăng nhập để mở trang này.');
        return;
      }
      if (SET_REQUIRED_VIEWS.has(route.view)) {
        const exists = route.setId && sets.some(set => String(set.id) === String(route.setId));
        if (!exists) {
          applyHomeState({ replaceHash: true });
          if (route.setId) showToast('Bộ từ vựng trong đường dẫn không tồn tại.', 'warning');
          return;
        }
      }

      setActiveView(route.view);
      setStudyCardIds(route.cardIds);
      if (route.view === 'home' || route.view === 'create') {
        setCurrentSetId(null);
        setEditingSetId(null);
      } else {
        setCurrentSetId(route.setId);
        setEditingSetId(route.view === 'edit' ? route.setId : null);
      }
      const canonicalHash = buildRouteHash(route.view, route.setId, route.cardIds);
      if (targetHash !== canonicalHash) window.history.replaceState(null, '', canonicalHash);
      previousHashRef.current = canonicalHash;
    };

    const handleHistory = () => applyHashRoute(true);
    window.addEventListener('popstate', handleHistory);
    window.addEventListener('hashchange', handleHistory);
    applyHashRoute(false);
    return () => {
      window.removeEventListener('popstate', handleHistory);
      window.removeEventListener('hashchange', handleHistory);
    };
  }, [applyHomeState, isAuthLoading, requireAuth, sets, showToast, user]);

  const setIsImportExportOpen = useCallback(nextValue => {
    const requested = typeof nextValue === 'function' ? nextValue(importOpenRef.current) : nextValue;
    if (requested && !requireAuth('Vui lòng đăng nhập để sao lưu hoặc khôi phục dữ liệu.')) return;
    importOpenRef.current = Boolean(requested);
    setIsImportExportOpenState(Boolean(requested));
  }, [requireAuth]);

  const refreshAccountSets = useCallback(async () => {
    const expectedUserId = user?.id;
    const freshSets = normalizeSetCollection(
      await retryWithBackoff(() => apiService.getSets(), 2, 350),
      { requireCards: false }
    );
    if (String(activeUserIdRef.current) !== String(expectedUserId)) return freshSets;
    setSets(freshSets);
    if (expectedUserId) storageService.cacheAccountSets(expectedUserId, freshSets);
    return freshSets;
  }, [user]);

  const saveSet = useCallback(async setData => {
    if (!requireAuth('Vui lòng đăng nhập trước khi lưu bộ từ vựng.')) return false;
    const previousSet = sets.find(set => String(set.id) === String(setData.id)) || null;
    const optimisticRevision = Date.now();
    const optimisticSet = normalizeSetCollection([{
      ...setData,
      updatedAt: optimisticRevision
    }], { requireCards: true })[0];
    if (!optimisticSet) throw new Error('Bộ từ vựng không hợp lệ.');
    const mutationId = `save-${optimisticRevision}-${Math.random().toString(36).slice(2, 9)}`;
    const pendingSet = { ...optimisticSet, _syncing: true, _mutationId: mutationId };

    setSets(currentSets => {
      const nextSets = currentSets.filter(set => String(set.id) !== String(setData.id));
      nextSets.unshift(pendingSet);
      return nextSets;
    });
    navigateTo('home', null, { skipGuard: true });
    showToast('Đã cập nhật giao diện. Đang lưu bộ từ lên tài khoản...', 'info', 2500);

    try {
      const saveWrite = studyWriteQueueRef.current
        .catch(() => undefined)
        .then(() => retryBusyMutation(() => apiService.saveSet(setData)));
      studyWriteQueueRef.current = saveWrite;
      const response = await saveWrite;
      if (String(activeUserIdRef.current) !== String(user.id)) return true;
      if (response?.set) {
        const canonicalSet = normalizeSetCollection([response.set], { requireCards: true })[0];
        if (!canonicalSet) throw new Error('Máy chủ trả về bộ từ vựng không hợp lệ.');
        setSets(currentSets => {
          const pendingIndex = currentSets.findIndex(set => set._mutationId === mutationId);
          const nextSets = currentSets.filter(set => (
            set._mutationId !== mutationId
            && String(set.id) !== String(canonicalSet.id)
          ));
          nextSets.splice(Math.max(0, pendingIndex), 0, canonicalSet);
          storageService.cacheAccountSets(user.id, nextSets);
          return nextSets;
        });
      } else {
        try {
          await refreshAccountSets();
        } catch (refreshError) {
          showToast('Bộ từ đã được lưu, nhưng danh sách chưa thể làm mới. Hãy tải lại trang khi mạng ổn định.', 'warning', 6000);
          console.warn('Set saved but refresh failed:', refreshError);
          setSets(currentSets => {
            const nextSets = currentSets.map(set => (
              set._mutationId === mutationId
                ? Object.fromEntries(Object.entries(set).filter(([key]) => !key.startsWith('_')))
                : set
            ));
            storageService.cacheAccountSets(user.id, nextSets);
            return nextSets;
          });
        }
      }
      showToast('Đã lưu bộ từ vựng thành công!', 'success');
      return true;
    } catch (error) {
      if (String(activeUserIdRef.current) !== String(user.id)) return false;
      setSets(currentSets => {
        const pendingIndex = currentSets.findIndex(set => set._mutationId === mutationId);
        if (pendingIndex < 0) return currentSets;
        const nextSets = currentSets.filter(set => set._mutationId !== mutationId);
        if (previousSet) nextSets.splice(pendingIndex, 0, previousSet);
        storageService.cacheAccountSets(user.id, nextSets);
        return nextSets;
      });
      if (error.data?.code === 'SET_CONFLICT') {
        try {
          await refreshAccountSets();
        } catch (refreshError) {
          console.warn('Unable to refresh sets after a save conflict:', refreshError);
        }
        const conflictError = new Error('Bộ từ này đã được thay đổi ở một phiên khác. Bản đang soạn vẫn được giữ lại; hãy mở lại bộ từ để đối chiếu trước khi lưu.');
        conflictError.status = 409;
        showToast(conflictError.message, 'warning', 8000);
        throw conflictError;
      }
      showToast(error.message || 'Lỗi khi lưu bộ từ vựng.', 'warning');
      throw error;
    }
  }, [navigateTo, refreshAccountSets, requireAuth, sets, showToast, user]);

  const requestDeleteSet = useCallback((setId, setTitle) => {
    if (!requireAuth('Vui lòng đăng nhập trước khi xóa bộ từ vựng.')) return;
    const targetSet = sets.find(set => String(set.id) === String(setId));
    const targetIndex = sets.findIndex(set => String(set.id) === String(setId));
    const expectedUpdatedAt = Number(targetSet?.updatedAt);
    setConfirmModal({
      isOpen: true,
      title: 'Xóa bộ từ vựng',
      message: `Bạn có chắc chắn muốn xóa bộ từ "${setTitle}"? Hành động này không thể hoàn tác.`,
      confirmText: 'Xóa ngay',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(current => ({ ...current, isOpen: false }));
        setSets(currentSets => {
          const nextSets = currentSets.filter(set => String(set.id) !== String(setId));
          return nextSets;
        });
        if (String(currentSetId) === String(setId) || activeView !== 'home') {
          navigateTo('home', null, { skipGuard: true });
        }
        showToast('Đã xóa khỏi giao diện. Đang đồng bộ với tài khoản...', 'info', 2500);
        try {
          const deleteWrite = studyWriteQueueRef.current
            .catch(() => undefined)
            .then(() => retryBusyMutation(() => apiService.deleteSet(
                setId,
                Number.isSafeInteger(expectedUpdatedAt) ? expectedUpdatedAt : null
              ))
            );
          studyWriteQueueRef.current = deleteWrite;
          await deleteWrite;
          setSets(currentSets => {
            storageService.cacheAccountSets(user.id, currentSets);
            return currentSets;
          });
          showToast('Đã xóa bộ từ vựng.', 'warning');
        } catch (error) {
          if (error.status === 404) {
            setSets(currentSets => {
              storageService.cacheAccountSets(user.id, currentSets);
              return currentSets;
            });
            showToast('Bộ từ đã được xóa trước đó.', 'info');
            return;
          }
          if (error.data?.code === 'SET_CONFLICT') {
            try {
              await refreshAccountSets();
            } catch (refreshError) {
              console.warn('Unable to refresh sets after a delete conflict:', refreshError);
            }
            showToast('Bộ từ này vừa được thay đổi ở một phiên khác nên chưa bị xóa. Danh sách đã được làm mới; hãy kiểm tra rồi thử lại.', 'warning', 8000);
            return;
          }
          if (targetSet && String(activeUserIdRef.current) === String(user.id)) {
            setSets(currentSets => {
              if (currentSets.some(set => String(set.id) === String(setId))) return currentSets;
              const nextSets = [...currentSets];
              nextSets.splice(Math.max(0, targetIndex), 0, targetSet);
              storageService.cacheAccountSets(user.id, nextSets);
              return nextSets;
            });
          }
          showToast(error.message || 'Lỗi khi xóa bộ từ vựng.', 'warning');
        }
      }
    });
  }, [activeView, currentSetId, navigateTo, refreshAccountSets, requireAuth, sets, showToast, user]);

  const deleteSetsNow = useCallback(async (setIds, { silent = false } = {}) => {
    const requestedIds = new Set((Array.isArray(setIds) ? setIds : [setIds]).map(String));
    const targets = sets.filter(set => requestedIds.has(String(set.id)));
    if (targets.length === 0) {
      if (!silent) showToast('Vui lòng chọn ít nhất một bộ từ vựng để xóa.', 'info');
      return false;
    }
    if (!requireAuth('Vui lòng đăng nhập trước khi xóa bộ từ vựng.')) return false;

    const targetIds = new Set(targets.map(set => String(set.id)));
    setSets(currentSets => currentSets.filter(set => !targetIds.has(String(set.id))));
    if ((currentSetId && targetIds.has(String(currentSetId))) || activeView !== 'home') {
      navigateTo('home', null, { skipGuard: true });
    }
    if (!silent) {
      showToast(`Đã xóa ${targets.length} bộ khỏi giao diện. Đang đồng bộ với tài khoản...`, 'info', 2500);
    }

    const deleteWrite = studyWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const failures = [];
        for (const target of targets) {
          try {
            const expectedUpdatedAt = Number(target.updatedAt);
            await retryBusyMutation(() => apiService.deleteSet(
              target.id,
              Number.isSafeInteger(expectedUpdatedAt) ? expectedUpdatedAt : null
            ));
          } catch (error) {
            if (error.status !== 404) failures.push({ target, error });
          }
        }
        return failures;
      });
    studyWriteQueueRef.current = deleteWrite;
    const failures = await deleteWrite;

    if (failures.length === 0) {
      setSets(currentSets => {
        storageService.cacheAccountSets(user.id, currentSets);
        return currentSets;
      });
      if (!silent) showToast(`Đã xóa ${targets.length} bộ từ vựng.`, 'warning');
      return true;
    }

    try {
      await refreshAccountSets();
    } catch (refreshError) {
      console.warn('Unable to refresh sets after partial batch delete:', refreshError);
      const failedTargets = failures.map(item => item.target);
      setSets(currentSets => {
        const existingIds = new Set(currentSets.map(set => String(set.id)));
        const restored = [...currentSets];
        failedTargets.forEach(target => {
          if (!existingIds.has(String(target.id))) restored.push(target);
        });
        storageService.cacheAccountSets(user.id, restored);
        return restored;
      });
    }
    showToast(
      `Đã xóa ${targets.length - failures.length}/${targets.length} bộ. ${failures.length} bộ chưa thể xóa và đã được khôi phục.`,
      'warning',
      7000
    );
    return false;
  }, [activeView, currentSetId, navigateTo, refreshAccountSets, requireAuth, sets, showToast, user]);

  const requestDeleteSets = useCallback((setIds) => {
    const requestedIds = new Set((Array.isArray(setIds) ? setIds : [setIds]).map(String));
    const targets = sets.filter(set => requestedIds.has(String(set.id)));
    if (targets.length === 0) {
      showToast('Vui lòng chọn ít nhất một bộ từ vựng để xóa.', 'info');
      return;
    }
    if (targets.length === 1) {
      requestDeleteSet(targets[0].id, targets[0].title);
      return;
    }
    if (!requireAuth('Vui lòng đăng nhập trước khi xóa bộ từ vựng.')) return;

    setConfirmModal({
      isOpen: true,
      title: `Xóa ${targets.length} bộ từ vựng`,
      message: `Bạn có chắc chắn muốn xóa ${targets.length} bộ từ vựng đã chọn? Hành động này không thể hoàn tác.`,
      confirmText: `Xóa ${targets.length} bộ`,
      danger: true,
      onConfirm: async () => {
        setConfirmModal(current => ({ ...current, isOpen: false }));
        await deleteSetsNow(targets.map(set => set.id));
      }
    });
  }, [deleteSetsNow, requestDeleteSet, requireAuth, sets, showToast]);

  const recordWordResult = useCallback((setId, cardId, isCorrect) => {
    if (!requireAuth('Vui lòng đăng nhập trước khi học.')) throw new Error('Bạn chưa đăng nhập.');
    if (typeof isCorrect !== 'boolean') throw new Error('Kết quả học không hợp lệ.');
    const studyDate = storageService.getLocalDateString();
    const userId = user.id;
    const progressRevision = progressRevisionRef.current;

    const queuedWrite = studyWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (String(activeUserIdRef.current) !== String(userId)) return { skipped: true };
        let result;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            result = await apiService.recordWordStats(setId, cardId, isCorrect, studyDate);
            break;
          } catch (error) {
            const isBusy = error.data?.code === 'MUTATION_BUSY' && attempt < 2;
            if (!isBusy) throw error;
            await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
          }
        }

        if (String(activeUserIdRef.current) !== String(userId)) return result;
        const nextStreak = normalizeStreak(result?.streak);
        setStreak(nextStreak);
        storageService.cacheSession(user, nextStreak);
        if (progressRevision !== progressRevisionRef.current) return result;
        setSets(currentSets => {
          const nextSets = currentSets.map(set => {
            if (String(set.id) !== String(setId)) return set;
            return {
              ...set,
              cards: (set.cards || []).map(card => {
                if (String(card.id) !== String(cardId)) return card;
                const stats = card.stats || { correct: 0, wrong: 0 };
                return {
                  ...card,
                  stats: {
                    correct: Math.min(2147483647, (Number.parseInt(stats.correct, 10) || 0) + (isCorrect ? 1 : 0)),
                    wrong: Math.min(2147483647, (Number.parseInt(stats.wrong, 10) || 0) + (isCorrect ? 0 : 1))
                  }
                };
              })
            };
          });
          storageService.cacheAccountSets(userId, nextSets);
          return nextSets;
        });
        return result;
      });

    studyWriteQueueRef.current = queuedWrite;
    return queuedWrite;
  }, [requireAuth, user]);

  const requestResetProgress = useCallback((setId = 'all', setTitle = '') => {
    if (!requireAuth('Vui lòng đăng nhập trước khi đặt lại tiến trình.')) return;
    const message = setId === 'all'
      ? 'Bạn có chắc chắn muốn đặt lại tiến trình của tất cả bộ từ?'
      : `Bạn có chắc chắn muốn đặt lại tiến trình của bộ từ "${setTitle}"?`;
    setConfirmModal({
      isOpen: true,
      title: 'Đặt lại tiến trình học',
      message,
      confirmText: 'Đặt lại',
      danger: true,
      onConfirm: async () => {
        const previousSets = sets;
        progressRevisionRef.current += 1;
        setConfirmModal(current => ({ ...current, isOpen: false }));
        setSets(currentSets => {
          const nextSets = currentSets.map(set => (
            setId === 'all' || String(set.id) === String(setId)
              ? { ...set, cards: (set.cards || []).map(card => ({ ...card, stats: { correct: 0, wrong: 0 } })) }
              : set
          ));
          return nextSets;
        });
        showToast('Đã đặt lại trên giao diện. Đang đồng bộ với tài khoản...', 'info', 2500);

        const resetWrite = studyWriteQueueRef.current
          .catch(() => undefined)
          .then(() => retryBusyMutation(() => apiService.resetProgress(setId)));
        studyWriteQueueRef.current = resetWrite;
        try {
          await resetWrite;
          setSets(currentSets => {
            const nextSets = currentSets.map(set => (
              setId === 'all' || String(set.id) === String(setId)
                ? { ...set, cards: (set.cards || []).map(card => ({ ...card, stats: { correct: 0, wrong: 0 } })) }
                : set
            ));
            storageService.cacheAccountSets(user.id, nextSets);
            return nextSets;
          });
          showToast('Đã đặt lại tiến trình học.', 'info');
        } catch (error) {
          try {
            await refreshAccountSets();
          } catch (refreshError) {
            console.warn('Unable to refresh sets after reset failure:', refreshError);
            if (String(activeUserIdRef.current) === String(user.id)) {
              setSets(previousSets);
              storageService.cacheAccountSets(user.id, previousSets);
            }
          }
          showToast(error.message || 'Lỗi khi đặt lại tiến trình.', 'warning');
        }
      }
    });
  }, [refreshAccountSets, requireAuth, sets, showToast, user]);

  const handleImportSuccess = useCallback(async importedSets => {
    if (!requireAuth('Vui lòng đăng nhập trước khi nhập dữ liệu.')) throw new Error('Bạn chưa đăng nhập.');
    const setsWithRevisions = importedSets.map(importedSet => {
      const current = sets.find(set => String(set.id) === String(importedSet.id));
      const expectedUpdatedAt = Number(current?.updatedAt);
      return current && Number.isSafeInteger(expectedUpdatedAt)
        ? { ...importedSet, expectedUpdatedAt }
        : importedSet;
    });
    try {
      const serverSets = normalizeSetCollection(
        await apiService.syncBatchSets(setsWithRevisions),
        { requireCards: false }
      );
      setSets(serverSets);
      storageService.cacheAccountSets(user.id, serverSets);
      return serverSets;
    } catch (error) {
      if (error.status === 409 || error.data?.code === 'SET_CONFLICT') {
        try {
          await refreshAccountSets();
        } catch (refreshError) {
          console.warn('Unable to refresh sets after an import conflict:', refreshError);
        }
        const conflictError = new Error('Một bộ từ trùng ID đã được thay đổi ở phiên khác. Dữ liệu mới nhất đã được tải lại; hãy xuất bản sao lưu rồi đối chiếu trước khi nhập lại.');
        conflictError.status = 409;
        throw conflictError;
      }
      throw error;
    }
  }, [refreshAccountSets, requireAuth, sets, user]);

  const currentSet = currentSetId === null
    ? null
    : sets.find(set => String(set.id) === String(currentSetId)) || null;

  const contextValue = useMemo(() => ({
    sets,
    activeView,
    currentSetId,
    editingSetId,
    studyCardIds,
    currentSet,
    searchQuery,
    setSearchQuery,
    theme,
    toggleTheme,
    streak: user ? streak : ZERO_STREAK,
    user,
    isAuthLoading,
    isStudyViewTransitioning,
    isAuthModalOpen,
    setIsAuthModalOpen,
    requireAuth,
    loginUser,
    registerUser,
    logoutUser,
    navigateTo,
    setNavigationGuard,
    saveSet,
    requestDeleteSet,
    requestDeleteSets,
    deleteSetsNow,
    recordWordResult,
    requestResetProgress,
    toast,
    showToast,
    isImportExportOpen: isImportExportOpenState,
    setIsImportExportOpen,
    handleImportSuccess,
    confirmModal,
    setConfirmModal
  }), [
    sets, activeView, currentSetId, editingSetId, studyCardIds, currentSet,
    searchQuery, theme, toggleTheme, streak, user, isAuthLoading, isStudyViewTransitioning,
    isAuthModalOpen, requireAuth, loginUser, registerUser, logoutUser,
    navigateTo, setNavigationGuard, saveSet, requestDeleteSet, requestDeleteSets, deleteSetsNow,
    recordWordResult, requestResetProgress, toast, showToast,
    isImportExportOpenState, setIsImportExportOpen, handleImportSuccess,
    confirmModal
  ]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};
