import { useState } from 'react';
import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { Home } from './modules/home/pages/Home';
import { SystemOpsPage } from './modules/system-ops/pages/SystemOpsPage';
import { AppProviders } from './providers/index';
import type { NavigationTabId } from './core/constants/index';

function App() {
  const [activeTab, setActiveTab] = useState<NavigationTabId>('home');

  return (
    <AppProviders>
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === 'home' ? <Home /> : <SystemOpsPage />}
      <Footer />
    </AppProviders>
  );
}

export default App;
