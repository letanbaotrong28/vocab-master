import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeft, 
  Keyboard, 
  CheckCircle, 
  XCircle, 
  RotateCcw, 
  Volume2, 
  ArrowRight,
  BookOpen,
  BrainCircuit,
  BarChart2,
  ArrowRightLeft,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useApp } from '../context/useApp';

// Item 55 Fix: Fisher-Yates Shuffle Algorithm
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const TypingView = () => {
  const { currentSet, navigateTo, recordWordResult, showToast } = useApp();

  const [direction, setDirection] = useState('vn_to_en');
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputWord, setInputWord] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [results, setResults] = useState({ correct: 0, wrong: 0, history: [] });
  const [isFinished, setIsFinished] = useState(false);
  const [isComposing, setIsComposing] = useState(false); // Item 122 Fix: IME Composition handling
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const inputRef = useRef(null);
  // Snapshot vocabulary once for this keyed study session. Recording progress
  // changes card stats, but should not rebuild/serialize the question source.
  const [typingSourceJson] = useState(() => JSON.stringify({
    id: currentSet?.id ?? null,
    cards: (currentSet?.cards || []).map(card => ({
      id: card.id,
      english: card.english,
      vietnamese: card.vietnamese,
      example: card.example,
      exampleTranslation: card.exampleTranslation
    }))
  }));

  // Item 60 Fix: Enhanced string normalization (replaces hyphens with space, strips quotes/punctuation)
  const normalize = (str) => {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/[-_]/g, ' ') // Replace hyphens with space (well-known -> well known)
      .replace(/[.,/#!$%^&*;:{}=`~()?"'’]/g, '')
      .replace(/\s+/g, ' ');
  };

  const startTypingSession = useCallback(() => {
    const currentSet = JSON.parse(typingSourceJson);
    if (!currentSet || !currentSet.cards || currentSet.cards.length === 0) return;
    
    const prepared = currentSet.cards.map(card => {
      let modeType = direction;

      if (modeType === 'ex_mix') {
        modeType = Math.random() > 0.5 ? 'ex_vn_to_en' : 'ex_en_to_vn';
      } else if (modeType === 'mix') {
        modeType = Math.random() > 0.5 ? 'vn_to_en' : 'en_to_vn';
      }

      // Fall back to word mode if example sentence is missing
      if (modeType.startsWith('ex_') && (!card.example || !card.example.trim())) {
        modeType = modeType === 'ex_vn_to_en' ? 'vn_to_en' : 'en_to_vn';
      }

      let prompt = '';
      let expected = '';
      let promptLang = '';
      let expectedLang = '';
      let isVnToEn = false;

      if (modeType === 'ex_vn_to_en') {
        prompt = (card.exampleTranslation || card.vietnamese).trim();
        expected = card.example.trim();
        promptLang = 'Dịch câu ví dụ Tiếng Việt';
        expectedLang = 'câu ví dụ Tiếng Anh';
        isVnToEn = true;
      } else if (modeType === 'ex_en_to_vn') {
        prompt = card.example.trim();
        expected = (card.exampleTranslation || card.vietnamese).trim();
        promptLang = 'Câu ví dụ Tiếng Anh';
        expectedLang = 'bản dịch Tiếng Việt';
        isVnToEn = false;
      } else if (modeType === 'en_to_vn') {
        prompt = card.english.trim();
        expected = card.vietnamese.trim();
        promptLang = 'Từ Tiếng Anh';
        expectedLang = 'nghĩa Tiếng Việt';
        isVnToEn = false;
      } else {
        // default vn_to_en
        prompt = card.vietnamese.trim();
        expected = card.english.trim();
        promptLang = 'Nghĩa Tiếng Việt';
        expectedLang = 'từ Tiếng Anh';
        isVnToEn = true;
      }

      return {
        card,
        prompt,
        expected,
        promptLang,
        expectedLang,
        isVnToEn,
        isExampleMode: modeType.startsWith('ex_')
      };
    });

    setCards(shuffleArray(prepared));
    setCurrentIndex(0);
    setInputWord('');
    setIsAnswered(false);
    setResults({ correct: 0, wrong: 0, history: [] });
    setIsFinished(false);
  }, [direction, typingSourceJson]);

  useEffect(() => {
    const timer = setTimeout(startTypingSession, 0);
    return () => clearTimeout(timer);
  }, [startTypingSession]);

  // Item 59 Fix: Reliable auto-focus on input element mount
  useEffect(() => {
    if (!isFinished && !isAnswered && inputRef.current) {
      const timer = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, isAnswered, isFinished, cards.length]);

  // Keep hooks unconditional so invalid/deferred routes cannot change hook order.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.closest?.('[aria-modal="true"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        navigateTo('home');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateTo]);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!currentSet || !currentSet.cards || !currentSet.cards.length) {
    return (
      <div className="container p-8 text-center">
        <h2>Bộ từ vựng này không có dữ liệu!</h2>
        <button className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>Quay lại trang chủ</button>
      </div>
    );
  }

  const currentItem = cards[currentIndex];

  const handleCheckAnswer = async (e) => {
    if (e) e.preventDefault();
    if (isComposing || isAnswered || submittingRef.current || !currentItem) return;

    const userClean = normalize(inputWord);

    // A comma in an example sentence is punctuation, not an answer separator.
    const answerSources = currentItem.isExampleMode
      ? [currentItem.expected]
      : currentItem.expected.split(/[,;/]/);
    const acceptedAnswers = answerSources
      .map(ans => normalize(ans))
      .filter(Boolean);

    const correct = acceptedAnswers.some(targetClean => targetClean === userClean);

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await recordWordResult(currentSet.id, currentItem.card.id, correct);
    } catch (error) {
      showToast(error.message || 'Không thể lưu kết quả. Vui lòng thử lại.', 'warning');
      submittingRef.current = false;
      setIsSubmitting(false);
      return;
    }

    setIsCorrect(correct);
    setIsAnswered(true);

    setResults(prev => ({
      correct: correct ? prev.correct + 1 : prev.correct,
      wrong: !correct ? prev.wrong + 1 : prev.wrong,
      history: [
        ...prev.history,
        {
          cardId: currentItem.card.id,
          prompt: currentItem.prompt,
          expected: currentItem.expected,
          userTyped: inputWord.trim() || 'Bỏ qua',
          isCorrect: correct
        }
      ]
    }));

    submittingRef.current = false;
    setIsSubmitting(false);
  };

  // Item 63 Fix: Skip / Don't know button
  const handleSkipQuestion = async () => {
    if (isAnswered || submittingRef.current || !currentItem) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await recordWordResult(currentSet.id, currentItem.card.id, false);
    } catch (error) {
      showToast(error.message || 'Không thể lưu kết quả. Vui lòng thử lại.', 'warning');
      submittingRef.current = false;
      setIsSubmitting(false);
      return;
    }
    setInputWord('');
    setIsCorrect(false);
    setIsAnswered(true);

    setResults(prev => ({
      correct: prev.correct,
      wrong: prev.wrong + 1,
      history: [
        ...prev.history,
        {
          cardId: currentItem.card.id,
          prompt: currentItem.prompt,
          expected: currentItem.expected,
          userTyped: 'Bỏ qua',
          isCorrect: false
        }
      ]
    }));

    submittingRef.current = false;
    setIsSubmitting(false);
  };

  const handleNext = () => {
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setInputWord('');
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      if (results.correct > cards.length / 2 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }
    }
  };

  // Item 62 Fix: Pronounce actual prompt or expected English text accurately
  const speakTarget = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const isVn = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
    utterance.lang = isVn ? 'vi-VN' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  if (!cards || cards.length === 0) {
    return (
      <div className="study-view container animate-fade-in text-center p-8">
        <div style={{ padding: '4rem 0' }}>
          <div className="spinner mb-3"></div>
          <p className="text-muted">Đang khởi tạo bài học gõ từ...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="study-view typing-view container animate-fade-in">
      {/* Header */}
      <div className="study-header">
        <button className="btn btn-ghost" onClick={() => navigateTo('home')}>
          <ArrowLeft size={20} />
          Quay lại
        </button>

        <div className="study-title-group">
          <h2>{currentSet.title}</h2>
          <span className="mode-tag typing">
            <Keyboard size={15} /> Gõ từ & Luyện gõ
          </span>
        </div>

        {/* Direction Switcher & Mode Nav */}
        <div className="direction-mode-header">
          <div className="direction-select-group">
            <ArrowRightLeft size={16} className="text-muted" />
            <select 
              className="direction-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              title="Chọn hướng gõ từ"
              aria-label="Chọn hướng gõ từ"
            >
              <option value="vn_to_en">Tiếng Việt → Gõ Tiếng Anh</option>
              <option value="en_to_vn">Tiếng Anh → Gõ Tiếng Việt</option>
              <option value="mix">Mix (Xáo trộn)</option>
              <option value="ex_vn_to_en">Câu ví dụ: Tiếng Việt → Gõ Tiếng Anh</option>
              <option value="ex_en_to_vn">Câu ví dụ: Tiếng Anh → Gõ Tiếng Việt</option>
              <option value="ex_mix">Câu ví dụ: Mix</option>
            </select>
          </div>

          <nav className="study-mode-nav" aria-label="Chuyển chế độ học">
            <button 
              className="nav-mode-btn" 
              onClick={() => navigateTo('flashcards', currentSet.id)}
              title="Flashcards"
              aria-label="Chuyển sang Flashcards"
            >
              <BookOpen size={18} />
              <span className="nav-mode-label">Thẻ học</span>
            </button>
            <button 
              className="nav-mode-btn" 
              onClick={() => navigateTo('learn', currentSet.id)}
              title="Trắc nghiệm 4 đáp án"
              aria-label="Chuyển sang học bài"
            >
              <BrainCircuit size={18} />
              <span className="nav-mode-label">Học bài</span>
            </button>
            <button className="nav-mode-btn active" title="Gõ từ tiếng Anh" aria-label="Gõ từ" aria-current="page">
              <Keyboard size={18} />
              <span className="nav-mode-label">Gõ từ</span>
            </button>
            <button 
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
      </div>

      {!isFinished ? (
        <div className="typing-card card-shadow">
          {/* Progress Bar & Counter */}
          <div className="quiz-progress-bar-container">
            <div className="quiz-meta-info">
              <span className="quiz-step-text">
                Thẻ {currentIndex + 1} / {cards.length}
              </span>
              <span className="quiz-score-badge">
                <span className="score-correct">✓ {results.correct}</span>
                <span className="score-divider">|</span>
                <span className="score-wrong">✗ {results.wrong}</span>
              </span>
            </div>
            <div
              className="progress-bar"
              role="progressbar"
              aria-label="Tiến độ luyện gõ từ"
              aria-valuemin={1}
              aria-valuemax={cards.length}
              aria-valuenow={currentIndex + 1}
            >
              <div 
                className="progress-fill" 
                style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Typing Prompt Box */}
          <div className="typing-prompt-box animate-fade-in" key={currentIndex}>
            <span className="prompt-label">{currentItem.promptLang}:</span>
            <div className="prompt-content-row">
              <h3 className="prompt-word">{currentItem.prompt}</h3>
              <button 
                className="icon-btn-speech"
                onClick={() => speakTarget(currentItem.prompt)}
                title="Phát âm"
                aria-label={`Phát âm ${currentItem.prompt}`}
              >
                <Volume2 size={22} />
              </button>
            </div>
          </div>

          {/* Typing Form */}
          <form onSubmit={handleCheckAnswer} className="typing-form">
            <div className="form-group">
              <label className="form-label" htmlFor="typing-answer">
                Nhập {currentItem.expectedLang} chính xác:
              </label>
              <input
                ref={inputRef}
                id="typing-answer"
                type="text"
                className={`form-input typing-input ${
                  isAnswered ? (isCorrect ? 'correct' : 'wrong') : ''
                }`}
                placeholder={`Gõ ${currentItem.expectedLang}...`}
                value={inputWord}
                onChange={(e) => setInputWord(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isComposing) e.preventDefault();
                }}
                disabled={isAnswered || isSubmitting}
                aria-invalid={isAnswered && !isCorrect}
                aria-describedby={isAnswered ? 'typing-answer-feedback' : undefined}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>

            {/* Answer Feedback Banner */}
            {isAnswered && (
              <div id="typing-answer-feedback" className={`answer-feedback-banner ${isCorrect ? 'correct' : 'wrong'} animate-slide-down`} role="status" aria-live="polite" aria-atomic="true">
                <div className="feedback-icon-title">
                  {isCorrect ? (
                    <>
                      <CheckCircle size={24} className="text-success" />
                      <div>
                        <h4>Chính xác! Xuất sắc! 🎉</h4>
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle size={24} className="text-danger" />
                      <div>
                        <h4>Chưa đúng rồi!</h4>
                        <div className="feedback-correct-answer">
                          Đáp án đúng là: <strong>{currentItem.expected}</strong>
                        </div>
                      </div>
                    </>
                  )}
                  <button 
                    type="button" 
                    className="icon-btn-subtle ml-auto"
                    onClick={() => speakTarget(currentItem.expected)}
                    title="Nghe phát âm đáp án"
                    aria-label={`Nghe phát âm đáp án ${currentItem.expected}`}
                  >
                    <Volume2 size={20} />
                  </button>
                </div>
              </div>
            )}

            {/* Form Action Controls (Item 63 Fix: Skip button) */}
            <div className="typing-actions">
              {!isAnswered ? (
                <div className="flex items-center gap-3 w-full">
                  <button 
                    type="button" 
                    className="btn btn-secondary"
                    onClick={handleSkipQuestion}
                    disabled={isSubmitting}
                  >
                    <HelpCircle size={18} />
                    Không biết / Xem đáp án
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary ml-auto"
                    disabled={!inputWord.trim() || isSubmitting}
                  >
                    Kiểm tra đáp án (Enter)
                  </button>
                </div>
              ) : (
                <button 
                  type="button" 
                  className="btn btn-primary btn-lg w-full animate-bounce-short"
                  onClick={handleNext}
                  autoFocus
                >
                  <span>Câu tiếp theo</span>
                  <ArrowRight size={20} />
                </button>
              )}
            </div>
          </form>
        </div>
      ) : (
        /* Typing Session Finished Screen */
        <div className="quiz-results-card card-shadow animate-scale-up text-center" role="status" aria-live="polite">
          <div className="results-trophy-badge">
            <Sparkles size={36} className="text-warning" />
          </div>
          <h2>Hoàn Thành Luyện Gõ Từ!</h2>
          <p className="results-subtitle">Bạn đã gõ qua toàn bộ {cards.length} thuật ngữ</p>

          <div className="results-stats-row">
            <div className="result-stat-box success">
              <span className="stat-num">{results.correct}</span>
              <span className="stat-label">Gõ đúng</span>
            </div>
            <div className="result-stat-box danger">
              <span className="stat-num">{results.wrong}</span>
              <span className="stat-label">Gõ sai</span>
            </div>
            <div className="result-stat-box primary">
              <span className="stat-num">
                {cards.length > 0 ? Math.round((results.correct / cards.length) * 100) : 0}%
              </span>
              <span className="stat-label">Độ chính xác</span>
            </div>
          </div>

          {/* Item 121 & 122 Fix: History Review Table for Typing Session */}
          {results.history.length > 0 && (
            <div className="results-history-section mt-6 text-left">
              <h3 className="mb-3 font-semibold text-lg">Chi tiết các từ đã gõ & đáp án:</h3>
              <div className="history-list space-y-2">
                {results.history.map((h, i) => (
                  <div key={i} className={`p-3 rounded-lg border flex flex-col md:flex-row justify-between items-start md:items-center gap-2 ${h.isCorrect ? 'bg-success-subtle border-success' : 'bg-danger-subtle border-danger'}`}>
                    <div>
                      <span className="font-medium">{i + 1}. {h.prompt}:</span>
                      <span className="ml-2 text-muted">Đã gõ: <strong className={h.isCorrect ? 'text-success' : 'text-danger'}>{h.userTyped}</strong></span>
                    </div>
                    {!h.isCorrect && (
                      <div className="text-sm text-danger">
                        Đáp án đúng: <strong>{h.expected}</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="results-actions-group mt-6">
            <button className="btn btn-secondary" onClick={startTypingSession}>
              <RotateCcw size={18} />
              Luyện lại từ đầu
            </button>

            {results.wrong > 0 && (
              <button 
                className="btn btn-warning" 
                onClick={() => {
                  const wrongCardIds = new Set(results.history.filter(h => !h.isCorrect).map(h => String(h.cardId)));
                  const filteredCards = cards.filter(c => wrongCardIds.has(String(c.card.id)));
                  if (filteredCards.length > 0) setCards(filteredCards);
                  setCurrentIndex(0);
                  setInputWord('');
                  setIsAnswered(false);
                  setIsCorrect(false);
                  setResults({ correct: 0, wrong: 0, history: [] });
                  setIsFinished(false);
                }}
              >
                <Keyboard size={18} />
                Luyện lại {results.wrong} từ gõ sai
              </button>
            )}

            <button className="btn btn-primary" onClick={() => navigateTo('home')}>
              Quay lại Trang chủ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
