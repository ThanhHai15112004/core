import type { Theme } from './theme-context';

export interface ThemePalette {
  readonly mode: Theme;
  readonly primary: string;
  readonly primaryHover: string;
  readonly primaryLight: string;
  readonly secondary: string;
  readonly secondaryLight: string;
  readonly accent: string;
  readonly accentLight: string;
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly surfaceGlass: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

export const SYSTEM_THEME_STORAGE_KEY = 'core_system_theme';
export const DEFAULT_SYSTEM_THEME: Theme = 'light';

/**
 * Cấu hình bảng màu chuẩn toàn hệ thống (Light / Dark Mode)
 * - Light: Primary #2563EB, Secondary #14B8A6, Light blue #EFF6FF, Accent #F59E0B, Background #FFFFFF, Text #0F172A
 * - Dark:  Background #0B1120, Surface/Card #151E2E, Primary #3B82F6, Secondary #2DD4BF, Accent #FBBF24, Text #F1F5F9
 */
export const SYSTEM_THEME_CONFIG: Record<Theme, ThemePalette> = {
  light: {
    mode: 'light',
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primaryLight: '#EFF6FF',
    secondary: '#14B8A6',
    secondaryLight: '#F0FDFA',
    accent: '#F59E0B',
    accentLight: '#FFFBEB',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#F8FAFC',
    surfaceGlass: 'rgba(255, 255, 255, 0.88)',
    text: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#64748B',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
  },
  dark: {
    mode: 'dark',
    primary: '#3B82F6',
    primaryHover: '#60A5FA',
    primaryLight: 'rgba(59, 130, 246, 0.15)',
    secondary: '#2DD4BF',
    secondaryLight: 'rgba(45, 212, 191, 0.14)',
    accent: '#FBBF24',
    accentLight: 'rgba(251, 191, 36, 0.14)',
    background: '#0B1120',
    surface: '#151E2E',
    surfaceElevated: '#1E293B',
    surfaceGlass: 'rgba(21, 30, 46, 0.85)',
    text: '#F1F5F9',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    border: '#1E293B',
    borderStrong: '#334155',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#F87171',
  },
} as const;

