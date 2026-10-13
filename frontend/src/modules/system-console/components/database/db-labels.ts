import type { DbSession } from '../../types/database.types';

type Translate = (path: string, params?: Record<string, string | number>) => string;

/** Nguồn của một session: runtime của Core, hoặc tên client ngoài. */
export const sessionSource = (s: Pick<DbSession, 'runtime' | 'program'>, t: Translate): string =>
  s.runtime ? runtimeLabel(s.runtime, t) : (s.program ?? t('db.session.external'));

/** Tên runtime (`other`/null = client ngoài Core). */
export const runtimeLabel = (runtime: string | null, t: Translate): string =>
  !runtime || runtime === 'other' ? t('db.session.external') : t(`rt.name.${runtime}`);


/** Ngày + giờ theo locale đang chọn ("13/10/2026 11:00"). */
export const dateTime = (value: string | number, locale: string, formatTime: (v: string | number, withSeconds?: boolean) => string, withSeconds = false): string =>
  `${new Date(value).toLocaleDateString(locale)} ${formatTime(value, withSeconds)}`;
