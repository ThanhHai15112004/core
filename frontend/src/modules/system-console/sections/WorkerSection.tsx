import React from 'react';
import { UnmonitoredRuntime } from '../components/common/UnmonitoredRuntime';

export const WorkerSection: React.FC = () => (
  <UnmonitoredRuntime i18nKey="console.worker" sourcePath="backend/src/apps/worker/processors/" />
);
