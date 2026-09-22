import { createContext, useContext } from 'react';
import type { ConsolePath, ConsoleSectionId } from '../types/console.types';

export interface ConsoleRoute {
  section: ConsoleSectionId;
  /** Các segment sau section, vd. `runtimes/worker/metrics` → `['worker', 'metrics']`. */
  params: string[];
  query: URLSearchParams;
}

export interface ConsoleRouteContextValue {
  route: ConsoleRoute;
  navigate: (path: ConsolePath) => void;
}

export const ConsoleRouteContext = createContext<ConsoleRouteContextValue | null>(null);

export const useConsoleRoute = (): ConsoleRouteContextValue => {
  const context = useContext(ConsoleRouteContext);
  if (!context) throw new Error('useConsoleRoute must be used within SystemConsoleRouter');
  return context;
};
