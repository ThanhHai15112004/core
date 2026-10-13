import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { errorMessage } from '../../data/error-message';
import { PanelState, type PanelStateProps } from './PanelState';

interface QueryViewProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError' | 'refetch'>;
  /** Dữ liệu có nhưng rỗng → hiện trạng thái trống. */
  isEmpty?: (data: T) => boolean;
  emptyMessage?: React.ReactNode;
  skeleton?: PanelStateProps['skeleton'];
  compact?: boolean;
  children: (data: T) => React.ReactNode;
}

/**
 * Hiển thị một query: loading → khung chờ, lỗi lần đầu → thông báo + thử lại, rỗng → trống.
 * Có dữ liệu cũ mà lần làm mới lỗi → vẫn hiện dữ liệu kèm cảnh báo nhỏ (không xoá màn hình).
 */
export function QueryView<T>({ query, isEmpty, emptyMessage, skeleton, compact, children }: QueryViewProps<T>) {
  const { t } = useLocale();
  const retry = () => void query.refetch();
  if (query.data === undefined) {
    if (query.isError) return <PanelState status="error" error={query.error} onRetry={retry} compact={compact} />;
    return <PanelState status="loading" skeleton={skeleton} compact={compact} />;
  }
  if (isEmpty?.(query.data)) return <PanelState status="empty" message={emptyMessage} compact={compact} />;
  return (
    <>
      {query.isError && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-warn-border bg-warn-bg px-2.5 py-1.5 text-xs text-warn-fg" role="status">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">{t('ui.state.offline')}</span>
          <span className="truncate text-faint">{errorMessage(query.error)}</span>
        </div>
      )}
      {children(query.data)}
    </>
  );
}
