import React from 'react';
import { BookOpen, Plus, Sun, Moon, HardDriveDownload, Layers, Flame, User, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const Header = () => {
  const { 
    activeView, 
    navigateTo, 
    theme, 
    toggleTheme, 
    setIsImportExportOpen, 
    sets,
    streak,
    user,
    setIsAuthModalOpen,
    logoutUser
  } = useApp();

  return (
    <>
      <header className="main-header">
        <div className="header-container container">
          {/* Brand Logo */}
          <div className="header-brand" onClick={() => navigateTo('home')}>
            <div className="brand-logo-icon">
              <BookOpen size={24} color="#ffffff" />
            </div>
            <div className="brand-text-group">
              <span className="brand-title">VocabMaster</span>
              <span className="brand-tagline hide-mobile">Quizlet Edition</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="header-nav hide-mobile">
            <button 
              className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
              onClick={() => navigateTo('home')}
            >
              <Layers size={18} />
              <span>Bộ từ vựng</span>
              <span className="nav-badge">{sets.length}</span>
            </button>
          </nav>

          {/* Action Controls & User Account */}
          <div className="header-actions">
            {/* 🔥 Streak Counter */}
            <div className="streak-badge-wrapper" title={`Chuỗi ngày học liên tiếp: ${streak.count} ngày`}>
              <Flame size={18} className="streak-flame-icon" />
              <span className="streak-count-text">🔥 {streak.count}<span className="hide-mobile"> ngày</span></span>
            </div>

            {/* Backup / Export JSON Button */}
            <button
              className="btn btn-secondary btn-icon-only hide-mobile"
              onClick={() => setIsImportExportOpen(true)}
              title="Sao lưu & Khôi phục file JSON"
            >
              <HardDriveDownload size={18} />
            </button>

            {/* 👤 Account / Login Control */}
            {user ? (
              <div className="user-profile-badge">
                <div className="user-avatar" title={`Đã đăng nhập: ${user.username}`}>
                  <User size={16} />
                </div>
                <span className="user-name-text hide-mobile">{user.username}</span>
                <button
                  className="logout-btn"
                  onClick={logoutUser}
                  title="Đăng xuất tài khoản"
                >
                  <LogOut size={16} />
                  <span className="hide-mobile">Thoát</span>
                </button>
              </div>
            ) : (
              <button
                className="auth-header-btn"
                onClick={() => setIsAuthModalOpen(true)}
                title="Đăng nhập hoặc đăng ký tài khoản"
              >
                <LogIn size={16} />
                <span>Đăng nhập</span>
              </button>
            )}

            <button 
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              title={`Chuyển sang chế độ ${theme === 'light' ? 'Tối' : 'Sáng'}`}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <button 
              className="btn btn-primary btn-sm hide-mobile"
              onClick={() => navigateTo('create')}
            >
              <Plus size={18} />
              Tạo mới
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Dock */}
      <nav className="mobile-bottom-nav">
        <button 
          className={`mobile-nav-item ${activeView === 'home' ? 'active' : ''}`}
          onClick={() => navigateTo('home')}
        >
          <div className="mobile-nav-icon-wrapper">
            <Layers size={20} />
            {sets.length > 0 && <span className="mobile-nav-badge">{sets.length}</span>}
          </div>
          <span>Bộ từ</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeView === 'create' || activeView === 'edit' ? 'active' : ''}`}
          onClick={() => navigateTo('create')}
        >
          <div className="mobile-nav-icon-wrapper create-icon">
            <Plus size={22} />
          </div>
          <span>Tạo mới</span>
        </button>

        <button 
          className="mobile-nav-item"
          onClick={() => (user ? logoutUser() : setIsAuthModalOpen(true))}
        >
          <div className="mobile-nav-icon-wrapper">
            {user ? <LogOut size={20} /> : <LogIn size={20} />}
          </div>
          <span>{user ? user.username : 'Tài khoản'}</span>
        </button>

        <button 
          className="mobile-nav-item"
          onClick={() => setIsImportExportOpen(true)}
        >
          <div className="mobile-nav-icon-wrapper">
            <HardDriveDownload size={20} />
          </div>
          <span>Sao lưu</span>
        </button>
      </nav>
    </>
  );
};
