import { useCallback } from 'react';
import { useLocale } from '@core/i18n/index';
import { ROOT_CONTAINER } from '../../constants/storage';

/** Tên hiển thị của container: thư mục gốc → "(gốc)", còn lại thêm "/". */
export function useContainerLabel() {
  const { t } = useLocale();
  return useCallback((name: string) => (name === ROOT_CONTAINER ? t('storage.container.root') : `${name}/`), [t]);
}
