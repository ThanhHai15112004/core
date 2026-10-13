import React from 'react';
import { OverviewSection } from '../sections/OverviewSection';
import { useConsoleRoute } from '../context/console-route-context';

/** Overview cũ nhận `onNavigate` qua props — bọc lại để registry chỉ cần component không props. */
export const OverviewEntry: React.FC = () => {
  const { navigate } = useConsoleRoute();
  return <OverviewSection onNavigate={navigate} />;
};
