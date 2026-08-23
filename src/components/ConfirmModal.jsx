import React, { useRef, useState } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { useModalAccessibility } from './useModalAccessibility';

export const ConfirmModal = ({ modal, onClose }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cancelButtonRef = useRef(null);
  const dialogRef = useModalAccessibility({
    isOpen: modal.isOpen,
    onClose,
    canClose: !isSubmitting,
    initialFocusRef: cancelButtonRef
  });

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
      onClick={(event) => {
        if (!isSubmitting && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-content animate-scale-up"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        aria-busy={isSubmitting}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <div className={`modal-icon-badge ${modal.danger ? 'danger' : 'info'}`}>
              <AlertTriangle size={22} />
            </div>
            <h3 id="confirm-modal-title" className="modal-title">{modal.title}</h3>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} disabled={isSubmitting} aria-label="Đóng bảng xác nhận">
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          <p id="confirm-modal-message">{modal.message}</p>
        </div>

        <div className="modal-footer">
          <button ref={cancelButtonRef} type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Hủy bỏ
          </button>
          <button 
            type="button"
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
