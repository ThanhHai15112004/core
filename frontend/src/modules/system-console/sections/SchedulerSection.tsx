import React from 'react';
import { UnmonitoredRuntime } from '../components/common/UnmonitoredRuntime';

export const SchedulerSection: React.FC = () => (
  <UnmonitoredRuntime i18nKey="console.scheduler" sourcePath="backend/src/apps/scheduler/tasks/" />
);
