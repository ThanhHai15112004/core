import React from 'react';
import { createPortal } from 'react-dom';
import { useConsoleTheme } from '../../context/console-theme-context';

/**
 * Portal ra `document.body` nhưng vẫn nằm trong `.console-root` (đúng theme),
 * vì toàn bộ CSS của console được scope theo `.console-root`.
 */
export const ConsolePortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useConsoleTheme();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="console-root console-portal" data-theme={theme}>
      {children}
    </div>,
    document.body,
  );
};
