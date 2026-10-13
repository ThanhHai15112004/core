import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';
import { Hint } from '../primitives/tooltip';

const COPIED_RESET_MS = 1500;

export function CopyButton({ value, label, size = 'icon-xs' }: { value: string; label?: string; size?: 'icon-xs' | 'icon-sm' | 'xs' }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('ui.toast.copied'));
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error(t('ui.toast.failed'));
    }
  };
  const text = label ?? t('ui.action.copy');
  return (
    <Hint content={text}>
      <Button variant="ghost" size={size} onClick={copy} aria-label={text}>
        {copied ? <Check className="text-ok" /> : <Copy />}
        {size === 'xs' && <span>{text}</span>}
      </Button>
    </Hint>
  );
}
