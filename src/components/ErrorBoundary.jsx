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

  handleResetApp = () => {
    try {
      localStorage.clear();
    } catch (e) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="container p-8 text-center animate-fade-in" style={{ padding: '6rem 1rem' }}>
          <div className="error-boundary-card card card-shadow max-w-lg mx-auto p-8" style={{ margin: '0 auto', maxWidth: '500px' }}>
            <div className="text-danger mb-4 flex justify-center">
              <AlertOctagon size={48} />
            </div>
            <h2 className="mb-2">Đã xảy ra lỗi không mong muốn!</h2>
            <p className="text-muted mb-6" style={{ fontSize: '0.92rem' }}>
              Ứng dụng gặp sự cố khi xử lý dữ liệu. Bạn có thể khôi phục lại ứng dụng hoặc dọn dẹp bộ nhớ tạm.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button 
                className="btn btn-secondary" 
                onClick={() => window.location.reload()}
              >
                <Home size={18} />
                Tải lại trang
              </button>
              <button 
                className="btn btn-primary" 
                onClick={this.handleResetApp}
              >
                <RotateCcw size={18} />
                Khôi phục dữ liệu ban đầu
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
