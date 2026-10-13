import { Languages } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';
import { Hint } from '../primitives/tooltip';

export function LocaleToggle() {
  const { t, locale, toggleLocale } = useLocale();
  return (
    <Hint content={t('ui.locale.toggle')}>
      <Button variant="ghost" size="sm" className="px-2" onClick={toggleLocale} aria-label={t('ui.locale.toggle')}>
        <Languages />
        <span className="font-mono text-xs uppercase">{locale}</span>
      </Button>
    </Hint>
  );
}
