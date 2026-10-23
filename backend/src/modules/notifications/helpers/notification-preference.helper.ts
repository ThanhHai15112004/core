import { defaultCodeRegistry } from '@packages/kernel/index.js';
import { getNotificationCategoryLabel, getNotificationCategoryName } from '../contracts/index.js';
import type { NotificationPreferenceEntity } from '../entities/notification-preference.entity.js';
import {
  NOTIFICATIONS_CODE_TYPES,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  type NotificationChannelCode,
  type NotificationChannelName,
} from '../enum/notifications.enum.js';
import type {
  NotificationPreferenceItemView,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';
import { DEFAULT_NOTIFICATION_PREFERENCE_MATRIX } from './notification-config.helper.js';

export function getRegisteredNotificationCategories(): {
  numericCode: number;
  code: string;
}[] {
  const registered = defaultCodeRegistry.listCodeValues(NOTIFICATIONS_CODE_TYPES.CATEGORY, {
    includeInactive: false,
  });
  if (registered.length > 0) {
    return registered.map((item) => ({
      numericCode: item.numericCode,
      code: item.code,
    }));
  }
  return [
    { numericCode: NOTIFICATION_CATEGORY.SYSTEM, code: 'SYSTEM' },
    { numericCode: NOTIFICATION_CATEGORY.WORK, code: 'WORK' },
    { numericCode: NOTIFICATION_CATEGORY.SECURITY, code: 'SECURITY' },
    { numericCode: NOTIFICATION_CATEGORY.ANNOUNCEMENT, code: 'ANNOUNCEMENT' },
  ];
}

export function buildUserPreferencesViewList(params: {
  storedPreferences: readonly NotificationPreferenceEntity[];
  runtimeConfig: ResolvedNotificationRuntimeConfig;
  locale?: string;
}): NotificationPreferenceItemView[] {
  const { storedPreferences, runtimeConfig, locale = 'vi' } = params;
  const byCategory = new Map<number, NotificationPreferenceEntity>();
  for (const pref of storedPreferences) {
    byCategory.set(Number(pref.category), pref);
  }

  const categories = getRegisteredNotificationCategories();

  return categories.map((cat) => {
    const stored = byCategory.get(cat.numericCode);
    const categoryCode = getNotificationCategoryName(cat.numericCode);
    const categoryLabel = getNotificationCategoryLabel(cat.numericCode, locale);
    const matrixDefaults = runtimeConfig.defaultPreferenceMatrix[categoryCode] ??
      DEFAULT_NOTIFICATION_PREFERENCE_MATRIX[categoryCode] ?? {
        inApp: true,
        email: true,
        sms: false,
        push: true,
      };

    const isSecurityCategory =
      cat.numericCode === NOTIFICATION_CATEGORY.SECURITY || categoryCode === 'SECURITY';
    const isSecurityLockedInApp = isSecurityCategory && runtimeConfig.lockSecurityInApp;

    const rawInApp = stored ? Boolean(stored.inAppEnabled) : matrixDefaults.inApp;
    const inAppEnabled = isSecurityLockedInApp ? true : rawInApp;
    const emailEnabled = stored ? Boolean(stored.emailEnabled) : matrixDefaults.email;
    const smsEnabled = stored ? Boolean(stored.smsEnabled) : matrixDefaults.sms;
    const pushEnabled = stored ? Boolean(stored.pushEnabled) : matrixDefaults.push;

    return {
      category: cat.numericCode,
      categoryCode,
      categoryLabel,
      inAppEnabled,
      emailEnabled,
      smsEnabled,
      pushEnabled,
      isSecurityLockedInApp,
      mutedUntil: stored?.mutedUntil ? stored.mutedUntil.toISOString() : null,
      updatedAt: stored?.updatedAt ? stored.updatedAt.toISOString() : null,
    };
  });
}

export function isChannelAllowedForRecipient(params: {
  channel: NotificationChannelCode;
  category: number;
  preference?: NotificationPreferenceEntity | undefined;
  runtimeConfig: ResolvedNotificationRuntimeConfig;
  forceDeliver?: boolean | undefined;
  now?: Date;
}): boolean {
  const {
    channel,
    category,
    preference,
    runtimeConfig,
    forceDeliver = false,
    now = new Date(),
  } = params;

  const channelNameMap: Record<number, NotificationChannelName> = {
    [NOTIFICATION_CHANNEL.IN_APP]: 'IN_APP',
    [NOTIFICATION_CHANNEL.EMAIL]: 'EMAIL',
    [NOTIFICATION_CHANNEL.SMS]: 'SMS',
    [NOTIFICATION_CHANNEL.PUSH]: 'PUSH',
  };
  const channelName = channelNameMap[channel] ?? 'IN_APP';

  if (!runtimeConfig.enabledChannels.includes(channelName)) {
    return false;
  }

  if (forceDeliver) {
    return true;
  }

  const categoryCode = getNotificationCategoryName(category);
  const isSecurityCategory =
    category === NOTIFICATION_CATEGORY.SECURITY || categoryCode === 'SECURITY';

  if (
    channel === NOTIFICATION_CHANNEL.IN_APP &&
    isSecurityCategory &&
    runtimeConfig.lockSecurityInApp
  ) {
    return true;
  }

  if (preference?.mutedUntil && preference.mutedUntil.getTime() > now.getTime()) {
    return false;
  }

  const matrixDefaults = runtimeConfig.defaultPreferenceMatrix[categoryCode] ??
    DEFAULT_NOTIFICATION_PREFERENCE_MATRIX[categoryCode] ?? {
      inApp: true,
      email: true,
      sms: false,
      push: true,
    };

  if (!preference) {
    if (channel === NOTIFICATION_CHANNEL.IN_APP) return matrixDefaults.inApp;
    if (channel === NOTIFICATION_CHANNEL.EMAIL) return matrixDefaults.email;
    if (channel === NOTIFICATION_CHANNEL.SMS) return matrixDefaults.sms;
    if (channel === NOTIFICATION_CHANNEL.PUSH) return matrixDefaults.push;
    return true;
  }

  if (channel === NOTIFICATION_CHANNEL.IN_APP) return Boolean(preference.inAppEnabled);
  if (channel === NOTIFICATION_CHANNEL.EMAIL) return Boolean(preference.emailEnabled);
  if (channel === NOTIFICATION_CHANNEL.SMS) return Boolean(preference.smsEnabled);
  if (channel === NOTIFICATION_CHANNEL.PUSH) return Boolean(preference.pushEnabled);
  return true;
}
