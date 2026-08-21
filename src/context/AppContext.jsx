import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { storageService } from '../services/storage';
import { apiService } from '../services/apiService';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [sets, setSets] = useState([]);
  const [activeView, setActiveView] = useState('home'); // 'home' | 'create' | 'edit' | 'flashcards' | 'learn' | 'typing' | 'progress'
  const [currentSetId, setCurrentSetId] = useState(null);
  const [editingSetId, setEditingSetId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState('light');
  const [streak, setStreak] = useState({ count: 0, lastDate: null });
  
  // Auth State
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Modals & Notifications
  const [toast, setToast] = useState(null);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    confirmText: 'Xác nhận',
    danger: false
  });

  // Reset active session state when auth state changes (Issue 5 fix)
  const resetSessionState = () => {
    setActiveView('home');
    setCurrentSetId(null);
    setEditingSetId(null);
    setIsAuthModalOpen(false);
    setIsImportExportOpen(false);
  };

  // Load initial theme and streak
  useEffect(() => {
    const savedTheme = storageService.getTheme();
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

    const loadedStreak = storageService.getStreak();
    setStreak(loadedStreak);

    // Initial auth check
    checkAuthAndLoadSets();
  }, []);

  const checkAuthAndLoadSets = async () => {
    setIsAuthLoading(true);
    try {
      const currentUser = await apiService.getMe();
      if (currentUser) {
        setUser(currentUser);
        const serverSets = await apiService.getSets();
        setSets(serverSets);
      } else {
        setUser(null);
        const localSets = storageService.getSets();
        setSets(localSets);
      }
    } catch (err) {
      console.error('Auth load error:', err);
      setUser(null);
      const localSets = storageService.getSets();
      setSets(localSets);
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Login User Action
  const loginUser = async (username, password) => {
    const data = await apiService.login(username, password);
    setUser(data.user);
    const serverSets = await apiService.getSets();
    setSets(serverSets);
    resetSessionState();
    showToast(`Chào mừng quay trở lại, ${data.user.username}!`, 'success');
  };

  // Register User Action
  const registerUser = async (username, password) => {
    const data = await apiService.register(username, password);
    setUser(data.user);

    // Initial demo sets seed for brand new registered account
    const localSets = storageService.getSets();
    if (localSets && localSets.length > 0) {
      try {
        const syncedSets = await apiService.syncBatchSets(localSets);
        setSets(syncedSets);
        resetSessionState();
        showToast(`Đăng ký thành công! Đã lưu bộ từ vựng vào tài khoản ${data.user.username}.`, 'success');
        return;
      } catch (e) {
        console.error('Initial sync error on register:', e);
      }
    }

    const serverSets = await apiService.getSets();
    setSets(serverSets);
    resetSessionState();
    showToast(`Đăng ký tài khoản mới thành công! Chào mừng ${data.user.username}!`, 'success');
  };

  // Logout User Action (Item 42 fix: server-side token revocation)
  const logoutUser = async () => {
    await apiService.logout();
    setUser(null);
    const localSets = storageService.getSets();
    setSets(localSets);
    resetSessionState();
    showToast('Đã đăng xuất tài khoản & thu hồi token.', 'info');
  };

  // Theme Toggle
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    storageService.setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    showToast(`Đã chuyển sang chế độ ${newTheme === 'dark' ? 'Tối (Dark)' : 'Sáng (Light)'}`);
  };

  // Load streak whenever user changes
  useEffect(() => {
    const s = storageService.getStreak(user?.id);
    setStreak(s);
  }, [user?.id]);

  // Record streak activity when studying
  const recordStreak = () => {
    const updatedStreak = storageService.recordStreakActivity(user?.id);
    setStreak(updatedStreak);
  };

  // Item 125 Fix: URL Hash Navigation & Deep-Linking with Browser Back/Forward support
  const navigateTo = (view, setId = null) => {
    setActiveView(view);
    if (setId) {
      setCurrentSetId(setId);
      if (view === 'edit') {
        setEditingSetId(setId);
      }
    }

    let hash = `#${view}`;
    if (setId) hash += `/${encodeURIComponent(setId)}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) {
        setActiveView('home');
        return;
      }
      const parts = hash.split('/');
      const view = parts[0];
      const setId = parts[1] ? decodeURIComponent(parts[1]) : null;

      if (['home', 'create', 'edit', 'flashcards', 'learn', 'typing', 'progress'].includes(view)) {
        setActiveView(view);
        if (setId) {
          setCurrentSetId(setId);
          if (view === 'edit') setEditingSetId(setId);
        }
      }
    };

    window.addEventListener('popstate', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('popstate', handleHashChange);
  }, []);

  // Toast Notification
  const showToast = (message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  // Save or Update Set
  const saveSet = async (setData) => {
    try {
      if (user) {
        await apiService.saveSet(setData);
        const serverSets = await apiService.getSets();
        setSets(serverSets);
      } else {
        const updatedSets = storageService.saveSet(setData);
        setSets(updatedSets);
      }
      showToast('Đã lưu bộ từ vựng thành công!', 'success');
      navigateTo('home');
    } catch (err) {
      showToast(err.message || 'Lỗi khi lưu bộ từ vựng.', 'warning');
    }
  };

  // Request Confirmation for Delete Set
  const requestDeleteSet = (setId, setTitle) => {
    setConfirmModal({
      isOpen: true,
      title: 'Xóa bộ từ vựng',
      message: `Bạn có chắc chắn muốn xóa bộ từ "${setTitle}"? Hành động này không thể hoàn tác.`,
      confirmText: 'Xóa ngay',
      danger: true,
      onConfirm: async () => {
        try {
          if (user) {
            await apiService.deleteSet(setId);
            const serverSets = await apiService.getSets();
            setSets(serverSets);
          } else {
            const remainingSets = storageService.deleteSet(setId);
            setSets(remainingSets);
          }
          if (currentSetId === setId) {
            setCurrentSetId(null);
          }
          showToast('Đã xóa bộ từ vựng.', 'warning');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          if (activeView !== 'home') {
            navigateTo('home');
          }
        } catch (err) {
          showToast(err.message || 'Lỗi khi xóa bộ từ vựng.', 'warning');
        }
      }
    });
  };

  // Update card accuracy metrics
  const recordWordResult = async (setId, cardId, isCorrect) => {
    recordStreak();
    try {
      if (user) {
        await apiService.recordWordStats(setId, cardId, isCorrect);
        // Optimistically update state locally
        setSets(prevSets => prevSets.map(set => {
          if (set.id === setId) {
            return {
              ...set,
              cards: set.cards.map(card => {
                if (card.id === cardId) {
                  const stats = card.stats || { correct: 0, wrong: 0 };
                  return {
                    ...card,
                    stats: {
                      correct: isCorrect ? stats.correct + 1 : stats.correct,
                      wrong: !isCorrect ? stats.wrong + 1 : stats.wrong
                    }
                  };
                }
                return card;
              })
            };
          }
          return set;
        }));
      } else {
        const updatedSets = storageService.updateWordStats(setId, cardId, isCorrect);
        setSets(updatedSets);
      }
    } catch (err) {
      console.error('Error recording word result:', err);
    }
  };

  // Request Confirmation for Reset Progress
  const requestResetProgress = (setId = 'all', setTitle = '') => {
    const msg = setId === 'all'
      ? 'Bạn có chắc chắn muốn làm mới toàn bộ tiến trình học của tất cả các bộ từ?'
      : `Bạn có chắc chắn muốn làm mới tiến trình học của bộ từ "${setTitle}"?`;

    setConfirmModal({
      isOpen: true,
      title: 'Đặt lại tiến trình học',
      message: msg,
      confirmText: 'Đặt lại',
      danger: true,
      onConfirm: async () => {
        try {
          if (user) {
            await apiService.resetProgress(setId);
            const serverSets = await apiService.getSets();
            setSets(serverSets);
          } else {
            const updatedSets = storageService.resetProgress(setId);
            setSets(updatedSets);
          }
          showToast('Đã làm mới tiến trình học thành công.', 'info');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          showToast(err.message || 'Lỗi khi đặt lại tiến trình.', 'warning');
        }
      }
    });
  };

  // Refresh sets after import (Issue 4 fix: returns promise and throws error on failure)
  const handleImportSuccess = async (importedSets) => {
    if (user) {
      const serverSets = await apiService.syncBatchSets(importedSets);
      setSets(serverSets);
    } else {
      storageService.saveSets(importedSets);
      setSets(importedSets);
    }
  };

  const currentSet = sets.find(s => s.id === currentSetId) || null;

  const contextValue = useMemo(() => ({
    sets,
    activeView,
    currentSetId,
    editingSetId,
    currentSet,
    searchQuery,
    setSearchQuery,
    theme,
    toggleTheme,
    streak,
    user,
    isAuthLoading,
    isAuthModalOpen,
    setIsAuthModalOpen,
    loginUser,
    registerUser,
    logoutUser,
    navigateTo,
    saveSet,
    requestDeleteSet,
    recordWordResult,
    requestResetProgress,
    toast,
    showToast,
    isImportExportOpen,
    setIsImportExportOpen,
    handleImportSuccess,
    confirmModal,
    setConfirmModal
  }), [
    sets,
    activeView,
    currentSetId,
    editingSetId,
    currentSet,
    searchQuery,
    theme,
    streak,
    user,
    isAuthLoading,
    isAuthModalOpen,
    toast,
    isImportExportOpen,
    confirmModal
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
