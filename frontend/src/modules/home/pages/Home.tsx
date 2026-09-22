import React, { useState } from 'react';
import { Card } from '../../../core/components/card/Card';

export const Home: React.FC = () => {
  const [count, setCount] = useState<number>(0);

  const features = [
    {
      title: 'React 19 & TypeScript',
      description: 'Built with the latest React release and strict type checking for robust applications.',
      icon: '⚡',
      badge: 'v19.0',
    },
    {
      title: 'Vite Build Tool',
      description: 'Lightning fast HMR (Hot Module Replacement) and optimized production builds.',
      icon: '🚀',
      badge: 'Vite 6',
    },
    {
      title: 'Modular Architecture',
      description: 'Clean separation of concerns with core reusable platform and isolated business modules.',
      icon: '🧩',
      badge: 'Chassis Platform',
    },
    {
      title: 'Backend Ready',
      description: 'Configured API service structure ready to integrate with NestJS Fastify backend.',
      icon: '🔗',
      badge: 'NestJS Sync',
    },
  ];

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
          ✨ Core Framework Initialized Successfully
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
          Modern Web Development <br />
          <span className="gradient-text">Powered by React + Vite</span>
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
          Your frontend structure is ready for production. Clean architecture, modern design system, and full TypeScript integration.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => setCount((c) => c + 1)}>
            Interactive State: {count}
          </button>
          <button className="btn-secondary" onClick={() => setCount(0)}>
            Reset Count
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
              Developer & DevOps System Control Plane
            </h3>
            <p className="home-console-banner-desc">
              Dedicated infrastructure dashboard for monitoring multi-runtimes, live logs, database ping, redis cache, workers, and cron tasks.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary home-console-banner-btn"
          onClick={() => {
            window.location.hash = '#system-console';
          }}
        >
          Launch System Console →
        </button>
      </section>

      {/* Feature Grid */}
      <section id="features" style={{ marginBottom: '80px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '28px', color: 'var(--text-main)' }}>
          Project Structure & Features
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '24px',
          }}
        >
          {features.map((item, index) => (
            <Card key={index} {...item} />
          ))}
        </div>
      </section>

      {/* Folder Structure Overview */}
      <section id="architecture" className="glass" style={{ padding: '36px', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '16px' }}>
          📁 Frontend Directory Layout (AGENTS.md)
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
