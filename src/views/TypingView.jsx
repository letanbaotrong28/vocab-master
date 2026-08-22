import React, { useState, useEffect, useRef } from 'react';
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
  Award,
  ArrowRightLeft,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useApp } from '../context/AppContext';

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
  const { currentSet, navigateTo, recordWordResult, recordStreak } = useApp();

  const [direction, setDirection] = useState('vn_to_en');
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputWord, setInputWord] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [results, setResults] = useState({ correct: 0, wrong: 0, history: [] });
  const [isFinished, setIsFinished] = useState(false);
  const [isComposing, setIsComposing] = useState(false); // Item 122 Fix: IME Composition handling

  const inputRef = useRef(null);

  // Item 60 Fix: Enhanced string normalization (replaces hyphens with space, strips quotes/punctuation)
  const normalize = (str) => {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/[-_]/g, ' ') // Replace hyphens with space (well-known -> well known)
      .replace(/[.,/#!$%^&*;:{}=`~()?"'’]/g, '')
      .replace(/\s+/g, ' ');
  };

  const startTypingSession = () => {
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
        isVnToEn
      };
    });

    setCards(shuffleArray(prepared));
    setCurrentIndex(0);
    setInputWord('');
    setIsAnswered(false);
    setResults({ correct: 0, wrong: 0, history: [] });
    setIsFinished(false);
  };

  useEffect(() => {
    startTypingSession();
  }, [currentSet?.id, direction]);

  // Item 59 Fix: Reliable auto-focus on input element mount
  useEffect(() => {
    if (!isFinished && !isAnswered && inputRef.current) {
      const timer = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, isAnswered, isFinished, cards.length]);

  if (!currentSet || !currentSet.cards || !currentSet.cards.length) {
    return (
      <div className="container p-8 text-center">
        <h2>Bộ từ vựng này không có dữ liệu!</h2>
        <button className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>Quay lại trang chủ</button>
      </div>
    );
  }

  const currentItem = cards[currentIndex];

  // Item 118 Fix: Handle Esc key navigation to home
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        navigateTo('home');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCheckAnswer = async (e) => {
    if (e) e.preventDefault();
    if (isAnswered || !currentItem) return;

    const userClean = normalize(inputWord);

    // Item 61 Fix: Synonym matching (splits expected answers by comma / slash / semicolon)
    const acceptedAnswers = currentItem.expected
      .split(/[,/;/]/)
      .map(ans => normalize(ans))
      .filter(Boolean);

    const correct = acceptedAnswers.some(targetClean => targetClean === userClean);

    setIsCorrect(correct);
    setIsAnswered(true);

    // Item 116 Fix: Await recordWordResult to maintain correct call sequence
    try {
      if (recordWordResult && currentSet) {
        await recordWordResult(currentSet.id, currentItem.card.id, correct);
      }
      if (recordStreak && correct) {
        recordStreak();
      }
    } catch (err) {
      console.error('Error recording word result:', err);
    }

    setResults(prev => ({
      correct: correct ? prev.correct + 1 : prev.correct,
      wrong: !correct ? prev.wrong + 1 : prev.wrong,
      history: [
        ...prev.history,
        {
          prompt: currentItem.prompt,
          expected: currentItem.expected,
          userTyped: inputWord.trim() || 'Bỏ qua',
          isCorrect: correct
        }
      ]
    }));
  };

  // Item 63 Fix: Skip / Don't know button
  const handleSkipQuestion = () => {
    if (isAnswered) return;
    setInputWord('');
    setIsCorrect(false);
    setIsAnswered(true);

    recordWordResult(currentSet.id, currentItem.card.id, false);
    recordStreak();

    setResults(prev => ({
      correct: prev.correct,
      wrong: prev.wrong + 1,
      history: [
        ...prev.history,
        {
          prompt: currentItem.prompt,
          expected: currentItem.expected,
          userTyped: 'Bỏ qua',
          isCorrect: false
        }
      ]
    }));
  };

  const handleNext = () => {
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setInputWord('');
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      if (results.correct > cards.length / 2) {
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
    <div className="study-view container animate-fade-in">
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
            >
              <option value="vn_to_en">Tiếng Việt → Gõ Tiếng Anh</option>
              <option value="en_to_vn">Tiếng Anh → Gõ Tiếng Việt</option>
              <option value="mix">Mix (Xáo trộn)</option>
              <option value="ex_vn_to_en">Câu ví dụ: Tiếng Việt → Gõ Tiếng Anh</option>
              <option value="ex_en_to_vn">Câu ví dụ: Tiếng Anh → Gõ Tiếng Việt</option>
              <option value="ex_mix">Câu ví dụ: Mix</option>
            </select>
          </div>

          <div className="study-mode-nav">
            <button 
              className="nav-mode-btn" 
              onClick={() => navigateTo('flashcards', currentSet.id)}
              title="Flashcards"
            >
              <BookOpen size={18} />
            </button>
            <button 
              className="nav-mode-btn" 
              onClick={() => navigateTo('learn', currentSet.id)}
              title="Trắc nghiệm 4 đáp án"
            >
              <BrainCircuit size={18} />
            </button>
            <button className="nav-mode-btn active" title="Gõ từ tiếng Anh">
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
            <div className="progress-bar">
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
              >
                <Volume2 size={22} />
              </button>
            </div>
          </div>

          {/* Typing Form */}
          <form onSubmit={handleCheckAnswer} className="typing-form">
            <div className="form-group">
              <label className="form-label">
                Nhập {currentItem.expectedLang} chính xác:
              </label>
              <input
                ref={inputRef}
                type="text"
                className={`form-input typing-input ${
                  isAnswered ? (isCorrect ? 'correct' : 'wrong') : ''
                }`}
                placeholder={`Gõ ${currentItem.expectedLang}...`}
                value={inputWord}
                onChange={(e) => setInputWord(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                disabled={isAnswered}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>

            {/* Answer Feedback Banner */}
            {isAnswered && (
              <div className={`answer-feedback-banner ${isCorrect ? 'correct' : 'wrong'} animate-slide-down`}>
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
                  >
                    <HelpCircle size={18} />
                    Không biết / Xem đáp án
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary ml-auto"
                    disabled={!inputWord.trim()}
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
        <div className="quiz-results-card card-shadow animate-scale-up text-center">
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
                  const wrongPrompts = results.history.filter(h => !h.isCorrect).map(h => h.prompt);
                  const filteredCards = cards.filter(c => wrongPrompts.includes(c.prompt) || wrongPrompts.includes(c.expected));
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
