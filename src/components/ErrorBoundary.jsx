import React from 'react';
import { AlertOctagon, RotateCcw, Home } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught rendering error:', error, errorInfo);
  }

  componentDidUpdate(_previousProps, previousState) {
    if (!previousState.hasError && this.state.hasError) {
      this.errorHeading?.focus({ preventScroll: true });
    }
  }

  componentDidMount() {
    this.handleUnhandledRejection = (e) => {
      console.error('Unhandled Promise Rejection caught in ErrorBoundary:', e.reason);
      this.setState({
        hasError: true,
        error: e.reason instanceof Error ? e.reason : new Error(String(e.reason || 'Unhandled promise rejection'))
      });
    };
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    if (this.handleUnhandledRejection) {
      window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    }
  }

  // Item 130 Fix: Selectively clear ONLY app-specific keys instead of destructive localStorage.clear()
  handleResetApp = () => {
    const confirmed = window.confirm(
      'Thao tác này sẽ xóa bộ từ vựng, tiến trình và tùy chọn đang lưu trên thiết bị này. Dữ liệu chưa đồng bộ sẽ không thể khôi phục. Bạn có chắc chắn muốn tiếp tục?'
    );
    if (!confirmed) return;

    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('vocabmaster_') || key.startsWith('quizlet_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="container p-8 text-center animate-fade-in error-boundary-shell">
          <div className="error-boundary-card card card-shadow max-w-lg mx-auto p-8" role="alert" aria-labelledby="error-boundary-title" aria-describedby="error-boundary-description">
            <div className="text-danger mb-4 flex justify-center">
              <AlertOctagon size={48} />
            </div>
            <h2
              id="error-boundary-title"
              ref={(element) => { this.errorHeading = element; }}
              className="mb-2"
              tabIndex={-1}
            >
              Đã xảy ra lỗi không mong muốn!
            </h2>
            <p id="error-boundary-description" className="text-muted mb-6">
              Hãy thử tải lại trang trước. Chỉ xóa dữ liệu cục bộ nếu lỗi vẫn tiếp diễn và bạn đã sao lưu hoặc đồng bộ dữ liệu cần giữ.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button 
                type="button"
                className="btn btn-secondary" 
                onClick={() => window.location.reload()}
              >
                <Home size={18} />
                Tải lại trang
              </button>
              <button 
                type="button"
                className="btn btn-primary" 
                onClick={this.handleResetApp}
              >
                <RotateCcw size={18} />
                Xóa dữ liệu cục bộ
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
