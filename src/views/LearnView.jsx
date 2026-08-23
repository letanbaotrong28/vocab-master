import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft, 
  RotateCcw, 
  Check, 
  X, 
  Volume2, 
  ArrowRight, 
  BrainCircuit, 
  BookOpen, 
  Keyboard, 
  BarChart2,
  Sparkles,
  ArrowRightLeft,
  HelpCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useApp } from '../context/useApp';

// Item 55 Fix: Fisher-Yates Shuffle Algorithm for uniform distribution
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const normalizeChoice = value => String(value || '').trim().toLocaleLowerCase();

export const LearnView = () => {
  const { currentSet, sets, studyCardIds, recordWordResult, navigateTo, showToast } = useApp();

  const [direction, setDirection] = useState('en_to_vn'); // 'en_to_vn' | 'vn_to_en' | 'mix' | 'ex_en_to_vn' | 'ex_vn_to_en' | 'ex_mix'
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [results, setResults] = useState({ correct: 0, wrong: 0, history: [] });
  const [isFinished, setIsFinished] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = React.useRef(false);

  // The view is keyed by set id in App.jsx, so vocabulary can be snapshotted once
  // per study session. Progress updates then no longer serialize every card again.
  const [questionSourceJson] = useState(() => JSON.stringify({
    currentSetId: currentSet?.id ?? null,
    studyCardIds: Array.isArray(studyCardIds) ? studyCardIds.map(String) : null,
    sets: sets.map(set => ({
      id: set.id,
      cards: (set.cards || []).map(card => ({
        id: card.id,
        english: card.english,
        vietnamese: card.vietnamese,
        example: card.example,
        exampleTranslation: card.exampleTranslation
      }))
    }))
  }));

  // Helper to generate distinct options based on chosen direction (Items 52, 53, 54, 55 Fix)
  const generateQuestions = useCallback(() => {
    const { currentSetId, sets, studyCardIds } = JSON.parse(questionSourceJson);
    const currentSet = sets.find(set => String(set.id) === String(currentSetId));
    if (!currentSet || !currentSet.cards || currentSet.cards.length === 0) return [];

    const allEnglish = Array.from(new Set(sets.flatMap(s => s.cards.map(c => c.english.trim())).filter(Boolean)));
    const allVietnamese = Array.from(new Set(sets.flatMap(s => s.cards.map(c => c.vietnamese.trim())).filter(Boolean)));
    const allExamples = Array.from(new Set(sets.flatMap(s => s.cards.map(c => (c.example || '').trim())).filter(Boolean)));
    const allExampleTranslations = Array.from(new Set(sets.flatMap(s => s.cards.map(c => (c.exampleTranslation || '').trim())).filter(Boolean)));

    const selectedCardIds = Array.isArray(studyCardIds) && studyCardIds.length > 0
      ? new Set(studyCardIds.map(String))
      : null;
    const sessionCards = selectedCardIds
      ? currentSet.cards.filter(card => selectedCardIds.has(String(card.id)))
      : currentSet.cards;

    const questions = sessionCards.map((card) => {
      let isExampleMode = direction.startsWith('ex_');
      let modeType = direction;

      if (modeType === 'ex_mix') {
        modeType = Math.random() > 0.5 ? 'ex_en_to_vn' : 'ex_vn_to_en';
      } else if (modeType === 'mix') {
        modeType = Math.random() > 0.5 ? 'en_to_vn' : 'vn_to_en';
      }

      // Item 54 Fix: Fall back to word mode if card has no example sentence
      if (isExampleMode && (!card.example || !card.example.trim())) {
        modeType = modeType === 'ex_vn_to_en' ? 'vn_to_en' : 'en_to_vn';
        isExampleMode = false;
      }

      let promptText = '';
      let correctAnswer = '';
      let promptLabel = '';
      let isEnToVn = false;

      if (modeType === 'ex_en_to_vn') {
        promptText = card.example.trim();
        correctAnswer = (card.exampleTranslation || card.vietnamese).trim();
        promptLabel = 'Chọn dịch câu ví dụ tiếng Việt:';
        isEnToVn = true;
      } else if (modeType === 'ex_vn_to_en') {
        promptText = (card.exampleTranslation || card.vietnamese).trim();
        correctAnswer = card.example.trim();
        promptLabel = 'Chọn câu ví dụ tiếng Anh tương ứng:';
        isEnToVn = false;
      } else if (modeType === 'vn_to_en') {
        promptText = card.vietnamese.trim();
        correctAnswer = card.english.trim();
        promptLabel = 'Chọn từ tiếng Anh cho nghĩa:';
        isEnToVn = false;
      } else {
        // default en_to_vn
        promptText = card.english.trim();
        correctAnswer = card.vietnamese.trim();
        promptLabel = 'Chọn nghĩa tiếng Việt cho từ:';
        isEnToVn = true;
      }

      const pairForMode = candidate => {
        if (modeType === 'ex_en_to_vn') {
          if (!candidate.example?.trim()) return null;
          return {
            prompt: candidate.example.trim(),
            answer: (candidate.exampleTranslation || candidate.vietnamese).trim()
          };
        }
        if (modeType === 'ex_vn_to_en') {
          if (!candidate.example?.trim()) return null;
          return {
            prompt: (candidate.exampleTranslation || candidate.vietnamese).trim(),
            answer: candidate.example.trim()
          };
        }
        if (modeType === 'vn_to_en') {
          return { prompt: candidate.vietnamese.trim(), answer: candidate.english.trim() };
        }
        return { prompt: candidate.english.trim(), answer: candidate.vietnamese.trim() };
      };

      // Two cards can intentionally map the same prompt to different valid answers
      // (synonyms or alternate meanings). Treat every equivalent mapping as correct.
      const acceptedAnswers = Array.from(new Set(
        currentSet.cards
          .map(pairForMode)
          .filter(pair => pair && normalizeChoice(pair.prompt) === normalizeChoice(promptText))
          .map(pair => pair.answer)
          .filter(Boolean)
      ));
      if (!acceptedAnswers.some(answer => normalizeChoice(answer) === normalizeChoice(correctAnswer))) {
        acceptedAnswers.unshift(correctAnswer);
      }
      const acceptedNormalized = new Set(acceptedAnswers.map(normalizeChoice));

      // Get distractors from pool (Items 52 & 53 Fix)
      const setDistractors = currentSet.cards
        .filter(c => c.id !== card.id)
        .map(c => {
          if (modeType === 'ex_en_to_vn') return (c.exampleTranslation || c.vietnamese).trim();
          if (modeType === 'ex_vn_to_en') return (c.example || c.english).trim();
          if (modeType === 'vn_to_en') return c.english.trim();
          return c.vietnamese.trim();
        });

      let globalPool = allVietnamese;
      if (modeType === 'ex_en_to_vn') globalPool = allExampleTranslations;
      else if (modeType === 'ex_vn_to_en') globalPool = allExamples;
      else if (modeType === 'vn_to_en') globalPool = allEnglish;

      // Item 117 & 119 Fix: Ensure strictly unique distractors and GUARANTEE 4 options even for 1-2 card sets!
      const uniqueDistractorsPool = Array.from(new Set([...setDistractors, ...globalPool]))
        .filter(m => m && !acceptedNormalized.has(normalizeChoice(m)));

      const shuffledDistractors = shuffleArray(uniqueDistractorsPool);
      let distractors = shuffledDistractors.slice(0, 3);

      const genericFallbacks = isEnToVn
        ? ['Không có nghĩa này', 'Đang cập nhật', 'Chưa có thông tin']
        : ['Undefined', 'Updating', 'Not Available'];

      let fallbackIdx = 0;
      while (distractors.length < 3) {
        const fallback = genericFallbacks[fallbackIdx] || `Phương án phụ #${fallbackIdx + 1}`;
        if (!distractors.includes(fallback) && !acceptedNormalized.has(normalizeChoice(fallback))) {
          distractors.push(fallback);
        }
        fallbackIdx++;
      }

      const options = shuffleArray([correctAnswer, ...distractors]);

      return {
        card,
        promptText,
        promptLabel,
        correctAnswer,
        acceptedAnswers,
        options,
        isEnToVn,
        isExampleMode
      };
    });

    return shuffleArray(questions);
  }, [direction, questionSourceJson]);

  // Start new quiz session
  const startQuiz = useCallback(() => {
    const qList = generateQuestions();
    setQuizQuestions(qList);
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setResults({ correct: 0, wrong: 0, history: [] });
    setIsFinished(false);
  }, [generateQuestions]);

  useEffect(() => {
    const timer = setTimeout(startQuiz, 0);
    return () => clearTimeout(timer);
  }, [startQuiz]);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const currentQ = quizQuestions[currentIndex];

  // Show feedback immediately; AppContext serializes persistence in the background.
  const handleSelectOption = useCallback((option) => {
    if (isAnswered || submittingRef.current || !currentQ) return;

    const isCorrect = typeof option === 'string'
      && currentQ.acceptedAnswers.some(answer => normalizeChoice(answer) === normalizeChoice(option));

    submittingRef.current = true;
    setIsSubmitting(true);
    setSelectedOption(option);
    setIsAnswered(true);

    // Update session results
    setResults(prev => ({
      correct: isCorrect ? prev.correct + 1 : prev.correct,
      wrong: !isCorrect ? prev.wrong + 1 : prev.wrong,
      history: [
        ...prev.history,
        {
          cardId: currentQ.card.id,
          promptText: currentQ.promptText,
          userAnswer: option || 'Bỏ qua',
          correctAnswer: currentQ.correctAnswer,
          isCorrect
        }
      ]
    }));

    try {
      if (recordWordResult && currentSet) {
        Promise.resolve(recordWordResult(currentSet.id, currentQ.card.id, isCorrect)).catch((error) => {
          showToast(error.message || 'Không thể lưu kết quả. Kết nối mạng có thể đang gián đoạn.', 'warning', 6000);
        });
      }
    } catch (error) {
      showToast(error.message || 'Không thể lưu kết quả.', 'warning');
    }

    queueMicrotask(() => {
      submittingRef.current = false;
      setIsSubmitting(false);
    });
  }, [currentQ, currentSet, isAnswered, recordWordResult, showToast]);

  // Item 63 Fix: Don't know / Skip button
  const handleSkipQuestion = () => {
    if (isAnswered || submittingRef.current) return;
    handleSelectOption(null); // Triggers wrong answer state showing correct answer
  };

  const handleNextQuestion = useCallback(() => {
    if (currentIndex < quizQuestions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      if (results.correct > quizQuestions.length / 2 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }
    }
  }, [currentIndex, quizQuestions.length, results.correct]);

  // Item 118 Fix: Handle Esc key navigation and ignore inputs
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (e.target.closest?.('[aria-modal="true"]') || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || e.target.isContentEditable) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        navigateTo('home');
        return;
      }

      if (isFinished || !currentQ) return;
      const key = e.key.toUpperCase();

      if (!isAnswered) {
        let selectedIndex = -1;
        if (key === '1' || key === 'A') selectedIndex = 0;
        else if (key === '2' || key === 'B') selectedIndex = 1;
        else if (key === '3' || key === 'C') selectedIndex = 2;
        else if (key === '4' || key === 'D') selectedIndex = 3;

        if (selectedIndex >= 0 && selectedIndex < currentQ.options.length) {
          handleSelectOption(currentQ.options[selectedIndex]);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNextQuestion();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFinished, currentQ, isAnswered, navigateTo, handleSelectOption, handleNextQuestion]);

  // Item 62 Fix: Pronounce target prompt / answer accurately
  const speakWord = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const isVn = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
    utterance.lang = isVn ? 'vi-VN' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  if (!currentSet || !currentSet.cards || !currentSet.cards.length) {
    return (
      <div className="container p-8 text-center">
        <h2>Bộ từ vựng này không có dữ liệu!</h2>
        <button className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>Quay lại trang chủ</button>
      </div>
    );
  }

  if (!quizQuestions || quizQuestions.length === 0) {
    return (
      <div className="study-view container text-center p-8">
        <div style={{ padding: '4rem 0' }}>
          <div className="spinner mb-3"></div>
          <p className="text-muted">Đang chuẩn bị câu hỏi trắc nghiệm...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="study-view learn-view container">
      {/* Header */}
      <div className="study-header">
        <button className="btn btn-ghost" onClick={() => navigateTo('home')}>
          <ArrowLeft size={20} />
          Quay lại
        </button>

        <div className="study-title-group">
          <h2>{currentSet.title}</h2>
          <span className="mode-tag learn">
            <BrainCircuit size={15} /> Học bài / Trắc nghiệm
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
              title="Chọn hướng câu hỏi"
              aria-label="Chọn hướng câu hỏi"
            >
              <option value="en_to_vn">Tiếng Anh → Tiếng Việt</option>
              <option value="vn_to_en">Tiếng Việt → Tiếng Anh</option>
              <option value="mix">Mix (Xáo trộn)</option>
              <option value="ex_en_to_vn">Câu ví dụ: Tiếng Anh → Tiếng Việt</option>
              <option value="ex_vn_to_en">Câu ví dụ: Tiếng Việt → Tiếng Anh</option>
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
            <button className="nav-mode-btn active" title="Trắc nghiệm 4 đáp án" aria-label="Học bài" aria-current="page">
              <BrainCircuit size={18} />
              <span className="nav-mode-label">Học bài</span>
            </button>
            <button 
              className="nav-mode-btn" 
              onClick={() => navigateTo('typing', currentSet.id)}
              title="Gõ từ tiếng Anh"
              aria-label="Chuyển sang luyện gõ từ"
            >
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
        <div className="quiz-card card-shadow">
          {/* Progress Bar & Counter */}
          <div className="quiz-progress-bar-container">
            <div className="quiz-meta-info">
              <span className="quiz-step-text">
                Câu {currentIndex + 1} / {quizQuestions.length}
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
              aria-label="Tiến độ bài trắc nghiệm"
              aria-valuemin={1}
              aria-valuemax={quizQuestions.length}
              aria-valuenow={currentIndex + 1}
            >
              <div 
                className="progress-fill" 
                style={{ width: `${((currentIndex + 1) / quizQuestions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question Prompt */}
          <div className="question-box animate-fade-in" key={currentIndex}>
            <span className="prompt-label">{currentQ.promptLabel}</span>
            <div className="prompt-content-row">
              <h3 className="prompt-word">{currentQ.promptText}</h3>
              <button 
                type="button"
                className="icon-btn-speech"
                onClick={() => speakWord(currentQ.promptText)}
                title="Phát âm"
                aria-label={`Phát âm ${currentQ.promptText}`}
              >
                <Volume2 size={22} />
              </button>
            </div>
          </div>

          {/* Options Grid (Item 56 Fix: Shows key shortcut badges 1-4) */}
          <div className="options-grid">
            {currentQ.options.map((option, idx) => {
              const optionLetter = String.fromCharCode(65 + idx); // A, B, C, D
              const isSelected = selectedOption === option;
              const isCorrectOption = currentQ.acceptedAnswers
                .some(answer => normalizeChoice(answer) === normalizeChoice(option));

              let optionClass = 'option-btn';
              if (isAnswered) {
                if (isCorrectOption) optionClass += ' correct-answer';
                else if (isSelected) optionClass += ' wrong-answer';
                else optionClass += ' disabled';
              }

              return (
                <button
                  type="button"
                  key={idx}
                  className={optionClass}
                  onClick={() => handleSelectOption(option)}
                  disabled={isAnswered || isSubmitting}
                  aria-pressed={isSelected}
                  aria-label={`${optionLetter}. ${option}`}
                >
                  <span className="option-badge">{optionLetter}</span>
                  <span className="option-text">{option}</span>
                  {isAnswered && isCorrectOption && <Check size={18} className="option-status-icon text-success" />}
                  {isAnswered && isSelected && !isCorrectOption && <X size={18} className="option-status-icon text-danger" />}
                </button>
              );
            })}
          </div>

          <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
            {isAnswered
              ? currentQ.acceptedAnswers.some(answer => normalizeChoice(answer) === normalizeChoice(selectedOption))
                ? 'Chính xác.'
                : `Chưa đúng. Đáp án đúng là ${currentQ.correctAnswer}.`
              : ''}
          </p>

          {/* Footer Action Bar (Item 56 & 63 Fix: Skip button & Next Question) */}
          <div className="quiz-footer">
            {!isAnswered ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleSkipQuestion} disabled={isSubmitting}>
                <HelpCircle size={16} />
                Không biết / Xem đáp án
              </button>
            ) : (
              <button type="button" className="btn btn-primary animate-bounce-short" onClick={handleNextQuestion}>
                <span>Câu tiếp theo (Phím Enter)</span>
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Quiz Finished Screen */
        <div className="quiz-results-card card-shadow animate-scale-up text-center" role="status" aria-live="polite">
          <div className="results-trophy-badge">
            <Sparkles size={36} className="text-warning" />
          </div>
          <h2>Hoàn Thành Bài Kiểm Tra!</h2>
          <p className="results-subtitle">Bạn đã duyệt qua toàn bộ {quizQuestions.length} câu hỏi</p>

          <div className="results-stats-row">
            <div className="result-stat-box success">
              <span className="stat-num">{results.correct}</span>
              <span className="stat-label">Trả lời đúng</span>
            </div>
            <div className="result-stat-box danger">
              <span className="stat-num">{results.wrong}</span>
              <span className="stat-label">Trả lời sai</span>
            </div>
            <div className="result-stat-box primary">
              <span className="stat-num">
                {quizQuestions.length > 0 ? Math.round((results.correct / quizQuestions.length) * 100) : 0}%
              </span>
              <span className="stat-label">Tỷ lệ chính xác</span>
            </div>
          </div>

          {/* Item 120 & 121 Fix: History Review Table */}
          {results.history.length > 0 && (
            <div className="results-history-section mt-6 text-left">
              <h3 className="mb-3 font-semibold text-lg">Chi tiết câu hỏi & lịch sử trả lời:</h3>
              <div className="history-list space-y-2">
                {results.history.map((h, i) => (
                  <div key={i} className={`p-3 rounded-lg border flex flex-col md:flex-row justify-between items-start md:items-center gap-2 ${h.isCorrect ? 'bg-success-subtle border-success' : 'bg-danger-subtle border-danger'}`}>
                    <div>
                      <span className="font-medium">{i + 1}. {h.question?.promptText || h.promptText}:</span>
                      <span className="ml-2 text-muted">Đã chọn: <strong className={h.isCorrect ? 'text-success' : 'text-danger'}>{h.selected || h.userAnswer}</strong></span>
                    </div>
                    {!h.isCorrect && (
                      <div className="text-sm text-danger">
                        Đáp án đúng: <strong>{h.correctAnswer}</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="results-actions-group mt-6">
            <button className="btn btn-secondary" onClick={startQuiz}>
              <RotateCcw size={18} />
              Làm lại bài này
            </button>

            {results.wrong > 0 && (
              <button 
                className="btn btn-warning" 
                onClick={() => {
                  const wrongCardIds = new Set(results.history.filter(h => !h.isCorrect).map(h => String(h.cardId)));
                  const qList = generateQuestions().filter(q => wrongCardIds.has(String(q.card.id)));
                  setQuizQuestions(qList.length > 0 ? qList : generateQuestions());
                  setCurrentIndex(0);
                  setSelectedOption(null);
                  setIsAnswered(false);
                  setResults({ correct: 0, wrong: 0, history: [] });
                  setIsFinished(false);
                  showToast(`Đã chọn ${wrongCardIds.size} câu làm sai để luyện lại!`, 'info');
                }}
              >
                <BrainCircuit size={18} />
                Luyện lại {results.wrong} câu sai
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
