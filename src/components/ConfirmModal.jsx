import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

export const ConfirmModal = ({ modal, onClose }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && modal.isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modal.isOpen, isSubmitting, onClose]);

  if (!modal.isOpen) return null;

  const handleConfirmClick = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await modal.onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="modal-backdrop" 
      onClick={isSubmitting ? null : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="modal-content animate-scale-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className={`modal-icon-badge ${modal.danger ? 'danger' : 'info'}`}>
              <AlertTriangle size={22} />
            </div>
            <h3 id="confirm-modal-title" className="modal-title">{modal.title}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} disabled={isSubmitting} aria-label="Đóng bảng xác nhận">
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          <p>{modal.message}</p>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Hủy bỏ
          </button>
          <button 
            className={`btn ${modal.danger ? 'btn-danger' : 'btn-primary'}`} 
            onClick={handleConfirmClick}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Đang xử lý...
              </>
            ) : (
              modal.confirmText || 'Xác nhận'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
