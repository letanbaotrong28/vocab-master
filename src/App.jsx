import React, { lazy, Suspense } from 'react';
import { AppProvider } from './context/AppContext';
import { useApp } from './context/useApp';
import { Header } from './components/Header';
import { Toast } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { ImportExportModal } from './components/ImportExportModal';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BookOpen } from 'lucide-react';

import { HomeView } from './views/HomeView';

// Item 116 Fix: Code splitting & Lazy Loading for heavy views
const SetEditorView = lazy(() => import('./views/SetEditorView').then(m => ({ default: m.SetEditorView })));
const FlashcardView = lazy(() => import('./views/FlashcardView').then(m => ({ default: m.FlashcardView })));
const LearnView = lazy(() => import('./views/LearnView').then(m => ({ default: m.LearnView })));
const TypingView = lazy(() => import('./views/TypingView').then(m => ({ default: m.TypingView })));
const ProgressView = lazy(() => import('./views/ProgressView').then(m => ({ default: m.ProgressView })));

const ViewFallback = () => (
  <div className="container p-8 text-center" style={{ padding: '4rem 1rem' }}>
    <div className="spinner mb-3" style={{ margin: '0 auto' }}></div>
    <p className="text-muted text-sm">Đang tải màn hình học bài...</p>
  </div>
);

const MainContent = () => {
  const { activeView, currentSetId, toast, confirmModal, setConfirmModal, isAuthLoading } = useApp();

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
      <main className="main-body">
        <Suspense fallback={<ViewFallback />}>
          {activeView === 'home' && <HomeView />}
          {(activeView === 'create' || activeView === 'edit') && <SetEditorView />}
          {activeView === 'flashcards' && <FlashcardView key={currentSetId || 'no-set'} />}
          {activeView === 'learn' && <LearnView key={currentSetId || 'no-set'} />}
          {activeView === 'typing' && <TypingView key={currentSetId || 'no-set'} />}
          {activeView === 'progress' && <ProgressView key={currentSetId || 'no-set'} />}
        </Suspense>
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
