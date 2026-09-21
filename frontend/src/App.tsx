import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { Home } from './modules/home/pages/Home';
import { AppProviders } from './providers/index';

function App() {
  return (
    <AppProviders>
      <Header />
      <Home />
      <Footer />
    </AppProviders>
  );
}

export default App;
