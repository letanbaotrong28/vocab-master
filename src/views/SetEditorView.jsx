import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Save, 
  ChevronUp, 
  ChevronDown, 
  Sparkles, 
  FileText,
  X,
  Loader2
} from 'lucide-react';
import { useApp } from '../context/useApp';

export const SetEditorView = () => {
  const { activeView, editingSetId, sets, saveSet, navigateTo, showToast } = useApp();
  const isEditing = activeView === 'edit' && editingSetId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cards, setCards] = useState([
    { id: 'card-1', english: '', vietnamese: '', example: '', exampleTranslation: '', stats: { correct: 0, wrong: 0 } },
    { id: 'card-2', english: '', vietnamese: '', example: '', exampleTranslation: '', stats: { correct: 0, wrong: 0 } }
  ]);
  
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Item 90 Fix: Prevent background sets update from overwriting active user draft
  const initializedSetIdRef = React.useRef(null);

  useEffect(() => {
    const currentKey = isEditing ? String(editingSetId) : 'new';
    if (initializedSetIdRef.current === currentKey) {
      return;
    }

    let savedDraft = null;
    try {
      const rawDraft = localStorage.getItem('vocabmaster_editor_draft');
      const parsedDraft = rawDraft ? JSON.parse(rawDraft) : null;
      const isRecent = parsedDraft?.savedAt && Date.now() - parsedDraft.savedAt < 7 * 24 * 60 * 60 * 1000;
      if (parsedDraft?.editorKey === currentKey && isRecent && Array.isArray(parsedDraft.cards)) {
        savedDraft = parsedDraft;
      }
    } catch {}

    if (savedDraft) {
      setTitle(savedDraft.title || '');
      setDescription(savedDraft.description || '');
      setCards(savedDraft.cards);
      setBatchText(savedDraft.batchText || '');
      setIsDirty(true);
      initializedSetIdRef.current = currentKey;
      showToast('Đã khôi phục bản nháp chưa lưu.', 'info');
      return;
    }

    if (isEditing) {
      const existingSet = sets.find(s => String(s.id) === String(editingSetId));
      if (existingSet) {
        setTitle(existingSet.title || '');
        setDescription(existingSet.description || '');
        setCards(existingSet.cards && existingSet.cards.length > 0 ? existingSet.cards : [
          { id: `card-${Date.now()}-1`, english: '', vietnamese: '', example: '', exampleTranslation: '', stats: { correct: 0, wrong: 0 } }
        ]);
        setIsDirty(false);
        initializedSetIdRef.current = currentKey;
      } else {
        showToast('Bộ từ vựng không tồn tại hoặc đã bị xóa.', 'warning');
        navigateTo('home');
      }
    } else {
      setTitle('');
      setDescription('');
      setCards([
        { id: `card-${Date.now()}-1`, english: '', vietnamese: '', example: '', exampleTranslation: '', stats: { correct: 0, wrong: 0 } },
        { id: `card-${Date.now()}-2`, english: '', vietnamese: '', example: '', exampleTranslation: '', stats: { correct: 0, wrong: 0 } }
      ]);
      setIsDirty(false);
      initializedSetIdRef.current = currentKey;
    }
  }, [isEditing, editingSetId, sets, navigateTo, showToast]);

  // Item 14 Fix: Warn user when navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleBack = () => {
    if (isDirty) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn rời đi?')) {
        navigateTo('home');
      }
    } else {
      navigateTo('home');
    }
  };

  // Card Operations
  const handleCardChange = (id, field, value) => {
    setIsDirty(true);
    setCards(prev => prev.map(card => card.id === id ? { ...card, [field]: value } : card));
  };

  const addCardRow = () => {
    setIsDirty(true);
    const newCard = {
      id: `card-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      english: '',
      vietnamese: '',
      example: '',
      exampleTranslation: '',
      stats: { correct: 0, wrong: 0 }
    };
    setCards(prev => [...prev, newCard]);
  };

  const removeCardRow = (id) => {
    if (cards.length <= 1) {
      showToast('Bộ từ vựng cần có ít nhất 1 thẻ!', 'warning');
      return;
    }
    setIsDirty(true);
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const moveCard = (index, direction) => {
    setIsDirty(true);
    const newCards = [...cards];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= cards.length) return;
    const temp = newCards[index];
    newCards[index] = newCards[targetIndex];
    newCards[targetIndex] = temp;
    setCards(newCards);
  };

  // Item 17 Fix: Robust Batch Import Parser (correct handling for well-known, state-of-the-art)
  const parseBatchText = (text) => {
    if (!text || !text.trim()) return [];

    const lines = text.split('\n');
    const results = [];
    const seenWords = new Set();

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Item 126 Fix: Robust Quote-Aware Parser handling quoted CSV/TSV cells with URLs, colons, pipes, and hyphens
      let parts = [];
      if (trimmed.includes('\t')) {
        parts = trimmed.split('\t');
      } else if (trimmed.includes('|')) {
        parts = trimmed.split('|');
      } else if (trimmed.includes(';')) {
        parts = trimmed.split(';');
      } else if (trimmed.includes(' - ')) {
        parts = trimmed.split(' - ');
      } else if (trimmed.includes(',')) {
        // Regex quote-aware CSV split preserving quotes and internal commas/colons
        parts = trimmed.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [trimmed];
      } else if (trimmed.includes(':') && !trimmed.startsWith('http')) {
        parts = trimmed.split(':');
      } else if (trimmed.includes('=')) {
        parts = trimmed.split('=');
      } else {
        parts = [trimmed];
      }

      parts = parts.map(p => p.trim().replace(/^["']|["']$/g, '').replace(/""/g, '"'));

      if (parts.length >= 2) {
        const english = parts[0];
        const vietnamese = parts[1];
        const example = parts[2] || '';
        const exampleTranslation = parts[3] || '';

        const wordKey = `${english.toLowerCase()}::${vietnamese.toLowerCase()}`;

        if (english && vietnamese && !seenWords.has(wordKey)) {
          seenWords.add(wordKey);
          results.push({
            id: `card-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            english,
            vietnamese,
            example,
            exampleTranslation,
            stats: { correct: 0, wrong: 0 }
          });
        }
      }
    });

    return results;
  };

  // Item 128 Fix: Auto-save draft to localStorage whenever user edits cards
  useEffect(() => {
    if (isDirty && (title || description || cards.some(c => c.english || c.vietnamese))) {
      try {
        localStorage.setItem('vocabmaster_editor_draft', JSON.stringify({
          editorKey: isEditing ? String(editingSetId) : 'new',
          title,
          description,
          cards,
          batchText,
          savedAt: Date.now()
        }));
      } catch {}
    }
  }, [title, description, cards, batchText, isDirty, isEditing, editingSetId]);

  const parsedBatchPreview = parseBatchText(batchText);

  const handleBatchParseConfirm = () => {
    if (parsedBatchPreview.length === 0) {
      showToast('Không tìm thấy từ vựng hợp lệ. Vui lòng kiểm tra lại định dạng!', 'warning');
      return;
    }

    setIsDirty(true);
    const filteredExisting = cards.filter(c => c.english.trim() || c.vietnamese.trim());
    const existingKeys = new Set(filteredExisting.map(c => `${c.english.trim().toLowerCase()}::${c.vietnamese.trim().toLowerCase()}`));
    const newCards = parsedBatchPreview.filter(c => {
      const key = `${c.english.trim().toLowerCase()}::${c.vietnamese.trim().toLowerCase()}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (newCards.length === 0) {
      showToast('Tất cả thẻ trong phần nhập nhanh đã tồn tại.', 'warning');
      return;
    }

    setCards([...filteredExisting, ...newCards]);
    setBatchText('');
    setShowBatchImport(false);
    showToast(`Đã thêm thành công ${newCards.length} thẻ từ!`, 'success');
  };

  // Quick preset sample text inserters
  const insertSampleFormat = (type) => {
    if (type === 'pipe') {
      setIsDirty(true);
      setBatchText(
        `well-known | nổi tiếng | He is a well-known scientist. | Anh ấy là một nhà khoa học nổi tiếng.\n` +
        `state-of-the-art | hiện đại | They use state-of-the-art tech. | Họ dùng công nghệ hiện đại.\n` +
        `Opportunity | Cơ hội | Grab every good opportunity. | Hãy nắm bắt mọi cơ hội tốt.`
      );
    } else if (type === 'tab') {
      setIsDirty(true);
      setBatchText(
        `Apple\tQuả táo\tI eat an apple every morning.\tTôi ăn một quả táo mỗi sáng.\n` +
        `Banana\tQuả chuối\tMonkeys love bananas.\tKhỉ rất thích ăn chuối.`
      );
    } else if (type === 'dash') {
      setIsDirty(true);
      setBatchText(
        `well-known - nổi tiếng - He is a well-known person - Anh ấy là người nổi tiếng\n` +
        `Goodbye - Tạm biệt - See you tomorrow - Hẹn gặp lại bạn vào ngày mai`
      );
    }
  };

  // Item 11, 12, 13 Fix: Unified submit handler, duplicate prevention, and preserved createdAt
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    if (!title.trim()) {
      showToast('Vui lòng nhập tên bộ từ vựng!', 'warning');
      return;
    }

    const incompleteCards = cards.filter(c => Boolean(c.english.trim()) !== Boolean(c.vietnamese.trim()));
    if (incompleteCards.length > 0) {
      showToast(`Có ${incompleteCards.length} thẻ chưa điền đủ tiếng Anh và tiếng Việt. Vui lòng hoàn tất hoặc xóa thẻ đó.`, 'warning');
      return;
    }

    const validCards = cards.filter(c => c.english.trim() && c.vietnamese.trim());
    if (validCards.length === 0) {
      showToast('Vui lòng điền đầy đủ tiếng Anh và tiếng Việt cho ít nhất 1 thẻ!', 'warning');
      return;
    }

    const uniqueKeys = new Set();
    const hasDuplicate = validCards.some(card => {
      const key = `${card.english.trim().toLowerCase()}::${card.vietnamese.trim().toLowerCase()}`;
      if (uniqueKeys.has(key)) return true;
      uniqueKeys.add(key);
      return false;
    });
    if (hasDuplicate) {
      showToast('Bộ từ vựng đang có thẻ trùng nhau. Vui lòng xóa thẻ trùng trước khi lưu.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const existingSet = sets.find(s => String(s.id) === String(editingSetId));
      const setData = {
        id: isEditing ? editingSetId : `set-${Date.now()}`,
        title: title.trim(),
        description: description.trim(),
        cards: validCards,
        createdAt: isEditing && existingSet && existingSet.createdAt ? existingSet.createdAt : Date.now()
      };

      await saveSet(setData);
      setIsDirty(false);
      localStorage.removeItem('vocabmaster_editor_draft');
    } catch (err) {
      showToast(err.message || 'Lỗi khi lưu bộ từ vựng.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="set-editor-view container animate-fade-in">
      {/* Header Bar */}
      <div className="editor-top-bar">
        <button type="button" className="btn btn-ghost" onClick={handleBack}>
          <ArrowLeft size={20} />
          Quay lại Trang chủ
        </button>
        <div className="editor-actions">
          <button 
            type="button" 
            className="btn btn-secondary btn-icon-text"
            onClick={() => setShowBatchImport(!showBatchImport)}
          >
            <FileText size={18} />
            <span>Nhập nhanh thông minh (Batch Add)</span>
          </button>
          <button 
            type="button" 
            className="btn btn-primary" 
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
            <span>{isSaving ? 'Đang lưu...' : (isEditing ? 'Lưu thay đổi' : 'Tạo bộ từ vựng')}</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Title & Description Card */}
        <div className="editor-meta-card">
          <h2>{isEditing ? 'Chỉnh Sửa Bộ Từ Vựng' : 'Tạo Bộ Từ Vựng Mới'}</h2>
          
          <div className="form-group">
            <label className="form-label required">Tên bộ từ vựng</label>
            <input
              type="text"
              className="form-input title-input"
              placeholder='Ví dụ: "IELTS Academic Vocabulary", "Từ vựng Giao tiếp hàng ngày"'
              value={title}
              onChange={(e) => { setIsDirty(true); setTitle(e.target.value); }}
              maxLength={150}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Mô tả (tùy chọn)</label>
            <textarea
              className="form-textarea"
              placeholder="Thêm mô tả về nội dung hoặc mục tiêu của bộ từ vựng này..."
              rows={2}
              value={description}
              onChange={(e) => { setIsDirty(true); setDescription(e.target.value); }}
              maxLength={500}
            />
          </div>
        </div>

        {/* Batch Import Drawer */}
        {showBatchImport && (
          <div className="batch-import-panel card animate-slide-down">
            <div className="panel-header">
              <div className="panel-title-group">
                <Sparkles className="text-primary" size={20} />
                <h3>Nhập nhanh nhiều từ vựng cùng lúc</h3>
              </div>
              <button 
                type="button" 
                className="icon-btn" 
                onClick={() => setShowBatchImport(false)}
                title="Đóng bảng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="preset-buttons-row">
              <span className="preset-label">Định dạng mẫu:</span>
              <button 
                type="button" 
                className="btn-preset-chip"
                onClick={() => insertSampleFormat('pipe')}
              >
                Mẫu dùng dấu Pipe |
              </button>
              <button 
                type="button" 
                className="btn-preset-chip"
                onClick={() => insertSampleFormat('tab')}
              >
                Copy Excel (Dấu Tab)
              </button>
              <button 
                type="button" 
                className="btn-preset-chip"
                onClick={() => insertSampleFormat('dash')}
              >
                Mẫu dùng dấu -
              </button>
            </div>

            <textarea
              className="form-textarea code-font batch-textarea"
              rows={6}
              placeholder={`well-known | nổi tiếng | He is a well-known scientist. | Anh ấy là một nhà khoa học nổi tiếng.\nstate-of-the-art | hiện đại | They use state-of-the-art tech. | Họ dùng công nghệ hiện đại.`}
              value={batchText}
              onChange={(e) => { setIsDirty(true); setBatchText(e.target.value); }}
              maxLength={50000}
            />

            {/* Live Real-Time Preview */}
            {parsedBatchPreview.length > 0 && (
              <div className="batch-preview-container">
                <div className="preview-header">
                  <span>🔍 Xem trước ({parsedBatchPreview.length} thẻ nhận diện thành công):</span>
                </div>
                <div className="preview-cards-grid">
                  {parsedBatchPreview.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="preview-card-chip">
                      <div className="chip-row">
                        <span className="chip-en">{item.english}</span>
                        <span className="chip-arrow">→</span>
                        <span className="chip-vn">{item.vietnamese}</span>
                      </div>
                      {item.example && (
                        <div className="chip-ex-row">
                          <span className="chip-ex">" {item.example} "</span>
                          {item.exampleTranslation && <span className="chip-ex-vn">({item.exampleTranslation})</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {parsedBatchPreview.length > 3 && (
                    <div className="preview-more-chip">
                      + và {parsedBatchPreview.length - 3} thẻ khác...
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="panel-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowBatchImport(false)}>
                Hủy
              </button>
              <button 
                type="button" 
                className="btn btn-primary btn-sm" 
                onClick={handleBatchParseConfirm}
                disabled={parsedBatchPreview.length === 0}
              >
                <Plus size={16} />
                Thêm {parsedBatchPreview.length > 0 ? `${parsedBatchPreview.length} thẻ` : 'danh sách từ'}
              </button>
            </div>
          </div>
        )}

        {/* Cards List Header */}
        <div className="cards-header-bar">
          <h3>Danh sách từ vựng ({cards.length} thẻ)</h3>
          <span className="cards-tip">Điền từ tiếng Anh, nghĩa tiếng Việt và câu ví dụ kèm bản dịch</span>
        </div>

        {/* Card Inputs List */}
        <div className="cards-list">
          {cards.map((card, index) => (
            <div key={card.id} className="card-editor-item">
              <div className="card-item-header">
                <span className="card-number-badge">{index + 1}</span>
                <div className="card-item-controls">
                  <button 
                    type="button" 
                    className="icon-btn-subtle" 
                    onClick={() => moveCard(index, -1)}
                    disabled={index === 0}
                    title="Di chuyển lên"
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button 
                    type="button" 
                    className="icon-btn-subtle" 
                    onClick={() => moveCard(index, 1)}
                    disabled={index === cards.length - 1}
                    title="Di chuyển xuống"
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button 
                    type="button" 
                    className="icon-btn-subtle danger" 
                    onClick={() => removeCardRow(card.id)}
                    title="Xóa thẻ này"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="card-item-fields">
                <div className="field-group">
                  <label className="field-label required">Từ tiếng Anh (English)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Accomplish"
                    value={card.english}
                    onChange={(e) => handleCardChange(card.id, 'english', e.target.value)}
                    maxLength={300}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label required">Nghĩa tiếng Việt (Vietnamese)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Hoàn thành, đạt được"
                    value={card.vietnamese}
                    onChange={(e) => handleCardChange(card.id, 'vietnamese', e.target.value)}
                    maxLength={300}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Câu ví dụ (Tiếng Anh)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. She worked hard to accomplish her goals this year."
                    value={card.example || ''}
                    onChange={(e) => handleCardChange(card.id, 'example', e.target.value)}
                    maxLength={500}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Dịch câu ví dụ (Tiếng Việt)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Cô ấy đã làm việc chăm chỉ để đạt được mục tiêu."
                    value={card.exampleTranslation || ''}
                    onChange={(e) => handleCardChange(card.id, 'exampleTranslation', e.target.value)}
                    maxLength={500}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Actions */}
        <div className="editor-bottom-bar">
          <button 
            type="button" 
            className="btn btn-secondary add-card-btn"
            onClick={addCardRow}
          >
            <Plus size={18} />
            Thêm thẻ mới
          </button>

          <button 
            type="submit" 
            className="btn btn-primary btn-lg"
            disabled={isSaving}
          >
            {isSaving ? <Loader2 size={20} className="spinner" /> : <Save size={20} />}
            <span>{isSaving ? 'Đang lưu...' : (isEditing ? 'Lưu thay đổi' : 'Tạo bộ từ vựng')}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
