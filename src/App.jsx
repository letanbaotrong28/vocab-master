import React from 'react';
import { AppProvider } from './context/AppContext';
import { useApp } from './context/useApp';
import { Header } from './components/Header';
import { Toast } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { ImportExportModal } from './components/ImportExportModal';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BookOpen } from 'lucide-react';
import { StudyWorkspace } from './components/StudyWorkspace';

import { HomeView } from './views/HomeView';
import { SetEditorView } from './views/SetEditorView';

const STUDY_VIEWS = new Set(['flashcards', 'learn', 'typing', 'progress']);

const MainContent = () => {
  const { activeView, currentSetId, toast, confirmModal, setConfirmModal, isAuthLoading } = useApp();
  const mainContentRef = React.useRef(null);

  React.useEffect(() => {
    if (isAuthLoading) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      if (document.querySelector('[aria-modal="true"]')) return;
      mainContentRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeView, currentSetId, isAuthLoading]);

  // Item 110 Fix: Loading Splash Screen during initial Auth Check
  if (isAuthLoading) {
    return (
      <div className="auth-splash-screen flex flex-col items-center justify-center min-h-screen text-center p-8">
        <div className="app-logo-badge mb-4">
          <BookOpen size={40} className="text-primary animate-bounce-short" />
        </div>
        <h2 className="text-primary font-bold text-xl mb-2">VocabMaster</h2>
        <div className="spinner mb-3"></div>
        <p className="text-muted text-sm">Đang kiểm tra phiên đăng nhập và tải bộ từ vựng...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Header />
      <main ref={mainContentRef} className="main-body" tabIndex={-1} aria-label="Nội dung chính">
        {activeView === 'home' && <HomeView />}
        {(activeView === 'create' || activeView === 'edit') && <SetEditorView />}
        {STUDY_VIEWS.has(activeView) && (
          <StudyWorkspace key={currentSetId || 'no-set'} activeView={activeView} />
        )}
      </main>

      {/* Toast Notifications */}
      <Toast toast={toast} />

      {/* Global Confirmation Modal */}
      <ConfirmModal 
        modal={confirmModal} 
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} 
      />

      {/* Import / Export JSON Modal */}
      <ImportExportModal />

      {/* Auth Login / Register Modal */}
      <AuthModal />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
