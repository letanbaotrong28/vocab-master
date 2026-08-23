import React from 'react';
import { CheckCircle2, AlertCircle, Info, XCircle } from 'lucide-react';

export const Toast = ({ toast }) => {
  if (!toast) return null;

  const { message, type } = toast;

  const icons = {
    success: <CheckCircle2 className="toast-icon success" size={20} aria-hidden="true" />,
    warning: <AlertCircle className="toast-icon warning" size={20} aria-hidden="true" />,
    error: <XCircle className="toast-icon error" size={20} aria-hidden="true" />,
    info: <Info className="toast-icon info" size={20} aria-hidden="true" />
  };

  const isUrgent = type === 'error' || type === 'warning';

  return (
    <div
      className={`toast-container toast-${type}`}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {icons[type] || icons.info}
      <span className="toast-message">{message}</span>
    </div>
  );
};
