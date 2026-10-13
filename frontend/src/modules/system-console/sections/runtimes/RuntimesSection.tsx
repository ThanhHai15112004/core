import React from 'react';
import { useRuntimesPage } from './useRuntimesPage';
import { RuntimesListPage } from './RuntimesListPage';
import { RuntimeDetailPage } from './RuntimeDetailPage';

/** `runtimes` → danh sách runtime; `runtimes/<id>[/<tab>]` → chi tiết. */
export const RuntimesSection: React.FC = () => {
  const page = useRuntimesPage();
  return page.id ? <RuntimeDetailPage key={page.id} page={page} id={page.id} /> : <RuntimesListPage page={page} />;
};
