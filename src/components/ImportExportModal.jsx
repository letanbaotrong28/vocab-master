import React, { useState } from 'react';
import { Download, Upload, X, Copy, HardDriveDownload, AlertCircle, Loader2 } from 'lucide-react';
import { storageService } from '../services/storage';
import { useApp } from '../context/useApp';
import { useModalAccessibility } from './useModalAccessibility';

export const ImportExportModal = () => {
  const { 
    isImportExportOpen, 
    setIsImportExportOpen, 
    handleImportSuccess, 
    showToast,
    sets
  } = useApp();

  const [dragOver, setDragOver] = useState(false);
  const [importError, setImportError] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const closeButtonRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const fileReaderRef = React.useRef(null);
  const importRunRef = React.useRef(0);
  const importBusyRef = React.useRef(false);

  const handleClose = () => {
    if (isImporting) return;
    setDragOver(false);
    setImportError('');
    setJsonText('');
    setIsImportExportOpen(false);
  };

  const dialogRef = useModalAccessibility({
    isOpen: isImportExportOpen,
    onClose: handleClose,
    canClose: !isImporting,
    initialFocusRef: closeButtonRef
  });

  const prepareImportedSets = (content) => {
    const normalized = storageService.validateAndNormalizeJson(content);
    // The backend upserts these sets and keeps all other account sets. Sending the
    // whole existing collection again is slower and used to exceed batch limits.
    return { setsToImport: normalized, importedCount: normalized.length };
  };

  React.useEffect(() => {
    if (!isImportExportOpen) return undefined;
    return () => {
      importRunRef.current += 1;
      importBusyRef.current = false;
      if (fileReaderRef.current?.readyState === FileReader.LOADING) {
        fileReaderRef.current.abort();
      }
      fileReaderRef.current = null;
      queueMicrotask(() => setIsImporting(false));
    };
  }, [isImportExportOpen]);

  const handleExportFile = () => {
    try {
      const jsonString = JSON.stringify(sets, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `vocabmaster_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Đã tải xuống tệp sao lưu JSON thành công!', 'success');
    } catch {
      showToast('Có lỗi xảy ra khi xuất dữ liệu', 'warning');
    }
  };

  // Item 26 Fix: Properly await clipboard writeText with error fallback
  const handleCopyJsonString = async () => {
    try {
      const jsonString = JSON.stringify(sets, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(jsonString);
        showToast('Đã sao chép toàn bộ mã JSON dữ liệu!', 'success');
      } else {
        throw new Error('Trình duyệt không hỗ trợ Clipboard API.');
      }
    } catch {
      showToast('Không thể tự động sao chép. Vui lòng copy thủ công!', 'warning');
    }
  };

  const handleImportJsonText = async () => {
    if (importBusyRef.current) return;
    setImportError('');
    if (!jsonText.trim()) {
      setImportError('Vui lòng dán chuỗi mã JSON vào khung bên dưới.');
      return;
    }

    importBusyRef.current = true;
    setIsImporting(true);
    const runId = ++importRunRef.current;
    try {
      const { setsToImport, importedCount } = prepareImportedSets(jsonText.trim());
      await handleImportSuccess(setsToImport);
      if (runId !== importRunRef.current) return;
      setJsonText('');
      setIsImportExportOpen(false);
      showToast(`Đã khôi phục ${importedCount} bộ từ vựng từ dữ liệu sao lưu.`, 'success');
    } catch (err) {
      if (runId === importRunRef.current) {
        setImportError(err.message || 'Mã JSON không đúng định dạng hoặc lưu thất bại.');
      }
    } finally {
      if (runId === importRunRef.current) {
        importBusyRef.current = false;
        setIsImporting(false);
      }
    }
  };

  const processFile = (file) => {
    if (importBusyRef.current) return;
    setImportError('');
    if (!file) return;

    // Item 129 Fix: Max 5MB file size limit
    if (file.size > 5 * 1024 * 1024) {
      setImportError('Dung lượng tệp vượt quá giới hạn 5MB cho phép.');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportError('Vui lòng chọn tệp có định dạng .json');
      return;
    }

    const runId = ++importRunRef.current;
    const reader = new FileReader();
    fileReaderRef.current = reader;
    importBusyRef.current = true;
    setIsImporting(true);

    reader.onerror = () => {
      if (runId !== importRunRef.current) return;
      importBusyRef.current = false;
      setIsImporting(false);
      setImportError('Không thể đọc tệp từ thiết bị. Tệp có thể bị lỗi hoặc bị khóa.');
    };

    reader.onabort = () => {
      if (runId === importRunRef.current) {
        importBusyRef.current = false;
        setIsImporting(false);
      }
    };

    reader.onload = async (e) => {
      if (runId !== importRunRef.current) return;
      try {
        const content = e.target.result;
        const { setsToImport, importedCount } = prepareImportedSets(content);
        await handleImportSuccess(setsToImport);
        if (runId !== importRunRef.current) return;
        setJsonText('');
        setIsImportExportOpen(false);
        showToast(`Đã khôi phục ${importedCount} bộ từ vựng từ tệp sao lưu.`, 'success');
      } catch (err) {
        if (runId === importRunRef.current) {
          setImportError(err.message || 'Tệp JSON không đúng định dạng hoặc lưu thất bại.');
        }
      } finally {
        if (runId === importRunRef.current) importBusyRef.current = false;
        if (runId === importRunRef.current) setIsImporting(false);
        if (fileReaderRef.current === reader) fileReaderRef.current = null;
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    processFile(file);
    e.target.value = ''; // Item 129 Fix: Reset file input so re-selecting same file triggers onChange
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  };

  if (!isImportExportOpen) return null;

  return (
    <div 
      className="modal-backdrop" 
      onClick={(event) => {
        if (!isImporting && event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-content animate-scale-up modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        aria-describedby="import-modal-description"
        aria-busy={isImporting}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge primary">
              <HardDriveDownload size={22} />
            </div>
            <div>
              <h3 id="import-modal-title" className="modal-title">Sao Lưu & Khôi Phục Dữ Liệu</h3>
              <p id="import-modal-description" className="modal-subtitle">Xuất hoặc nhập dữ liệu bộ từ vựng dạng tệp JSON</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="btn-icon" onClick={handleClose} disabled={isImporting} aria-label="Đóng bảng sao lưu và khôi phục">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-grid animate-fade-in">
            {/* Export Box */}
            <div className="import-export-card">
              <div className="card-badge">Xuất dữ liệu (Export)</div>
              <h4>Xuất dữ liệu dự phòng</h4>
              <p>Tải về tệp .json hoặc sao chép mã dữ liệu để lưu trữ dự phòng.</p>
              <div className="export-btn-group">
                <button type="button" className="btn btn-primary" onClick={handleExportFile} disabled={isImporting}>
                  <Download size={18} />
                  Tải File .JSON
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleCopyJsonString} disabled={isImporting}>
                  <Copy size={18} />
                  Sao chép mã JSON
                </button>
              </div>
            </div>

            {/* Import Box */}
            <div className="import-export-card">
              <div className="card-badge secondary">Nhập dữ liệu (Import)</div>
              <h4>Khôi phục bộ từ vựng</h4>
              <p>Kéo thả tệp .json hoặc dán chuỗi mã JSON đã sao chép trước đó.</p>

              <div 
                className={`drag-drop-area ${dragOver ? 'drag-active' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {isImporting ? (
                  <Loader2 size={28} className="drag-icon animate-spin" />
                ) : (
                  <Upload size={28} className="drag-icon" />
                )}
                <p className="drag-text">
                  {isImporting
                    ? 'Đang đồng bộ dữ liệu vào tài khoản...'
                    : 'Kéo thả tệp .json vào đây hoặc '}
                  {!isImporting && (
                    <button
                      type="button"
                      className="file-link file-link-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                    >
                      chọn tệp
                    </button>
                  )}
                </p>
                <input 
                  ref={fileInputRef}
                  id="file-upload" 
                  type="file" 
                  accept=".json" 
                  onChange={handleFileChange} 
                  className="hidden-file-input"
                  disabled={isImporting}
                  tabIndex={-1}
                />
              </div>

              {/* Item 30 Fix: Use multiline textarea for JSON paste instead of single-line input */}
              <div className="paste-json-wrapper vertical">
                <label className="sr-only" htmlFor="json-paste-input">Dán nội dung sao lưu JSON</label>
                <textarea
                  id="json-paste-input"
                  className="form-textarea code-font json-paste-area"
                  rows={4}
                  placeholder="Hoặc dán chuỗi mã JSON nhiều dòng vào đây..."
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  disabled={isImporting}
                />
                <button 
                  type="button"
                  className="btn btn-secondary btn-sm w-full mt-2" 
                  onClick={handleImportJsonText} 
                  disabled={!jsonText.trim() || isImporting}
                >
                  {isImporting ? 'Đang lưu...' : 'Khôi phục từ mã JSON'}
                </button>
              </div>

              {importError && (
                <div className="error-alert mt-2" role="alert">
                  <AlertCircle size={16} />
                  <span>{importError}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer justify-between">
          <span className="privacy-note">
            🔒 Tệp sao lưu có thể chứa toàn bộ bộ từ vựng; hãy cất tệp ở nơi an toàn.
          </span>
          <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={isImporting}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
