import React, { useState } from 'react';
import { Card } from '../../../core/components/card/Card';
import { useLocale } from '../../../core/i18n/index';
import { ROUTES } from '../../../routes/index';

const FEATURES = [
  { key: 'react', icon: '⚡', badge: 'React 19' },
  { key: 'vite', icon: '🚀', badge: 'Vite 8' },
  { key: 'modular', icon: '🧩', badge: 'Chassis' },
  { key: 'backend', icon: '🔗', badge: 'NestJS 11' },
] as const;

export const Home: React.FC = () => {
  const { t } = useLocale();
  const [count, setCount] = useState<number>(0);

  const features = FEATURES.map((f) => ({
    icon: f.icon,
    badge: f.badge,
    title: t(`home.features.${f.key}.title`),
    description: t(`home.features.${f.key}.description`),
  }));

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 24px 80px', width: '100%' }}>
      {/* Hero Section */}
      <section style={{ textAlign: 'center', marginBottom: '80px' }} className="animate-fade-in">
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '30px',
            background: 'var(--primary-glow)',
            border: '1px solid var(--border-hover)',
            color: 'var(--primary)',
            fontSize: '13px',
            fontWeight: '600',
            marginBottom: '24px',
          }}
        >
          ✨ {t('home.badge')}
        </div>
        <h1
          style={{
            fontSize: 'clamp(2.5rem, 5vw, 4rem)',
            fontWeight: '800',
            lineHeight: '1.15',
            marginBottom: '20px',
            letterSpacing: '-1px',
          }}
        >
          {t('home.heroTitle')} <br />
          <span className="gradient-text">{t('home.heroHighlight')}</span>
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--text-muted)',
            maxWidth: '650px',
            margin: '0 auto 36px',
            lineHeight: '1.7',
          }}
        >
          {t('home.heroDescription')}
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => setCount((c) => c + 1)}>
            {t('home.counter', { count })}
          </button>
          <button className="btn-secondary" onClick={() => setCount(0)}>
            {t('home.resetCounter')}
          </button>
        </div>
      </section>

      {/* Control Plane Callout Banner */}
      <section className="home-console-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="home-console-banner-icon">
            ⚡
          </div>
          <div>
            <h3 className="home-console-banner-title">
              {t('home.consoleTitle')}
            </h3>
            <p className="home-console-banner-desc">
              {t('home.consoleDescription')}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary home-console-banner-btn"
          onClick={() => {
            window.location.hash = ROUTES.SYSTEM_CONSOLE;
          }}
        >
          {t('home.consoleLaunch')} →
        </button>
      </section>

      {/* Feature Grid */}
      <section id="features" style={{ marginBottom: '80px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '28px', color: 'var(--text-main)' }}>
          {t('home.featuresTitle')}
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '24px',
          }}
        >
          {features.map((item, index) => (
            <Card key={FEATURES[index]?.key} {...item} />
          ))}
        </div>
      </section>

      {/* Folder Structure Overview */}
      <section id="architecture" className="glass" style={{ padding: '36px', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '16px' }}>
          📁 {t('home.layoutTitle')}
        </h2>
        <pre
          style={{
            background: 'var(--bg-primary)',
            padding: '20px',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent-cyan)',
            fontFamily: 'monospace',
            fontSize: '14px',
            overflowX: 'auto',
            lineHeight: '1.6',
            border: '1px solid var(--border-color)',
          }}
        >
{`frontend/src/
├── core/             # Tầng kỹ thuật + UI dùng chung, KHÔNG chứa nghiệp vụ
│   ├── components/   # UI primitive (Card, Button, Modal...)
│   ├── layouts/      # Khung trang (Header, Footer, MainLayout)
│   ├── hooks/        # Hook thuần kỹ thuật (useFetch, useDebounce...)
│   ├── services/     # HTTP client cơ sở (api.ts)
│   ├── theme/        # Design tokens
│   ├── types/        # Type dùng chung toàn app
│   └── constants/    # Hằng số chung
├── modules/          # Module nghiệp vụ của ứng dụng
│   └── home/pages/   # Home Page
├── routes/           # Routing configuration
└── providers/        # App providers`}
        </pre>
      </section>
    </main>
  );
};
