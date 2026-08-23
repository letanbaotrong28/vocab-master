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
  ChevronDown,
  Loader2,
  X
} from 'lucide-react';
import { useApp } from '../context/useApp';

export const HomeView = () => {
  const { 
    sets, 
    searchQuery, 
    setSearchQuery, 
    navigateTo, 
    requestDeleteSets,
    deleteSetsNow,
    saveSet,
    showToast,
    setConfirmModal
  } = useApp();

  const [visibleCount, setVisibleCount] = useState(20); // Item 113 Fix: Batch rendering for performance
  const [selectedSetIds, setSelectedSetIds] = useState(() => new Set());
  const [isMerging, setIsMerging] = useState(false);

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

  const selectedSets = useMemo(
    () => {
      const setsById = new Map(sets.map(set => [String(set.id), set]));
      return [...selectedSetIds].map(id => setsById.get(id)).filter(Boolean);
    },
    [selectedSetIds, sets]
  );

  const selectionOrderById = useMemo(
    () => new Map([...selectedSetIds].map((id, index) => [id, index + 1])),
    [selectedSetIds]
  );

  const selectedVisibleCount = useMemo(
    () => visibleSets.filter(set => selectedSetIds.has(String(set.id))).length,
    [selectedSetIds, visibleSets]
  );

  const selectableVisibleCount = useMemo(
    () => visibleSets.filter(set => set._syncing !== true).length,
    [visibleSets]
  );

  const toggleSetSelection = (setId) => {
    const normalizedId = String(setId);
    setSelectedSetIds(previousIds => {
      const nextIds = new Set(previousIds);
      if (nextIds.has(normalizedId)) nextIds.delete(normalizedId);
      else nextIds.add(normalizedId);
      return nextIds;
    });
  };

  const toggleAllVisibleSets = () => {
    const visibleIds = visibleSets
      .filter(set => set._syncing !== true)
      .map(set => String(set.id));
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSetIds.has(id));
    setSelectedSetIds(previousIds => {
      const nextIds = new Set(previousIds);
      visibleIds.forEach(id => {
        if (allVisibleSelected) nextIds.delete(id);
        else nextIds.add(id);
      });
      return nextIds;
    });
  };

  const createMergedResourceId = (prefix) => {
    const randomPart = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}-${randomPart}`;
  };

  const handleMergeSelectedSets = () => {
    if (selectedSets.length < 2) {
      showToast('Vui lòng chọn ít nhất 2 bộ từ vựng để gộp.', 'info');
      return;
    }
    if (selectedSets.some(set => set._syncing === true)) {
      showToast('Vui lòng chờ các bộ từ đang lưu hoàn tất rồi thử lại.', 'info');
      return;
    }

    const mergedCardsByContent = new Map();
    selectedSets.forEach(set => {
      (Array.isArray(set.cards) ? set.cards : []).forEach(card => {
        const key = `${String(card.english || '').trim().toLowerCase()}\u0000${String(card.vietnamese || '').trim().toLowerCase()}`;
        const existing = mergedCardsByContent.get(key);
        if (existing) {
          existing.stats.correct = Math.min(2147483647, existing.stats.correct + (card.stats?.correct || 0));
          existing.stats.wrong = Math.min(2147483647, existing.stats.wrong + (card.stats?.wrong || 0));
          if (!existing.example && card.example) existing.example = card.example;
          if (!existing.exampleTranslation && card.exampleTranslation) existing.exampleTranslation = card.exampleTranslation;
          return;
        }
        mergedCardsByContent.set(key, {
          id: createMergedResourceId('card-merged'),
          english: String(card.english || '').trim(),
          vietnamese: String(card.vietnamese || '').trim(),
          example: String(card.example || '').trim(),
          exampleTranslation: String(card.exampleTranslation || '').trim(),
          stats: {
            correct: card.stats?.correct || 0,
            wrong: card.stats?.wrong || 0
          }
        });
      });
    });

    const mergedCards = [...mergedCardsByContent.values()];
    if (mergedCards.length === 0) {
      showToast('Các bộ đã chọn không có thẻ hợp lệ để gộp.', 'warning');
      return;
    }
    if (mergedCards.length > 1000) {
      showToast(`Bộ sau khi gộp có ${mergedCards.length} thẻ, vượt giới hạn 1.000 thẻ.`, 'warning', 6500);
      return;
    }

    const sourceTitles = selectedSets.map(set => String(set.title || 'Không tên').trim());
    const mergedSet = {
      id: createMergedResourceId('set-merged'),
      title: `Gộp: ${sourceTitles.join(' + ')}`.slice(0, 250),
      description: `Bộ mới được gộp từ ${selectedSets.length} bộ: ${sourceTitles.join(', ')}`.slice(0, 1000),
      cards: mergedCards,
      createdAt: Date.now()
    };

    const sourceSetIds = selectedSets.map(set => set.id);
    setConfirmModal({
      isOpen: true,
      title: `Gộp ${selectedSets.length} bộ từ vựng`,
      message: `Bộ "${sourceTitles[0]}" sẽ đứng trước, các bộ được chọn sau sẽ nối tiếp theo đúng thứ tự chọn. Sau khi gộp thành công, ${selectedSets.length} bộ cũ sẽ bị xóa.`,
      confirmText: 'Gộp và thay thế',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(current => ({ ...current, isOpen: false }));
        setIsMerging(true);
        try {
          const wasSaved = await saveSet(mergedSet);
          if (!wasSaved) return;
          const sourcesDeleted = await deleteSetsNow(sourceSetIds, { silent: true });
          setSelectedSetIds(new Set());
          if (sourcesDeleted) {
            showToast(`Đã gộp ${sourceSetIds.length} bộ theo đúng thứ tự lựa chọn.`, 'success', 4500);
          }
        } catch {
          // AppContext displays the save/delete failure and restores safe data when needed.
        } finally {
          setIsMerging(false);
        }
      }
    });
  };

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
    <div className="home-view container">
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

      {filteredSets.length > 0 && (
        <div className="set-bulk-toolbar" aria-label="Thao tác với các bộ từ vựng đã chọn">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={selectableVisibleCount > 0 && selectedVisibleCount === selectableVisibleCount}
              ref={(input) => {
                if (input) input.indeterminate = selectedVisibleCount > 0
                  && selectedVisibleCount < selectableVisibleCount;
              }}
              onChange={toggleAllVisibleSets}
              disabled={visibleSets.every(set => set._syncing === true)}
            />
            <span>Chọn tất cả đang hiển thị</span>
          </label>

          <div className="bulk-selection-summary" role="status" aria-live="polite">
            Đã chọn <strong>{selectedSets.length}</strong> bộ
          </div>

          <div className="bulk-set-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigateTo('edit', selectedSets[0].id)}
              disabled={selectedSets.length !== 1 || selectedSets[0]?._syncing === true || isMerging}
              title={selectedSets.length === 1 ? 'Chỉnh sửa bộ đã chọn' : 'Chọn đúng 1 bộ để chỉnh sửa'}
            >
              <Edit3 size={17} />
              Sửa
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm bulk-merge-btn"
              onClick={handleMergeSelectedSets}
              disabled={selectedSets.length < 2 || isMerging}
              title="Gộp theo thứ tự lựa chọn và thay thế các bộ cũ"
            >
              {isMerging ? <Loader2 size={17} className="spinner" /> : <Layers size={17} />}
              {isMerging ? 'Đang gộp...' : 'Gộp các bộ đã chọn'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => requestDeleteSets(selectedSets.map(set => set.id))}
              disabled={selectedSets.length === 0 || selectedSets.some(set => set._syncing === true) || isMerging}
              title="Xóa các bộ đã chọn"
            >
              <Trash2 size={17} />
              Xóa
            </button>
            {selectedSets.length > 0 && (
              <button
                type="button"
                className="bulk-clear-selection"
                onClick={() => setSelectedSetIds(new Set())}
                aria-label="Bỏ chọn tất cả"
                title="Bỏ chọn tất cả"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      )}

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
              const isSyncing = set._syncing === true;

              return (
                <div
                  key={set.id}
                  className={`set-list-item ${selectedSetIds.has(String(set.id)) ? 'is-selected' : ''} ${isSyncing ? 'is-syncing' : ''}`}
                  aria-busy={isSyncing}
                >
                  <div className="set-item-main">
                    {/* Top Meta Line */}
                    <div className="set-item-top-row">
                      <div className="set-badge-row">
                        <span className="card-count-badge">
                          <Layers size={14} />
                          {studiedWords}/{totalWords} đã học
                        </span>
                        {isSyncing && (
                          <span className="syncing-set-badge" role="status">
                            <Loader2 size={13} className="spinner" aria-hidden="true" /> Đang lưu
                          </span>
                        )}
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

                      <label className="set-select-checkbox" title={isSyncing ? 'Đang lưu bộ từ' : `Chọn bộ ${set.title}`}>
                        <input
                          type="checkbox"
                          checked={selectedSetIds.has(String(set.id))}
                          onChange={() => toggleSetSelection(set.id)}
                          disabled={isSyncing}
                          aria-label={`Chọn bộ từ ${set.title}${selectionOrderById.has(String(set.id)) ? `, thứ tự ${selectionOrderById.get(String(set.id))}` : ''}`}
                        />
                        {selectionOrderById.has(String(set.id)) && (
                          <span className="set-selection-order" aria-hidden="true">
                            {selectionOrderById.get(String(set.id))}
                          </span>
                        )}
                      </label>
                    </div>

                    {/* Title & Description */}
                    <div className="set-item-content">
                      <h3 className="set-title">
                        <button
                          type="button"
                          className="set-title-button"
                          onClick={() => navigateTo('flashcards', set.id)}
                          disabled={isSyncing}
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
                      disabled={isSyncing}
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
                      disabled={isSyncing}
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
                      disabled={isSyncing}
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
                      disabled={isSyncing}
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
