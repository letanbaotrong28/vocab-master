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
  BarChart2
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const FlashcardView = () => {
  const { currentSet, navigateTo, showToast } = useApp();

  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);

  useEffect(() => {
    if (currentSet && currentSet.cards && currentSet.cards.length > 0) {
      setCards(currentSet.cards);
      setCurrentIndex(0);
      setIsFlipped(false);
    }
  }, [currentSet?.id, currentSet?.updatedAt]);

  // Flip card handler
  const handleFlip = () => {
    setIsFlipped(prev => !prev);
  };

  // Next card
  const handleNext = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex(prev => (cards.length > 0 ? (prev < cards.length - 1 ? prev + 1 : 0) : 0));
  }, [cards.length]);

  // Previous card
  const handlePrev = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex(prev => (cards.length > 0 ? (prev > 0 ? prev - 1 : cards.length - 1) : 0));
  }, [cards.length]);

  // Shuffle Cards
  const handleShuffle = () => {
    setIsFlipped(false);
    if (isShuffled) {
      setCards(currentSet?.cards || []);
      setIsShuffled(false);
      showToast('Đã khôi phục thứ tự ban đầu');
    } else {
      const shuffled = [...cards].sort(() => Math.random() - 0.5);
      setCards(shuffled);
      setIsShuffled(true);
      showToast('Đã xáo trộn danh sách thẻ!', 'info');
    }
    setCurrentIndex(0);
  };

  // Text-To-Speech (Native Web Speech API with Auto Language Detection)
  const speakEnglish = (e, text) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const isVn = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
      utterance.lang = isVn ? 'vi-VN' : 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } else {
      showToast('Trình duyệt của bạn không hỗ trợ phát âm thanh.', 'warning');
    }
  };

  // Keyboard Shortcuts (Space/Enter to flip, Left/Right arrows to navigate) - Items 101 & 102 Fixes
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT' || e.target.isContentEditable) {
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleFlip();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev]);

  if (!currentSet || !cards.length) {
    return (
      <div className="container animate-fade-in text-center p-8">
        <h2>Không tìm thấy bộ từ vựng hoặc bộ từ vựng rỗng!</h2>
        <button className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>
          Quay lại trang chủ
        </button>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  return (
    <div className="study-view container animate-fade-in">
      {/* Top Header & Mode Navigation */}
      <div className="study-header">
        <button className="btn btn-ghost" onClick={() => navigateTo('home')}>
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
        <div className="study-mode-nav">
          <button className="nav-mode-btn active" title="Flashcards">
            <BookOpen size={18} />
          </button>
          <button 
            className="nav-mode-btn" 
            onClick={() => navigateTo('learn', currentSet.id)}
            title="Trắc nghiệm 4 đáp án"
          >
            <BrainCircuit size={18} />
          </button>
          <button 
            className="nav-mode-btn" 
            onClick={() => navigateTo('typing', currentSet.id)}
            title="Gõ từ tiếng Anh"
          >
            <Keyboard size={18} />
          </button>
          <button 
            className="nav-mode-btn" 
            onClick={() => navigateTo('progress', currentSet.id)}
            title="Thống kê"
          >
            <BarChart2 size={18} />
          </button>
        </div>
      </div>

      {/* Progress Bar & Shuffle Control */}
      <div className="flashcard-toolbar">
        <div className="progress-counter">
          <span className="current-num">{currentIndex + 1}</span>
          <span className="divider">/</span>
          <span className="total-num">{cards.length}</span>
        </div>

        <div className="toolbar-controls">
          <button 
            className={`btn-icon-label ${isShuffled ? 'active' : ''}`}
            onClick={handleShuffle}
            title="Xáo trộn thẻ"
          >
            <Shuffle size={18} />
            <span>Xáo trộn</span>
          </button>
        </div>
      </div>

      {/* Central 3D Flashcard Container */}
      <div className="flashcard-container">
        <div 
          className={`flashcard-3d ${isFlipped ? 'flipped' : ''}`}
          onClick={handleFlip}
          tabIndex={0}
          role="button"
          aria-label="Click or press space to flip card"
        >
          {/* Front Face: English Word & English Example */}
          <div className="card-face card-front">
            <div className="face-header">
              <span className="face-lang-badge">ENGLISH</span>
              <button 
                className="speech-btn" 
                onClick={(e) => speakEnglish(e, currentCard.english)}
                title="Nghe phát âm"
              >
                <Volume2 size={22} />
              </button>
            </div>

            <div className="face-content">
              <h1 className="card-word">{currentCard.english}</h1>
              {currentCard.example && (
                <div className="card-example">
                  <p className="example-text">"{currentCard.example}"</p>
                </div>
              )}
            </div>

            <div className="face-footer">
              <span className="flip-hint">
                <RotateCw size={15} /> Nhấn để lật xem nghĩa tiếng Việt (Phím Space)
              </span>
            </div>
          </div>

          {/* Back Face: Vietnamese Meaning & Translated Example Sentence */}
          <div className="card-face card-back">
            <div className="face-header">
              <span className="face-lang-badge vietnamese">TIẾNG VIỆT</span>
              <button 
                className="speech-btn" 
                onClick={(e) => speakEnglish(e, currentCard.english)}
                title="Nghe lại phát âm tiếng Anh"
              >
                <Volume2 size={22} />
              </button>
            </div>

            <div className="face-content">
              <h1 className="card-word vietnamese-meaning">{currentCard.vietnamese}</h1>
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
                <RotateCw size={15} /> Nhấn để quay lại mặt tiếng Anh
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Flashcard Navigation Controls */}
      <div className="flashcard-navigation">
        <button 
          className="nav-arrow-btn" 
          onClick={handlePrev}
          title="Thẻ trước (Mũi tên Trái)"
        >
          <ChevronLeft size={28} />
        </button>

        <button className="flip-action-btn" onClick={handleFlip}>
          <RotateCw size={18} />
          Lật thẻ
        </button>

        <button 
          className="nav-arrow-btn" 
          onClick={handleNext}
          title="Thẻ tiếp theo (Mũi tên Phải)"
        >
          <ChevronRight size={28} />
        </button>
      </div>

      {/* Shortcuts Helper */}
      <div className="keyboard-shortcuts-hint">
        <span className="hide-mobile">💡 Mẹo bàn phím: <code>Phím Trái</code> = Trước, <code>Phím Phải</code> = Tiếp, <code>Space</code> = Lật thẻ</span>
        <span className="show-mobile-only">💡 Chạm thẻ để lật mặt • Dùng 2 nút mũi tên bên dưới để chuyển thẻ</span>
      </div>
    </div>
  );
};
