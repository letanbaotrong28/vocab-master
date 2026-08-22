import React, { useState, useEffect } from 'react';
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
import { useApp } from '../context/AppContext';

// Item 55 Fix: Fisher-Yates Shuffle Algorithm for uniform distribution
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const LearnView = () => {
  const { currentSet, sets, recordWordResult, recordStreak, navigateTo, showToast } = useApp();

  const [direction, setDirection] = useState('en_to_vn'); // 'en_to_vn' | 'vn_to_en' | 'mix' | 'ex_en_to_vn' | 'ex_vn_to_en' | 'ex_mix'
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [results, setResults] = useState({ correct: 0, wrong: 0, history: [] });
  const [isFinished, setIsFinished] = useState(false);

  // Helper to generate distinct options based on chosen direction (Items 52, 53, 54, 55 Fix)
  const generateQuestions = () => {
    if (!currentSet || !currentSet.cards || currentSet.cards.length === 0) return [];

    const allEnglish = Array.from(new Set(sets.flatMap(s => s.cards.map(c => c.english.trim())).filter(Boolean)));
    const allVietnamese = Array.from(new Set(sets.flatMap(s => s.cards.map(c => c.vietnamese.trim())).filter(Boolean)));
    const allExamples = Array.from(new Set(sets.flatMap(s => s.cards.map(c => (c.example || '').trim())).filter(Boolean)));
    const allExampleTranslations = Array.from(new Set(sets.flatMap(s => s.cards.map(c => (c.exampleTranslation || '').trim())).filter(Boolean)));

    const questions = currentSet.cards.map((card) => {
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
        .filter(m => m && m.toLowerCase() !== correctAnswer.toLowerCase());

      const shuffledDistractors = shuffleArray(uniqueDistractorsPool);
      let distractors = shuffledDistractors.slice(0, 3);

      const genericFallbacks = isEnToVn
        ? ['Không có nghĩa này', 'Đang cập nhật', 'Chưa có thông tin']
        : ['Undefined', 'Updating', 'Not Available'];

      let fallbackIdx = 0;
      while (distractors.length < 3) {
        const fallback = genericFallbacks[fallbackIdx] || `Phương án phụ #${fallbackIdx + 1}`;
        if (!distractors.includes(fallback) && fallback.toLowerCase() !== correctAnswer.toLowerCase()) {
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
        options,
        isEnToVn,
        isExampleMode
      };
    });

    return shuffleArray(questions);
  };

  // Start new quiz session
  const startQuiz = () => {
    const qList = generateQuestions();
    setQuizQuestions(qList);
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setResults({ correct: 0, wrong: 0, history: [] });
    setIsFinished(false);
  };

  useEffect(() => {
    startQuiz();
  }, [currentSet?.id, direction]);

  const currentQ = quizQuestions[currentIndex];

  // Item 118 Fix: Handle Esc key navigation and ignore inputs
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
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
      } else {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNextQuestion();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFinished, currentQ, isAnswered, currentIndex]);

  // Item 116 Fix: Await recordWordResult to prevent out-of-order stats recording
  const handleSelectOption = async (option) => {
    if (isAnswered) return;
    setSelectedOption(option);
    setIsAnswered(true);

    const isCorrect = option && option.toLowerCase().trim() === currentQ.correctAnswer.toLowerCase().trim();

    // Update session results
    setResults(prev => ({
      correct: isCorrect ? prev.correct + 1 : prev.correct,
      wrong: !isCorrect ? prev.wrong + 1 : prev.wrong,
      history: [
        ...prev.history,
        {
          promptText: currentQ.promptText,
          userAnswer: option || 'Bỏ qua',
          correctAnswer: currentQ.correctAnswer,
          isCorrect
        }
      ]
    }));

    try {
      if (recordWordResult && currentSet) {
        await recordWordResult(currentSet.id, currentQ.card.id, isCorrect);
      }
      if (recordStreak && isCorrect) {
        recordStreak();
      }
    } catch (e) {
      console.error('Error recording word result:', e);
    }
  };

  // Item 63 Fix: Don't know / Skip button
  const handleSkipQuestion = () => {
    if (isAnswered) return;
    handleSelectOption(null); // Triggers wrong answer state showing correct answer
  };

  const handleNextQuestion = () => {
    if (currentIndex < quizQuestions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      if (results.correct > quizQuestions.length / 2) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }
    }
  };

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
      <div className="study-view container animate-fade-in text-center p-8">
        <div style={{ padding: '4rem 0' }}>
          <div className="spinner mb-3"></div>
          <p className="text-muted">Đang chuẩn bị câu hỏi trắc nghiệm...</p>
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
            >
              <option value="en_to_vn">Tiếng Anh → Tiếng Việt</option>
              <option value="vn_to_en">Tiếng Việt → Tiếng Anh</option>
              <option value="mix">Mix (Xáo trộn)</option>
              <option value="ex_en_to_vn">Câu ví dụ: Tiếng Anh → Tiếng Việt</option>
              <option value="ex_vn_to_en">Câu ví dụ: Tiếng Việt → Tiếng Anh</option>
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
            <button className="nav-mode-btn active" title="Trắc nghiệm 4 đáp án">
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
            <div className="progress-bar">
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
                className="icon-btn-speech"
                onClick={() => speakWord(currentQ.promptText)}
                title="Phát âm"
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
              const isCorrectOption = option.toLowerCase().trim() === currentQ.correctAnswer.toLowerCase().trim();

              let optionClass = 'option-btn';
              if (isAnswered) {
                if (isCorrectOption) optionClass += ' correct-answer';
                else if (isSelected) optionClass += ' wrong-answer';
                else optionClass += ' disabled';
              }

              return (
                <button
                  key={idx}
                  className={optionClass}
                  onClick={() => handleSelectOption(option)}
                  disabled={isAnswered}
                >
                  <span className="option-badge">{optionLetter}</span>
                  <span className="option-text">{option}</span>
                  {isAnswered && isCorrectOption && <Check size={18} className="option-status-icon text-success" />}
                  {isAnswered && isSelected && !isCorrectOption && <X size={18} className="option-status-icon text-danger" />}
                </button>
              );
            })}
          </div>

          {/* Footer Action Bar (Item 56 & 63 Fix: Skip button & Next Question) */}
          <div className="quiz-footer">
            {!isAnswered ? (
              <button className="btn btn-secondary btn-sm" onClick={handleSkipQuestion}>
                <HelpCircle size={16} />
                Không biết / Bỏ qua (Phím Esc)
              </button>
            ) : (
              <button className="btn btn-primary animate-bounce-short" onClick={handleNextQuestion}>
                <span>Câu tiếp theo (Phím Enter)</span>
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Quiz Finished Screen */
        <div className="quiz-results-card card-shadow animate-scale-up text-center">
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
                  const wrongCards = results.history.filter(h => !h.isCorrect).map(h => h.question.card);
                  const qList = generateQuestions().filter(q => wrongCards.some(wc => wc.id === q.card.id));
                  setQuizQuestions(qList.length > 0 ? qList : generateQuestions());
                  setCurrentIndex(0);
                  setSelectedOption(null);
                  setIsAnswered(false);
                  setResults({ correct: 0, wrong: 0, history: [] });
                  setIsFinished(false);
                  showToast(`Đã chọn ${wrongCards.length} câu làm sai để luyện lại!`, 'info');
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
