import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft, 
  Volume2, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight, 
  Shuffle, 
  BookOpen, 
  BrainCircuit, 
  Keyboard, 
  BarChart2,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { useApp } from '../context/useApp';

export const FlashcardView = () => {
  const { currentSet, navigateTo, showToast } = useApp();

  const [cards, setCards] = useState(() => (
    currentSet && Array.isArray(currentSet.cards) ? currentSet.cards : []
  ));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [cardResults, setCardResults] = useState(() => new Map());
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = React.useRef(false);
  const unlockTimerRef = React.useRef(null);

  // Item 115 Fix: Cancel TTS on component unmount
  useEffect(() => {
    return () => {
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Flip card handler
  const handleFlip = useCallback(() => {
    setIsFlipped(prev => !prev);
  }, []);

  // Next card
  const handleNext = useCallback(() => {
    setIsFlipped(false);
    if (cards.length === 0) return;
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setIsFinished(true);
    }
  }, [cards.length, currentIndex]);

  // Previous card
  const handlePrev = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, []);

  // Item 113 Fix: Fisher-Yates Shuffle Algorithm for uniform distribution
  const handleShuffle = () => {
    setIsFlipped(false);
    if (isShuffled) {
      setCards(currentSet?.cards || []);
      setIsShuffled(false);
      showToast('Đã khôi phục thứ tự ban đầu');
    } else {
      const arr = [...cards];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setCards(arr);
      setIsShuffled(true);
      showToast('Đã xáo trộn danh sách thẻ chuẩn Fisher-Yates!', 'info');
    }
    setCurrentIndex(0);
  };

  // Flashcard choices are session-only and intentionally do not update learning progress.
  const handleMarkCard = useCallback((isCorrect) => {
    if (recordingRef.current) return;
    const card = cards[currentIndex];
    if (!card || !currentSet) return;
    recordingRef.current = true;
    setIsRecording(true);
    setCardResults(previousResults => {
      const nextResults = new Map(previousResults);
      nextResults.set(String(card.id), isCorrect);
      return nextResults;
    });
    showToast(isCorrect ? 'Đã chọn: Đã biết!' : 'Đã chọn: Cần học lại', isCorrect ? 'success' : 'info');
    handleNext();
    unlockTimerRef.current = window.setTimeout(() => {
      recordingRef.current = false;
      setIsRecording(false);
      unlockTimerRef.current = null;
    }, 180);
  }, [cards, currentIndex, currentSet, handleNext, showToast]);

  const startReview = useCallback((learningOnly) => {
    const sourceCards = learningOnly
      ? cards.filter(card => cardResults.get(String(card.id)) !== true)
      : (currentSet?.cards || []);

    if (sourceCards.length === 0) {
      showToast('Không còn từ nào cần học lại.', 'success');
      return;
    }

    if (unlockTimerRef.current) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
    recordingRef.current = false;
    setIsRecording(false);
    setCards([...sourceCards]);
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsShuffled(false);
    setCardResults(new Map());
    setIsFinished(false);
    showToast(
      learningOnly
        ? `Bắt đầu ôn lại ${sourceCards.length} từ cần học lại.`
        : `Bắt đầu ôn lại toàn bộ ${sourceCards.length} thẻ.`,
      'info'
    );
  }, [cardResults, cards, currentSet, showToast]);

  // Item 115 Fix: Text-To-Speech with Voice Selection
  const speakEnglish = (e, text) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const isVn = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
      utterance.lang = isVn ? 'vi-VN' : 'en-US';
      utterance.rate = 0.9;

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const matchedVoice = voices.find(v => v.lang.startsWith(utterance.lang));
        if (matchedVoice) utterance.voice = matchedVoice;
      }
      window.speechSynthesis.speak(utterance);
    } else {
      showToast('Trình duyệt của bạn không hỗ trợ phát âm thanh.', 'warning');
    }
  };

  // Item 114 Fix: Keyboard Shortcuts ignoring input controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (e.target.closest?.('[aria-modal="true"]') || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
        return;
      }

      if (isFinished) return;

      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleMarkCard(false);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleMarkCard(true);
      } else if ((e.code === 'Space' || e.code === 'Enter') && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        handleFlip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFlip, handleMarkCard, isFinished]);

  if (!currentSet || !cards.length) {
    return (
      <div className="container text-center p-8">
        <h2>Không tìm thấy bộ từ vựng hoặc bộ từ vựng rỗng!</h2>
        <button type="button" className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>
          Quay lại trang chủ
        </button>
      </div>
    );
  }

  const currentCard = cards[currentIndex];
  const learningCards = cards.filter(card => cardResults.get(String(card.id)) !== true);
  const knownCardCount = cards.length - learningCards.length;

  return (
    <div className="study-view flashcard-view container">
      {/* Top Header & Mode Navigation */}
      <div className="study-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigateTo('home')}>
          <ArrowLeft size={20} />
          Quay lại
        </button>

        <div className="study-title-group">
          <h2>{currentSet.title}</h2>
          <span className="mode-tag">
            <BookOpen size={15} /> Flashcards
          </span>
        </div>

        {/* Quick Mode Switcher */}
        <nav className="study-mode-nav" aria-label="Chuyển chế độ học">
          <button type="button" className="nav-mode-btn active" title="Flashcards" aria-label="Flashcards" aria-current="page">
            <BookOpen size={18} />
            <span className="nav-mode-label">Thẻ học</span>
          </button>
          <button 
            type="button"
            className="nav-mode-btn" 
            onClick={() => navigateTo('learn', currentSet.id)}
            title="Trắc nghiệm 4 đáp án"
            aria-label="Chuyển sang học bài"
          >
            <BrainCircuit size={18} />
            <span className="nav-mode-label">Học bài</span>
          </button>
          <button 
            type="button"
            className="nav-mode-btn" 
            onClick={() => navigateTo('typing', currentSet.id)}
            title="Gõ từ tiếng Anh"
            aria-label="Chuyển sang luyện gõ từ"
          >
            <Keyboard size={18} />
            <span className="nav-mode-label">Gõ từ</span>
          </button>
          <button 
            type="button"
            className="nav-mode-btn" 
            onClick={() => navigateTo('progress', currentSet.id)}
            title="Thống kê"
            aria-label="Chuyển sang xem tiến trình"
          >
            <BarChart2 size={18} />
            <span className="nav-mode-label">Tiến trình</span>
          </button>
        </nav>
      </div>

      {isFinished ? (
        <div className="quiz-results-card flashcard-results-card card-shadow animate-scale-up text-center" role="status" aria-live="polite">
          <div className="results-trophy-badge">
            <Sparkles size={36} className="text-warning" />
          </div>
          <h2>Hoàn thành lượt thẻ!</h2>
          <p className="results-subtitle">Bạn đã duyệt qua toàn bộ {cards.length} thẻ trong lượt này.</p>

          <div className="results-stats-row flashcard-results-stats">
            <div className="result-stat-box success">
              <span className="stat-num">{knownCardCount}</span>
              <span className="stat-label">Đã biết</span>
            </div>
            <div className="result-stat-box danger">
              <span className="stat-num">{learningCards.length}</span>
              <span className="stat-label">Cần học lại</span>
            </div>
          </div>

          <div className="results-actions-group flashcard-results-actions">
            <button
              type="button"
              className="btn btn-warning"
              onClick={() => startReview(true)}
              disabled={learningCards.length === 0}
            >
              <BrainCircuit size={18} />
              {learningCards.length > 0
                ? `Ôn lại ${learningCards.length} từ cần học lại`
                : 'Không còn từ cần học lại'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => startReview(false)}>
              <RotateCcw size={18} />
              Ôn lại toàn bộ
            </button>
          </div>
        </div>
      ) : (
        <>
      {/* Progress Bar & Shuffle Control */}
      <div className="flashcard-toolbar">
        <div className="progress-counter">
          <span className="current-num">{currentIndex + 1}</span>
          <span className="divider">/</span>
          <span className="total-num">{cards.length}</span>
        </div>

        <div className="toolbar-controls">
          <button 
            type="button"
            className={`btn-icon-label ${isShuffled ? 'active' : ''}`}
            onClick={handleShuffle}
            title="Xáo trộn thẻ"
            aria-pressed={isShuffled}
          >
            <Shuffle size={18} />
            <span>Xáo trộn</span>
          </button>
        </div>
      </div>

      {/* Central 3D Flashcard Container */}
      <div className="flashcard-container">
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          Thẻ {currentIndex + 1} trên {cards.length}. {isFlipped ? `Mặt tiếng Việt: ${currentCard.vietnamese}` : `Mặt tiếng Anh: ${currentCard.english}`}.
        </p>
        <div 
          className={`flashcard-3d ${isFlipped ? 'flipped' : ''}`}
          role="group"
          aria-label={`Thẻ ${currentIndex + 1} trên ${cards.length}`}
        >
          {/* Front Face: English Word & English Example */}
          <article className="card-face card-front" aria-hidden={isFlipped} inert={isFlipped}>
            <div className="face-header">
              <span className="face-lang-badge">ENGLISH</span>
              <button 
                type="button"
                className="speech-btn" 
                onClick={(e) => speakEnglish(e, currentCard.english)}
                title="Nghe phát âm"
                aria-label={`Nghe phát âm từ ${currentCard.english}`}
              >
                <Volume2 size={22} />
              </button>
            </div>

            <div className="face-content">
              <h3 className="card-word" lang="en">{currentCard.english}</h3>
              {currentCard.example && (
                <div className="card-example">
                  <p className="example-text">"{currentCard.example}"</p>
                </div>
              )}
            </div>

            <div className="face-footer">
              <span className="flip-hint">
                <RotateCw size={15} aria-hidden="true" /> Dùng nút Lật thẻ hoặc phím Space để xem nghĩa
              </span>
            </div>
          </article>

          {/* Back Face: Vietnamese Meaning & Translated Example Sentence */}
          <article className="card-face card-back" aria-hidden={!isFlipped} inert={!isFlipped}>
            <div className="face-header">
              <span className="face-lang-badge vietnamese">TIẾNG VIỆT</span>
              <button 
                type="button"
                className="speech-btn" 
                onClick={(e) => speakEnglish(e, currentCard.english)}
                title="Nghe lại phát âm tiếng Anh"
                aria-label={`Nghe phát âm từ ${currentCard.english}`}
              >
                <Volume2 size={22} />
              </button>
            </div>

            <div className="face-content">
              <h3 className="card-word vietnamese-meaning" lang="vi">{currentCard.vietnamese}</h3>
              <p className="card-sub-word">"{currentCard.english}"</p>
              
              {/* Display translated sentence (or fallback to example if no translation) */}
              {(currentCard.exampleTranslation || currentCard.example) && (
                <div className="card-example back-example">
                  <p className="example-text">
                    "{currentCard.exampleTranslation || currentCard.example}"
                  </p>
                </div>
              )}
            </div>

            <div className="face-footer">
              <span className="flip-hint">
                <RotateCw size={15} aria-hidden="true" /> Dùng nút Lật thẻ hoặc phím Space để quay lại
              </span>
            </div>
          </article>
        </div>
      </div>

      {/* Flashcard Navigation Controls & Progress Marking (Item 112 UI Fix) */}
      <div className="flashcard-navigation">
        <button 
          type="button"
          className="nav-arrow-btn" 
          onClick={handlePrev}
          title="Chuyển về thẻ trước"
          aria-label="Chuyển đến thẻ trước"
          disabled={currentIndex === 0}
        >
          <ChevronLeft size={28} />
        </button>

        <button 
          type="button"
          className="btn btn-secondary mark-btn mark-learning"
          onClick={() => handleMarkCard(false)}
          disabled={isRecording}
          title="Đánh dấu cần học lại"
        >
          ❌ Cần học lại
        </button>

        <button type="button" className="flip-action-btn" onClick={handleFlip} aria-pressed={isFlipped}>
          <RotateCw size={18} />
          Lật thẻ
        </button>

        <button 
          type="button"
          className="btn btn-primary mark-btn mark-known"
          onClick={() => handleMarkCard(true)}
          disabled={isRecording}
          title="Đánh dấu đã biết từ này"
        >
          ✅ Đã biết
        </button>

        <button 
          type="button"
          className="nav-arrow-btn" 
          onClick={handleNext}
          title="Chuyển đến thẻ tiếp theo"
          aria-label="Chuyển đến thẻ tiếp theo"
        >
          <ChevronRight size={28} />
        </button>
      </div>

      {/* Shortcuts Helper */}
      <div className="keyboard-shortcuts-hint">
        <span className="hide-mobile">💡 Mẹo bàn phím: <code>Phím Trái</code> = Cần học lại, <code>Phím Phải</code> = Đã biết, <code>Space</code> = Lật thẻ</span>
        <span className="show-mobile-only">💡 Dùng nút Lật thẻ để đổi mặt • Dùng 2 nút mũi tên để chuyển thẻ</span>
      </div>
        </>
      )}
    </div>
  );
};
