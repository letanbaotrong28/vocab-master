import React from 'react';
import { BookOpen, Plus, Sun, Moon, HardDriveDownload, Layers, Flame, User, LogIn, LogOut } from 'lucide-react';
import { useApp } from '../context/useApp';

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

  const safeNavigate = (view) => navigateTo(view);

  const handleLogoutClick = async () => {
    if (window.confirm('Bạn có chắc chắn muốn đăng xuất tài khoản?')) {
      try {
        await logoutUser();
      } catch {
        // AppContext already keeps the session consistent and surfaces the error.
      }
    }
  };

  return (
    <>
      <header className="main-header">
        <div className="header-container container">
          {/* Item 145 Fix: Brand Logo as accessible button */}
          <button 
            type="button"
            className="header-brand" 
            onClick={() => safeNavigate('home')}
            aria-label="VocabMaster - Trang chủ"
          >
            <div className="brand-logo-icon">
              <BookOpen size={24} color="#ffffff" aria-hidden="true" />
            </div>
            <div className="brand-text-group">
              <span className="brand-title">VocabMaster</span>
            </div>
          </button>

          {/* Navigation Links */}
          <nav className="header-nav hide-mobile">
            <button 
              type="button"
              className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
              onClick={() => safeNavigate('home')}
              aria-current={activeView === 'home' ? 'page' : undefined}
              aria-label={`Bộ từ vựng, ${sets.length} bộ`}
            >
              <Layers size={18} />
              <span>Bộ từ vựng</span>
              <span className="nav-badge">{sets.length}</span>
            </button>
          </nav>

          {/* Action Controls & User Account */}
          <div className="header-actions">
            {/* 🔥 Streak Counter */}
            <div
              className="streak-badge-wrapper"
              title={`Chuỗi ngày học liên tiếp: ${streak.count} ngày`}
              aria-label={`Chuỗi ngày học liên tiếp: ${streak.count} ngày`}
            >
              <Flame size={18} className="streak-flame-icon" aria-hidden="true" />
              <span className="streak-count-text" aria-hidden="true">{streak.count}<span className="hide-mobile"> ngày</span></span>
            </div>

            {/* Backup / Export JSON Button */}
            <button
              type="button"
              className="btn btn-secondary btn-icon-only hide-mobile"
              onClick={() => setIsImportExportOpen(true)}
              title="Sao lưu & Khôi phục file JSON"
              aria-label="Mở sao lưu và khôi phục dữ liệu"
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
                  type="button"
                  className="logout-btn"
                  onClick={handleLogoutClick}
                  title="Đăng xuất tài khoản"
                  aria-label={`Đăng xuất tài khoản ${user.username}`}
                >
                  <LogOut size={16} />
                  <span className="hide-mobile">Thoát</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="auth-header-btn"
                onClick={() => setIsAuthModalOpen(true)}
                title="Đăng nhập hoặc đăng ký tài khoản"
              >
                <LogIn size={16} />
                <span>Đăng nhập</span>
              </button>
            )}

            <button 
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={`Chuyển sang chế độ ${theme === 'light' ? 'tối' : 'sáng'}`}
              title={`Chuyển sang chế độ ${theme === 'light' ? 'Tối' : 'Sáng'}`}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <button 
              type="button"
              className="btn btn-primary btn-sm hide-mobile"
              onClick={() => safeNavigate('create')}
            >
              <Plus size={18} />
              Tạo mới
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Dock */}
      <nav className="mobile-bottom-nav" aria-label="Điều hướng chính trên thiết bị di động">
        <button 
          type="button"
          className={`mobile-nav-item ${activeView === 'home' ? 'active' : ''}`}
          onClick={() => safeNavigate('home')}
          aria-current={activeView === 'home' ? 'page' : undefined}
          aria-label={`Bộ từ, ${sets.length} bộ`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Layers size={20} />
            {sets.length > 0 && <span className="mobile-nav-badge">{sets.length}</span>}
          </div>
          <span>Bộ từ</span>
        </button>

        <button 
          type="button"
          className={`mobile-nav-item ${activeView === 'create' || activeView === 'edit' ? 'active' : ''}`}
          onClick={() => safeNavigate('create')}
          aria-current={activeView === 'create' || activeView === 'edit' ? 'page' : undefined}
        >
          <div className="mobile-nav-icon-wrapper create-icon">
            <Plus size={22} />
          </div>
          <span>Tạo mới</span>
        </button>

        <button 
          type="button"
          className="mobile-nav-item"
          onClick={() => (user ? handleLogoutClick() : setIsAuthModalOpen(true))}
          aria-label={user ? `Đăng xuất tài khoản ${user.username}` : 'Mở đăng nhập hoặc đăng ký'}
        >
          <div className="mobile-nav-icon-wrapper">
            {user ? <LogOut size={20} /> : <LogIn size={20} />}
          </div>
          <span title={user?.username}>{user ? user.username : 'Tài khoản'}</span>
        </button>

        <button 
          type="button"
          className="mobile-nav-item"
          onClick={() => setIsImportExportOpen(true)}
          aria-label="Mở sao lưu và khôi phục dữ liệu"
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
