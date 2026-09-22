import React from 'react';
import type { RuntimeId } from '../../types/runtime.types';
import { useConsoleRoute } from '../../context/console-route-context';
import { RuntimesListView } from './RuntimesListView';
import { RuntimeDetailView } from './RuntimeDetailView';
import { DETAIL_TABS, type DetailTab } from '../../constants/runtime-metrics';
import '../../styles/console-runtimes.css';

const RUNTIME_IDS: RuntimeId[] = ['api', 'worker', 'scheduler'];

/** `runtimes` → danh sách; `runtimes/<id>/<tab>` → chi tiết. */
export const RuntimesSection: React.FC = () => {
  const { route } = useConsoleRoute();
  const [id, tab] = route.params;
  if (!id || !RUNTIME_IDS.includes(id as RuntimeId)) return <RuntimesListView />;
  const detailTab = DETAIL_TABS.includes(tab as DetailTab) ? (tab as DetailTab) : 'overview';
  return <RuntimeDetailView key={id} id={id as RuntimeId} tab={detailTab} />;
};
