import React, { useMemo, useState } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { useApp } from '../context/useApp';

export const HomeView = () => {
  const { 
    sets, 
    searchQuery, 
    setSearchQuery, 
    navigateTo, 
    requestDeleteSet
  } = useApp();

  const [visibleCount, setVisibleCount] = useState(20); // Item 113 Fix: Batch rendering for performance

  // Item 106 Fix: Safe dereferencing of title, description, cards
  const filteredSets = useMemo(() => {
    const query = (searchQuery || '').toLowerCase().trim();
    return sets.filter(set => {
      if (!set || typeof set !== 'object') return false;
      if (!query) return true;

      const title = String(set.title || '').toLowerCase();
      const description = String(set.description || '').toLowerCase();
      const cards = Array.isArray(set.cards) ? set.cards : [];
      return title.includes(query)
        || description.includes(query)
        || cards.some(card => (
          String(card?.english || '').toLowerCase().includes(query)
          || String(card?.vietnamese || '').toLowerCase().includes(query)
        ));
    });
  }, [searchQuery, sets]);

  const visibleSets = useMemo(
    () => filteredSets.slice(0, visibleCount),
    [filteredSets, visibleCount]
  );

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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
            Học từ vựng thông minh với Flashcards, Trắc nghiệm, Luyện gõ từ và Theo dõi tiến trình — lưu trên thiết bị hoặc đồng bộ với tài khoản của bạn.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigateTo('create')}>
              <Plus size={20} />
              Tạo bộ từ vựng mới
            </button>
          </div>
        </div>
      </section>

      {/* Control Bar: Search & Filter */}
      <div className="home-control-bar">
        <div className="search-box-wrapper">
          <Search size={20} className="search-icon" />
          <label htmlFor="home-search-input" className="sr-only">
            Tìm kiếm bộ từ vựng
          </label>
          <input
            id="home-search-input"
            type="search"
            className="search-input"
            placeholder="Tìm kiếm bộ từ vựng, từ tiếng Anh hoặc nghĩa tiếng Việt..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(20);
            }}
          />
          {searchQuery && (
            <button 
              type="button"
              className="clear-search-btn" 
              onClick={() => {
                setSearchQuery('');
                setVisibleCount(20);
              }}
              aria-label="Xóa từ khóa tìm kiếm"
            >
              ×
            </button>
          )}
        </div>

        <div className="set-stats-counter" role="status" aria-live="polite" aria-atomic="true">
          <span>Hiển thị <strong>{visibleSets.length}</strong> / {filteredSets.length} bộ từ vựng</span>
        </div>
      </div>

      {/* Study Sets List */}
      {filteredSets.length > 0 ? (
        <>
          <div className="sets-list">
            {visibleSets.map((set) => {
              const cardsArr = Array.isArray(set.cards) ? set.cards : [];
              const totalWords = cardsArr.length;
              const studiedWords = cardsArr.filter(c => (c?.stats?.correct || 0) + (c?.stats?.wrong || 0) > 0).length;
              const totalCorrect = cardsArr.reduce((acc, c) => acc + (c?.stats?.correct || 0), 0);
              const totalWrong = cardsArr.reduce((acc, c) => acc + (c?.stats?.wrong || 0), 0);
              const totalAttempts = totalCorrect + totalWrong;
              const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

              return (
                <div key={set.id} className="set-list-item">
                  <div className="set-item-main">
                    {/* Top Meta Line */}
                    <div className="set-item-top-row">
                      <div className="set-badge-row">
                        <span className="card-count-badge">
                          <Layers size={14} />
                          {studiedWords}/{totalWords} đã học
                        </span>
                        {totalAttempts > 0 && (
                          <span className={`accuracy-badge ${accuracy >= 80 ? 'high' : accuracy >= 50 ? 'medium' : 'low'}`}>
                            Chính xác {accuracy}%
                          </span>
                        )}
                        {set.updatedAt && (
                          <time className="set-date-badge" dateTime={formatDateTime(set.updatedAt)}>
                            <Clock size={13} aria-hidden="true" /> {formatDate(set.updatedAt)}
                          </time>
                        )}
                      </div>

                      <div className="set-action-menu">
                        <button 
                          type="button"
                          className="action-icon-btn edit" 
                          onClick={() => navigateTo('edit', set.id)}
                          title="Chỉnh sửa bộ từ"
                          aria-label={`Chỉnh sửa bộ từ ${set.title}`}
                        >
                          <Edit3 size={18} />
                        </button>
                        <button 
                          type="button"
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
                      <h3 className="set-title">
                        <button
                          type="button"
                          className="set-title-button"
                          onClick={() => navigateTo('flashcards', set.id)}
                          aria-label={`Mở Flashcards của bộ ${set.title || 'không tên'}`}
                        >
                          {set.title}
                        </button>
                      </h3>
                      {set.description && (
                        <p className="set-description">{set.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Bar: Study Mode Buttons */}
                  <div className="set-item-actions">
                    <button 
                      type="button"
                      className="mode-btn flashcards"
                      onClick={() => navigateTo('flashcards', set.id)}
                      title="Thẻ ghi nhớ"
                      aria-label="Thẻ ghi nhớ Flashcards"
                    >
                      <BookOpen size={16} />
                      <span>Flashcards</span>
                    </button>

                    <button 
                      type="button"
                      className="mode-btn learn"
                      onClick={() => navigateTo('learn', set.id)}
                      title="Trắc nghiệm 4 đáp án"
                      aria-label="Học trắc nghiệm 4 đáp án"
                    >
                      <BrainCircuit size={16} />
                      <span>Học bài</span>
                    </button>

                    <button 
                      type="button"
                      className="mode-btn typing"
                      onClick={() => navigateTo('typing', set.id)}
                      title="Luyện gõ từ tiếng Anh"
                      aria-label="Luyện gõ từ tiếng Anh"
                    >
                      <Keyboard size={16} />
                      <span>Gõ từ</span>
                    </button>

                    <button 
                      type="button"
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
                type="button"
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
          <button type="button" className="btn btn-primary" onClick={() => navigateTo('create')}>
            <Plus size={18} />
            Tạo bộ từ vựng mới
          </button>
        </div>
      )}
    </div>
  );
};
