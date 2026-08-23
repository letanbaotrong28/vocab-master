import React, { useState } from 'react';
import { X, User, Lock, Eye, EyeOff, LogIn, UserPlus, ShieldCheck, AlertCircle } from 'lucide-react';
import { useApp } from '../context/useApp';

export const AuthModal = () => {
  const { isAuthModalOpen, setIsAuthModalOpen, loginUser, registerUser } = useApp();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (!isAuthModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) {
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
        setError('');
        setIsAuthModalOpen(false);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthModalOpen, loading, setIsAuthModalOpen]);

  if (!isAuthModalOpen) return null;

  // Item 31 & 32 Fix: Reset form & showPassword state on close or switch
  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setError('');
  };

  // Item 33 Fix: Block closing modal while login/register request is running
  const handleClose = () => {
    if (loading) return;
    resetForm();
    setIsAuthModalOpen(false);
  };

  const switchTab = (newMode) => {
    if (loading) return;
    setMode(newMode);
    resetForm();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!username.trim()) {
      setError('Vui lòng nhập tên tài khoản.');
      return;
    }

    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }

    if (mode === 'register') {
      if (username.trim().length < 3) {
        setError('Tên tài khoản phải từ 3 ký tự trở lên.');
        return;
      }
      if (password.length < 6) {
        setError('Mật khẩu phải từ 6 ký tự trở lên.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Mật khẩu xác nhận không trùng khớp.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await loginUser(username.trim(), password);
      } else {
        await registerUser(username.trim(), password);
      }
      resetForm();
      setIsAuthModalOpen(false);
    } catch (err) {
      setError(err.message || 'Thao tác không thành công.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="modal-backdrop" 
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="modal-content animate-scale-up auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge primary">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h3 id="auth-modal-title" className="modal-title">
                {mode === 'login' ? 'Đăng Nhập Tài Khoản' : 'Tạo Tài Khoản Mới'}
              </h3>
            </div>
          </div>
          <button className="btn-icon" onClick={handleClose} disabled={loading} aria-label="Đóng bảng đăng nhập">
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="modal-tabs-nav">
          <button
            type="button"
            className={`modal-tab-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchTab('login')}
            disabled={loading}
          >
            <LogIn size={16} />
            Đăng Nhập
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchTab('register')}
            disabled={loading}
          >
            <UserPlus size={16} />
            Tạo Tài Khoản
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-alert mb-3" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="auth-username" className="form-label">Tên tài khoản</label>
              <div className="input-icon-wrapper">
                <User size={18} className="input-icon" />
                <input
                  id="auth-username"
                  type="text"
                  className="form-input with-icon"
                  placeholder="Nhập tên đăng nhập..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="auth-password" className="form-label">Mật khẩu</label>
              <div className="input-icon-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input with-icon"
                  placeholder="Nhập mật khẩu..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="form-group">
                <label htmlFor="auth-confirm-password" className="form-label">Nhập lại mật khẩu</label>
                <div className="input-icon-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    id="auth-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input with-icon"
                    placeholder="Xác nhận lại mật khẩu..."
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg w-full mt-4"
              disabled={loading}
            >
              {loading ? (
                <span>Đang xử lý...</span>
              ) : mode === 'login' ? (
                <>
                  <LogIn size={18} />
                  <span>Đăng Nhập Ngay</span>
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  <span>Đăng Ký Tài Khoản</span>
                </>
              )}
            </button>
          </form>
        </div>

        <div className="modal-footer justify-between">
          <span className="privacy-note">
            {mode === 'login'
              ? 'Chưa có tài khoản? Chuyển sang tab Đăng ký để tạo mới.'
              : 'Đã có tài khoản? Chuyển sang tab Đăng nhập.'}
          </span>
          <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
