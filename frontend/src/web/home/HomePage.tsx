import React, { useState } from 'react';
import { useLocale } from '../../core/i18n/index';
import { ROUTES } from '../../routes/index';
import { navigateTo } from '../../core/router/index';
import {
  Sparkles,
  Zap,
  Rocket,
  Boxes,
  Link2,
  Terminal,
  ArrowRight,
  ShieldCheck,
  FolderOpen,
  RotateCcw,
} from 'lucide-react';
import type { NavigationTabId } from '../../core/constants/index';

interface HomePageProps {
  onNavigateTab?: (tab: NavigationTabId) => void;
}

const FEATURES = [
  { key: 'react', icon: Zap, badge: 'React 19', color: 'var(--primary)' },
  { key: 'vite', icon: Rocket, badge: 'Vite 8', color: 'var(--secondary)' },
  { key: 'modular', icon: Boxes, badge: 'Chassis', color: 'var(--accent)' },
  { key: 'backend', icon: Link2, badge: 'NestJS 11', color: 'var(--primary)' },
] as const;

export const HomePage: React.FC<HomePageProps> = ({ onNavigateTab }) => {
  const { t } = useLocale();
  const [count, setCount] = useState<number>(0);

  return (
    <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px 72px', width: '100%' }}>
      {/* Hero Section */}
      <section
        style={{
          textAlign: 'center',
          marginBottom: '56px',
          padding: '48px 28px',
          borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(180deg, var(--bg-light-blue) 0%, var(--bg-surface) 100%)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-card)',
        }}
        className="animate-fade-in"
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '999px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-hover)',
            color: 'var(--primary)',
            fontSize: '13px',
            fontWeight: 700,
            marginBottom: '20px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <Sparkles size={15} />
          <span>{t('home.badge')}</span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(2.2rem, 4.5vw, 3.5rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            marginBottom: '18px',
            letterSpacing: '-0.8px',
            color: 'var(--text-main)',
          }}
        >
          {t('home.heroTitle')} <br />
          <span className="gradient-text">{t('home.heroHighlight')}</span>
        </h1>

        <p
          style={{
            fontSize: '16.5px',
            color: 'var(--text-secondary)',
            maxWidth: '680px',
            margin: '0 auto 32px',
            lineHeight: 1.7,
          }}
        >
          {t('home.heroDescription')}
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigateTab?.('auth')}
          >
            <ShieldCheck size={17} />
            <span>Mở Module Xác Thực (Auth)</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigateTab?.('files')}
          >
            <FolderOpen size={17} />
            <span>Quản Lý File & Media</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCount((c) => c + 1)}
          >
            <span>{t('home.counter', { count })}</span>
          </button>

          {count > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCount(0)}
              title={t('home.resetCounter')}
            >
              <RotateCcw size={15} />
            </button>
          )}
        </div>
      </section>

      {/* Control Plane Callout Banner */}
      <section className="home-console-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="home-console-banner-icon">
            <Terminal size={24} />
          </div>
          <div>
            <h3 className="home-console-banner-title">{t('home.consoleTitle')}</h3>
            <p className="home-console-banner-desc">{t('home.consoleDescription')}</p>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary home-console-banner-btn"
          onClick={() => {
            navigateTo(ROUTES.SYSTEM_CONSOLE);
          }}
        >
          <span>{t('home.consoleLaunch')}</span>
          <ArrowRight size={16} />
        </button>
      </section>

      {/* Feature Grid */}
      <section id="features">
        <h2
          style={{
            fontSize: '21px',
            fontWeight: 800,
            marginBottom: '20px',
            color: 'var(--text-main)',
          }}
        >
          {t('home.featuresTitle')}
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '20px',
          }}
        >
          {FEATURES.map((f) => {
            const IconComp = f.icon;
            return (
              <div
                key={f.key}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      background: 'var(--primary-light)',
                      color: f.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IconComp size={20} />
                  </div>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {f.badge}
                  </span>
                </div>
                <h3 style={{ fontSize: '16.5px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                  {t(`home.features.${f.key}.title`)}
                </h3>
                <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                  {t(`home.features.${f.key}.description`)}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};

