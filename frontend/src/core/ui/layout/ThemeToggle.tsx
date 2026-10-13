import { Moon, Sun } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { useTheme } from '../../theme/theme-context';
import { Button } from '../primitives/button';
import { Hint } from '../primitives/tooltip';

export function ThemeToggle() {
  const { t } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Hint content={t(`ui.theme.${next}`)}>
      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={t('ui.theme.toggle')}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Hint>
  );
}
