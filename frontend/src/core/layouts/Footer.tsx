import React from 'react';
import { APP_NAME } from '../constants/index';
import { ROUTES } from '../../routes/index';
import { useLocale } from '../i18n/index';
import { Activity, BookOpen, Terminal, Code2 } from 'lucide-react';

export const Footer: React.FC = () => {
  const { t } = useLocale();

  return (
    <footer className="footer-root">
      <div className="footer-content">
        <div className="footer-left">
          <p className="footer-brand-info">
            © {new Date().getFullYear()} {APP_NAME}. {t('footer.copyright')}
          </p>

          <div className="footer-status-pill">
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: 'var(--accent-cyan)',
                display: 'inline-block',
              }}
            />
            <Activity size={12} style={{ color: 'var(--accent-cyan)' }} />
            <span>{t('footer.platformStatus')}</span>
          </div>
        </div>

        <nav className="footer-links" aria-label="Footer Navigation">
          <a
            href={ROUTES.SYSTEM_CONSOLE}
            className="footer-link"
            title="Open Infrastructure Control Plane"
          >
            <Terminal size={14} />
            <span>{t('footer.controlPlane')}</span>
          </a>

          <a
            href="#architecture"
            className="footer-link"
            title="View Architecture Structure"
          >
            <Code2 size={14} />
            <span>{t('footer.architecture')}</span>
          </a>

          <a
            href="https://github.com/ThanhHai15112004/core"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            title="View Source Repository"
          >
            <BookOpen size={14} />
            <span>{t('footer.documentation')}</span>
          </a>
        </nav>
      </div>
    </footer>
  );
};
