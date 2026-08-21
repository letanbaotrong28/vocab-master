import React, { useState } from 'react';
import { 
  Search, 
  Plus, 
  BookOpen, 
  BrainCircuit, 
  Keyboard, 
  BarChart2, 
  Edit3, 
  Trash2, 
  Sparkles,
  Layers,
  Clock,
  UserCheck,
  ChevronDown
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const HomeView = () => {
  const { 
    sets, 
    searchQuery, 
    setSearchQuery, 
    navigateTo, 
    requestDeleteSet
  } = useApp();

  const [visibleCount, setVisibleCount] = useState(20); // Item 113 Fix: Batch rendering for performance

  // Filter sets by search term
  const filteredSets = sets.filter(set => {
    const q = searchQuery.toLowerCase();
    return (
      set.title.toLowerCase().includes(q) ||
      (set.description && set.description.toLowerCase().includes(q)) ||
      set.cards.some(c => 
        c.english.toLowerCase().includes(q) || 
        c.vietnamese.toLowerCase().includes(q)
      )
    );
  });

  const visibleSets = filteredSets.slice(0, visibleCount);

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="home-view container animate-fade-in">
      {/* Hero Section */}
      <section className="hero-banner">
        <div className="hero-content">
          <h1 className="hero-title">
            Chinh Phục Từ Vựng Tiếng Anh <span className="highlight">Dễ Dàng & Hiệu Quả</span>
          </h1>
          <p className="hero-subtitle">
            Học từ vựng thông minh với Flashcards, Trắc nghiệm, Luyện gõ từ và Theo dõi tiến trình 100% riêng tư trên máy của bạn.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigateTo('create')}>
              <Plus size={20} />
              Tạo bộ từ vựng mới
            </button>
          </div>
        </div>
      </section>

      {/* Control Bar: Search & Filter (Item 104 Fix: Connected label and id) */}
      <div className="home-control-bar">
        <div className="search-box-wrapper">
          <Search size={20} className="search-icon" />
          <label htmlFor="home-search-input" className="sr-only" style={{ display: 'none' }}>
            Tìm kiếm bộ từ vựng
          </label>
          <input
            id="home-search-input"
            type="text"
            className="search-input"
            placeholder="Tìm kiếm bộ từ vựng, từ tiếng Anh hoặc nghĩa tiếng Việt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className="clear-search-btn" 
              onClick={() => setSearchQuery('')}
              aria-label="Xóa từ khóa tìm kiếm"
            >
              ×
            </button>
          )}
        </div>

        <div className="set-stats-counter">
          <span>Hiển thị <strong>{visibleSets.length}</strong> / {filteredSets.length} bộ từ vựng</span>
        </div>
      </div>

      {/* Study Sets Full-Width Vertical List (Item 100 & 103 Fixes) */}
      {filteredSets.length > 0 ? (
        <>
          <div className="sets-list">
            {visibleSets.map((set) => {
              const totalWords = set.cards.length;
              const studiedWords = set.cards.filter(c => (c.stats?.correct || 0) + (c.stats?.wrong || 0) > 0).length;
              const totalCorrect = set.cards.reduce((acc, c) => acc + (c.stats?.correct || 0), 0);
              const totalWrong = set.cards.reduce((acc, c) => acc + (c.stats?.wrong || 0), 0);
              const totalAttempts = totalCorrect + totalWrong;
              const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

              return (
                <div key={set.id} className="set-list-item">
                  <div 
                    className="set-item-main" 
                    onClick={() => navigateTo('flashcards', set.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigateTo('flashcards', set.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Mở bộ từ vựng ${set.title}`}
                  >
                    {/* Top Meta Line: Badges & Edit/Delete actions */}
                    <div className="set-item-top-row">
                      <div className="set-badge-row">
                        <span className="card-count-badge">
                          <Layers size={14} />
                          {totalWords} thuật ngữ
                        </span>
                        {totalAttempts > 0 && (
                          <span className={`accuracy-badge ${accuracy >= 70 ? 'high' : 'medium'}`}>
                            Độ chính xác {accuracy}%
                          </span>
                        )}
                        {set.updatedAt && (
                          <span className="set-date-badge">
                            <Clock size={13} /> {formatDate(set.updatedAt)}
                          </span>
                        )}
                      </div>

                      <div className="set-action-menu" onClick={(e) => e.stopPropagation()}>
                        <button 
                          className="action-icon-btn edit" 
                          onClick={() => navigateTo('edit', set.id)}
                          title="Chỉnh sửa bộ từ"
                          aria-label={`Chỉnh sửa bộ từ ${set.title}`}
                        >
                          <Edit3 size={18} />
                        </button>
                        <button 
                          className="action-icon-btn delete" 
                          onClick={() => requestDeleteSet(set.id, set.title)}
                          title="Xóa bộ từ"
                          aria-label={`Xóa bộ từ ${set.title}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Title & Description */}
                    <div className="set-item-content">
                      <h3 className="set-title">{set.title}</h3>
                      {set.description && (
                        <p className="set-description">{set.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Bar: Study Mode Buttons */}
                  <div className="set-item-actions">
                    <button 
                      className="mode-btn flashcards"
                      onClick={() => navigateTo('flashcards', set.id)}
                      title="Thẻ ghi nhớ"
                      aria-label="Thẻ ghi nhớ Flashcards"
                    >
                      <BookOpen size={16} />
                      <span>Flashcards</span>
                    </button>

                    <button 
                      className="mode-btn learn"
                      onClick={() => navigateTo('learn', set.id)}
                      title="Trắc nghiệm 4 đáp án"
                      aria-label="Học trắc nghiệm 4 đáp án"
                    >
                      <BrainCircuit size={16} />
                      <span>Học bài</span>
                    </button>

                    <button 
                      className="mode-btn typing"
                      onClick={() => navigateTo('typing', set.id)}
                      title="Luyện gõ từ tiếng Anh"
                      aria-label="Luyện gõ từ tiếng Anh"
                    >
                      <Keyboard size={16} />
                      <span>Gõ từ</span>
                    </button>

                    <button 
                      className="mode-btn progress"
                      onClick={() => navigateTo('progress', set.id)}
                      title="Xem tiến trình chi tiết"
                      aria-label="Xem thống kê tiến trình"
                    >
                      <BarChart2 size={16} />
                      <span>Tiến trình</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Item 113 Fix: Load More Button for large list performance */}
          {visibleCount < filteredSets.length && (
            <div className="text-center mt-6 mb-8">
              <button 
                className="btn btn-secondary btn-lg"
                onClick={() => setVisibleCount(prev => prev + 20)}
              >
                <ChevronDown size={20} />
                <span>Xem thêm bộ từ vựng (Còn {filteredSets.length - visibleCount} bộ)</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state-box">
          <div className="empty-icon-wrapper">
            <Sparkles size={48} className="empty-icon" />
          </div>
          <h3>Không tìm thấy bộ từ vựng nào</h3>
          <p>
            {searchQuery 
              ? `Không có kết quả nào phù hợp với từ khóa "${searchQuery}".`
              : 'Bạn chưa có bộ từ vựng nào. Hãy khởi tạo bộ từ đầu tiên để bắt đầu học!'}
          </p>
          <button className="btn btn-primary" onClick={() => navigateTo('create')}>
            <Plus size={18} />
            Tạo bộ từ vựng mới
          </button>
        </div>
      )}
    </div>
  );
};
