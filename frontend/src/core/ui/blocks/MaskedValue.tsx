import { Lock } from 'lucide-react';
import { cn } from '../../lib/cn';
import { MASKED_VALUE } from '../../lib/format';
import { useLocale } from '../../i18n/index';
import { Hint } from '../primitives/tooltip';

/** Giá trị bí mật luôn bị che (secret, mật khẩu, token) — không nhận giá trị thật. */
export function MaskedValue({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <Hint content={t('ui.mask.hidden')}>
      <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs text-faint', className)} aria-label={t('ui.mask.hidden')}>
        <Lock className="size-3 shrink-0" />
        {MASKED_VALUE}
      </span>
    </Hint>
  );
}
