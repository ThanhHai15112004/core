import React from 'react';
import {
  Archive,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Table,
} from 'lucide-react';
import type { FileRecordItem } from '../types/files.types';

/** Hiển thị ô biểu tượng loại file đồng bộ trên toàn bộ File Manager & File Picker */
export const renderFileTypeIconBox = (
  item: FileRecordItem,
  size: 'sm' | 'md' = 'sm',
): React.ReactElement => {
  const dim = size === 'md' ? '38px' : '34px';
  const ext = item.extension.replace('.', '').toUpperCase();
  switch (item.category) {
    case 1:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
            color: '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ImageIcon size={18} />
        </div>
      );
    case 2:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
            color: '#6d28d9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Film size={18} />
        </div>
      );
    case 3:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: '#fae8ff',
            color: '#a21caf',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Music size={18} />
        </div>
      );
    case 4:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: ext === 'PDF' ? '#fee2e2' : '#dbeafe',
            color: ext === 'PDF' ? '#dc2626' : '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '0.7rem',
            flexShrink: 0,
          }}
        >
          {ext === 'PDF' ? 'PDF' : <FileText size={18} />}
        </div>
      );
    case 5:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: '#d1fae5',
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '0.72rem',
            flexShrink: 0,
          }}
        >
          <Table size={18} />
        </div>
      );
    case 6:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: '#fef3c7',
            color: '#d97706',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Archive size={18} />
        </div>
      );
    default:
      return (
        <div
          style={{
            width: dim,
            height: dim,
            borderRadius: '9px',
            background: '#f1f5f9',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FileIcon size={18} />
        </div>
      );
  }
};
