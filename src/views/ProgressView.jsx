import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  BarChart2, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  BrainCircuit, 
  BookOpen, 
  Keyboard,
  Award,
  Volume2,
  Sparkles
} from 'lucide-react';
import { useApp } from '../context/useApp';

export const ProgressView = () => {
  const { currentSet, navigateTo, requestResetProgress } = useApp();
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'new' | 'weak' | 'mastered'

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!currentSet) {
    return (
      <div className="container p-8 text-center">
        <h2>Không tìm thấy bộ từ vựng!</h2>
        <button className="btn btn-primary mt-4" onClick={() => navigateTo('home')}>Quay lại trang chủ</button>
      </div>
    );
  }

  const cards = currentSet.cards || [];

  // Metrics computation (Item 123 Fix: Display N/A for unlearned cards with 0 attempts)
  const cardStats = cards.map(c => {
    const correct = c.stats?.correct || 0;
    const wrong = c.stats?.wrong || 0;
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : null;
    
    let status = 'new';
    if (total > 0) {
      if (wrong > correct || (accuracy !== null && accuracy < 50 && total >= 2)) status = 'weak';
      else if (accuracy !== null && accuracy >= 75 && correct >= 3) status = 'mastered';
      else status = 'learning';
    }

    return {
      ...c,
      correct,
      wrong,
      total,
      accuracy,
      status
    };
  });

  const totalAttempts = cardStats.reduce((acc, c) => acc + c.total, 0);
  const totalCorrect = cardStats.reduce((acc, c) => acc + c.correct, 0);
  
  const overallAccuracyDisplay = totalAttempts > 0 ? `${Math.round((totalCorrect / totalAttempts) * 100)}%` : 'N/A';

  const weakCount = cardStats.filter(c => c.status === 'weak').length;
  const masteredCount = cardStats.filter(c => c.status === 'mastered').length;
  const newCount = cardStats.filter(c => c.status === 'new').length;

  // Filtered Cards
  let filteredCards = cardStats.filter(c => {
    if (filterMode === 'new') return c.status === 'new';
    if (filterMode === 'weak') return c.status === 'weak' || c.wrong > c.correct;
    if (filterMode === 'mastered') return c.status === 'mastered';
    return true;
  });

  // Item 64 Fix: Do NOT mutate/sort original array order when filter is 'all'. Only sort for 'weak' or 'mastered'.
  if (filterMode === 'weak') {
    filteredCards = [...filteredCards].sort((a, b) => b.wrong - a.wrong || a.accuracy - b.accuracy);
  } else if (filterMode === 'mastered') {
    filteredCards = [...filteredCards].sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct);
  }

  const speakEnglish = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const isVn = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
    utterance.lang = isVn ? 'vi-VN' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="progress-view container">
      {/* Header */}
      <div className="study-header">
        <button className="btn btn-ghost" onClick={() => navigateTo('home')}>
          <ArrowLeft size={20} />
          Quay lại
        </button>

        <div className="study-title-group">
          <h2>{currentSet.title}</h2>
          <span className="mode-tag progress">
            <BarChart2 size={15} /> Thống kê & Tiến trình học
          </span>
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
          <button 
            className="nav-mode-btn" 
            onClick={() => navigateTo('typing', currentSet.id)}
            title="Gõ từ tiếng Anh"
            aria-label="Chuyển sang luyện gõ từ"
          >
            <Keyboard size={18} />
            <span className="nav-mode-label">Gõ từ</span>
          </button>
          <button className="nav-mode-btn active" title="Thống kê" aria-label="Tiến trình" aria-current="page">
            <BarChart2 size={18} />
            <span className="nav-mode-label">Tiến trình</span>
          </button>
        </nav>
      </div>

      {/* Summary KPI Cards Grid (Item 65 & 68 Fix) */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrapper accuracy">
            <Award size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{overallAccuracyDisplay}</span>
            <span className="kpi-label">Tỷ lệ trả lời đúng tổng thể</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper correct">
            <CheckCircle2 size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{masteredCount}</span>
            <span className="kpi-label">Thuật ngữ đã thành thục</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper wrong">
            <AlertTriangle size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{weakCount}</span>
            <span className="kpi-label">Thuật ngữ thường sai</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper total">
            <Sparkles size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{cards.length - newCount} / {cards.length}</span>
            <span className="kpi-label">Thuật ngữ đã bắt đầu học</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper total">
            <BookOpen size={24} />
          </div>
          <div className="kpi-content">
            <span className="kpi-value">{newCount}</span>
            <span className="kpi-label">Từ vựng chưa từng học</span>
          </div>
        </div>
      </div>

      {/* Main Stats Controls & Reset Button (Item 68 Fix) */}
      <div className="progress-control-bar">
        <div className="filter-buttons">
          <button 
            className={`btn-filter ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
            aria-pressed={filterMode === 'all'}
          >
            Tất cả từ ({cards.length})
          </button>
          <button 
            className={`btn-filter ${filterMode === 'new' ? 'active' : ''}`}
            onClick={() => setFilterMode('new')}
            aria-pressed={filterMode === 'new'}
          >
            Chưa học ({newCount})
          </button>
          <button 
            className={`btn-filter ${filterMode === 'weak' ? 'active' : ''}`}
            onClick={() => setFilterMode('weak')}
            aria-pressed={filterMode === 'weak'}
          >
            <AlertTriangle size={15} />
            Từ thường sai ({weakCount})
          </button>
          <button 
            className={`btn-filter ${filterMode === 'mastered' ? 'active' : ''}`}
            onClick={() => setFilterMode('mastered')}
            aria-pressed={filterMode === 'mastered'}
          >
            <CheckCircle2 size={15} />
            Đã thành thục ({masteredCount})
          </button>
        </div>

        <button 
          className="btn btn-outline-danger"
          onClick={() => requestResetProgress(currentSet.id, currentSet.title)}
        >
          <RotateCcw size={16} />
          Đặt lại tiến trình bộ này
        </button>
      </div>

      {/* Words Stats Table */}
      <div className="stats-table-wrapper card-shadow">
        <table className="stats-table">
          <caption className="sr-only">Thống kê tiến trình từng từ trong bộ {currentSet.title}</caption>
          <thead>
            <tr>
              <th scope="col">Từ tiếng Anh</th>
              <th scope="col">Nghĩa tiếng Việt</th>
              <th scope="col" className="text-center">Số lần Đúng</th>
              <th scope="col" className="text-center">Số lần Sai</th>
              <th scope="col" className="text-center">Tỷ lệ Đúng</th>
              <th scope="col" className="text-center">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {filteredCards.length > 0 ? (
              filteredCards.map((card) => (
                <tr key={card.id} className={`table-row ${card.status}`}>
                  <td className="font-semibold text-primary" data-label="Từ tiếng Anh">
                    <div className="word-audio-cell">
                      <span>{card.english}</span>
                      <button className="icon-btn-subtle" onClick={() => speakEnglish(card.english)} aria-label={`Phát âm từ ${card.english}`}>
                        <Volume2 size={16} />
                      </button>
                    </div>
                  </td>
                  <td data-label="Nghĩa tiếng Việt">{card.vietnamese}</td>
                  <td className="text-center text-success font-medium" data-label="Số lần đúng">✓ {card.correct}</td>
                  <td className="text-center text-danger font-medium" data-label="Số lần sai">✗ {card.wrong}</td>
                  <td className="text-center" data-label="Tỷ lệ đúng">
                    {card.accuracy === null ? (
                      <span className="bar-num">N/A</span>
                    ) : (
                      <div className="table-accuracy-bar">
                        <div className="bar-bg">
                          <div
                            className={`bar-fill ${card.accuracy >= 70 ? 'high' : card.accuracy >= 50 ? 'medium' : 'low'}`}
                            style={{ width: `${card.accuracy}%` }}
                          />
                        </div>
                        <span className="bar-num">{card.accuracy}%</span>
                      </div>
                    )}
                  </td>
                  <td className="text-center" data-label="Trạng thái">
                    {card.status === 'mastered' && <span className="status-tag mastered">Đã thành thục</span>}
                    {card.status === 'weak' && <span className="status-tag weak">Cần ôn tập</span>}
                    {card.status === 'learning' && <span className="status-tag learning">Đang học</span>}
                    {card.status === 'new' && <span className="status-tag new">Chưa học</span>}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="stats-empty-cell text-center p-8 text-muted">
                  Không có từ vựng nào trong danh mục này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Item 67 Fix: Practice Weak Words Quick Callout opens LearnView */}
      {weakCount > 0 && (
        <div className="weak-words-callout animate-fade-in">
          <div className="callout-content">
            <AlertTriangle size={28} className="callout-icon" />
            <div>
              <h4>Bạn có {weakCount} từ vựng thường trả lời sai</h4>
              <p>Hãy ôn luyện các từ yếu này bằng bài trắc nghiệm 4 đáp án để nhớ sâu hơn.</p>
            </div>
          </div>
          <div className="callout-actions">
            <button
              className="btn btn-primary"
              onClick={() => navigateTo('learn', currentSet.id, {
                cardIds: cardStats.filter(card => card.status === 'weak').map(card => card.id)
              })}
            >
              <BrainCircuit size={18} />
              Luyện từ yếu ngay
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
