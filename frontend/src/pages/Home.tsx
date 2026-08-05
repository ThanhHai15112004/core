import React, { useState } from 'react';
import { Card } from '../components/common/Card';

export const Home: React.FC = () => {
  const [count, setCount] = useState<number>(0);

  const features = [
    {
      title: 'React 19 & TypeScript',
      description: 'Built with the latest React release and strict type checking for robust applications.',
      icon: '⚡',
      badge: 'v19.0'
    },
    {
      title: 'Vite Build Tool',
      description: 'Lightning fast HMR (Hot Module Replacement) and optimized production builds.',
      icon: '🚀',
      badge: 'Vite 6'
    },
    {
      title: 'Modular Architecture',
      description: 'Clean separation of concerns with components, hooks, services, and types.',
      icon: '🧩',
      badge: 'Clean Architecture'
    },
    {
      title: 'Backend Ready',
      description: 'Configured API service structure ready to integrate with NestJS backend.',
      icon: '🔗',
      badge: 'NestJS Sync'
    }
  ];

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 24px 80px', width: '100%' }}>
      {/* Hero Section */}
      <section style={{ textAlign: 'center', marginBottom: '80px' }} className="animate-fade-in">
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '30px',
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          color: '#818cf8',
          fontSize: '13px',
          fontWeight: '600',
          marginBottom: '24px'
        }}>
          ✨ Frontend App Initialized Successfully
        </div>
        <h1 style={{
          fontSize: ' clamp(2.5rem, 5vw, 4rem)',
          fontWeight: '800',
          lineHeight: '1.15',
          marginBottom: '20px',
          letterSpacing: '-1px'
        }}>
          Modern Web Development <br />
          <span className="gradient-text">Powered by React + Vite</span>
        </h1>
        <p style={{
          fontSize: '18px',
          color: 'var(--text-muted)',
          maxWidth: '650px',
          margin: '0 auto 36px',
          lineHeight: '1.7'
        }}>
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

      {/* Feature Grid */}
      <section id="features" style={{ marginBottom: '80px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '28px', color: 'var(--text-main)' }}>
          Project Structure & Features
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '24px'
        }}>
          {features.map((item, index) => (
            <Card key={index} {...item} />
          ))}
        </div>
      </section>

      {/* Folder Structure Overview */}
      <section id="architecture" className="glass" style={{ padding: '36px', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '16px' }}>
          📁 Frontend Directory Layout
        </h2>
        <pre style={{
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '20px',
          borderRadius: 'var(--radius-md)',
          color: '#a7f3d0',
          fontFamily: 'monospace',
          fontSize: '14px',
          overflowX: 'auto',
          lineHeight: '1.6'
        }}>
{`src/
├── components/     # UI Components (common, layout, features)
│   └── common/     # Reusable components (Header, Footer, Card)
├── hooks/          # Custom React Hooks (e.g. useFetch)
├── pages/          # Page components (Home, etc.)
├── services/       # API call handlers & integrations
├── styles/         # Global styles & design system
├── types/          # TypeScript interfaces & types
└── utils/          # Constants and utility functions`}
        </pre>
      </section>
    </main>
  );
};
