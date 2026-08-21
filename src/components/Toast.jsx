import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const Toast = ({ toast }) => {
  if (!toast) return null;

  const { message, type } = toast;

  const icons = {
    success: <CheckCircle2 className="toast-icon success" size={20} />,
    warning: <AlertCircle className="toast-icon warning" size={20} />,
    info: <Info className="toast-icon info" size={20} />
  };

  return (
    <div className={`toast-container toast-${type}`} role="status" aria-live="polite">
      {icons[type] || icons.info}
      <span className="toast-message">{message}</span>
    </div>
  );
};
