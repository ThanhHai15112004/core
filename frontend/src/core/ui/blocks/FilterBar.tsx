import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';

/** Hàng bộ lọc: các control + nút "Xoá lọc" khi đang lọc. */
export function FilterBar({ children, active, onClear, className }: { children: React.ReactNode; active?: boolean; onClear?: () => void; className?: string }) {
  const { t } = useLocale();
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>
      {children}
      {active && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X />
          {t('ui.action.clear')}
        </Button>
      )}
    </div>
  );
}
