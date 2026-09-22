import React from 'react';
import {
  LayoutDashboard,
  Activity,
  Boxes,
  FileText,
  Cpu,
  Clock,
  Database,
  Zap,
  ShieldCheck,
  HardDrive,
  Radio,
  Globe,
  Server,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  Sun,
  Moon,
  ArrowLeft,
  Clock3,
  Search,
  Sliders,
  Home,
} from 'lucide-react';
import type { ConsoleSectionId } from '../../types/console.types';

export type IconIdentifier =
  | ConsoleSectionId
  | 'storage'
  | 'messaging'
  | 'api'
  | 'server'
  | 'terminal'
  | 'refresh'
  | 'sun'
  | 'moon'
  | 'back'
  | 'home'
  | 'check'
  | 'warning'
  | 'error'
  | 'clock'
  | 'search'
  | 'sliders';

interface ConsoleIconProps {
  name: IconIdentifier | string;
  size?: number;
  className?: string;
}

export const ConsoleIcon: React.FC<ConsoleIconProps> = ({
  name,
  size = 16,
  className = '',
}) => {
  switch (name) {
    case 'overview':
      return <LayoutDashboard size={size} className={className} />;
    case 'runtime':
      return <Activity size={size} className={className} />;
    case 'packages':
      return <Boxes size={size} className={className} />;
    case 'logs':
      return <FileText size={size} className={className} />;
    case 'worker':
    case 'cpu':
      return <Cpu size={size} className={className} />;
    case 'scheduler':
    case 'clock':
      return <Clock size={size} className={className} />;
    case 'database':
      return <Database size={size} className={className} />;
    case 'cache':
    case 'zap':
      return <Zap size={size} className={className} />;
    case 'security':
    case 'shield-check':
      return <ShieldCheck size={size} className={className} />;
    case 'storage':
    case 'hard-drive':
      return <HardDrive size={size} className={className} />;
    case 'messaging':
    case 'radio':
      return <Radio size={size} className={className} />;
    case 'api':
    case 'globe':
      return <Globe size={size} className={className} />;
    case 'server':
      return <Server size={size} className={className} />;
    case 'terminal':
      return <Terminal size={size} className={className} />;
    case 'refresh':
      return <RefreshCw size={size} className={className} />;
    case 'sun':
      return <Sun size={size} className={className} />;
    case 'moon':
      return <Moon size={size} className={className} />;
    case 'back':
      return <ArrowLeft size={size} className={className} />;
    case 'home':
      return <Home size={size} className={className} />;
    case 'check':
      return <CheckCircle2 size={size} className={className} />;
    case 'warning':
      return <AlertTriangle size={size} className={className} />;
    case 'error':
      return <AlertOctagon size={size} className={className} />;
    case 'clock3':
      return <Clock3 size={size} className={className} />;
    case 'search':
      return <Search size={size} className={className} />;
    case 'sliders':
      return <Sliders size={size} className={className} />;
    default:
      return <Boxes size={size} className={className} />;
  }
};
