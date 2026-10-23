import { BadRequestAppException, defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  type SupportedLocale,
  isSupportedLocale,
  isValidIanaTimezone,
  resolveSystemDefaultLocale,
  resolveSystemDefaultTimezone,
} from '@packages/i18n/index.js';
import {
  USERS_CODE_TYPES,
  USER_GENDER,
  USER_STATUS,
  type UserStatusCode,
  type UserStatusName,
} from '../enum/users.enum.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserProfileRepository } from '../repositories/user-profile.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';

/**
 * Phân giải trạng thái người dùng thông qua CodeRegistryService (`users.status`).
 * Không còn hardcode chuỗi từ khóa tiếng Việt trong code — toàn bộ aliases được quản lý động tại `code_values`.
 */
export function parseUserStatus(val: unknown): UserStatusCode {
  if (val === 0 || val === '0') {
    return USER_STATUS.INACTIVE;
  }
  const resolved = defaultCodeRegistry.parseToNumericCode(
    USERS_CODE_TYPES.STATUS,
    val,
    USER_STATUS.ACTIVE,
  );
  if (resolved === 1 || resolved === 2 || resolved === 3 || resolved === 4) {
    return resolved;
  }
  const behavior = defaultCodeRegistry.resolveBehaviorCode(USERS_CODE_TYPES.STATUS, resolved);
  if (behavior === 'INACTIVE') return USER_STATUS.INACTIVE;
  if (behavior === 'LOCKED') return USER_STATUS.LOCKED;
  if (behavior === 'ARCHIVED') return USER_STATUS.ARCHIVED;
  return USER_STATUS.ACTIVE;
}

/**
 * Tra cứu tên mã trạng thái người dùng từ `users.status` (O(1) L1 Lookup).
 */
export function getUserStatusName(code: number): UserStatusName {
  const behavior = defaultCodeRegistry.resolveBehaviorCode(USERS_CODE_TYPES.STATUS, code);
  if (behavior === 'INACTIVE' || behavior === 'LOCKED' || behavior === 'ARCHIVED') {
    return behavior;
  }
  return 'ACTIVE';
}

/**
 * Phân giải giới tính người dùng thông qua CodeRegistryService (`users.gender`).
 */
export function parseUserGender(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  return defaultCodeRegistry.parseToNumericCode(USERS_CODE_TYPES.GENDER, val, USER_GENDER.OTHER);
}

/**
 * Tra cứu tên mã giới tính từ `users.gender`.
 */
export function getUserGenderName(code?: number | null): string | null {
  if (code === undefined || code === null) return null;
  return defaultCodeRegistry.getCodeName(USERS_CODE_TYPES.GENDER, code, 'OTHER');
}

/**
 * Tách hoặc chuẩn hóa firstName, lastName và fullName theo chuẩn tiếng Việt
 * (lastName = Họ và tên đệm, firstName = Tên gọi)
 */
export function resolveVietnameseNameParts(input: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  fullName?: string | null | undefined;
}): { firstName: string; lastName: string; fullName: string } {
  const rawFirst = input.firstName?.trim() ?? '';
  const rawLast = input.lastName?.trim() ?? '';
  const rawFull = input.fullName?.trim() ?? '';

  if (rawFirst && rawLast) {
    return {
      firstName: rawFirst,
      lastName: rawLast,
      fullName: rawFull || `${rawLast} ${rawFirst}`.trim(),
    };
  }

  if (rawFull) {
    const parts = rawFull.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return {
        firstName: rawFirst || parts[0]!,
        lastName: rawLast || parts[0]!,
        fullName: rawFull,
      };
    }
    const first = rawFirst || parts[parts.length - 1]!;
    const last = rawLast || parts.slice(0, -1).join(' ');
    return {
      firstName: first,
      lastName: last,
      fullName: rawFull,
    };
  }

  const fallbackFirst = rawFirst || 'User';
  const fallbackLast = rawLast || 'Core';
  return {
    firstName: fallbackFirst,
    lastName: fallbackLast,
    fullName: `${fallbackLast} ${fallbackFirst}`.trim(),
  };
}

/**
 * Chuẩn hóa số điện thoại về định dạng thống nhất (ví dụ +84909123456 -> 0909123456)
 * phục vụ tạo mã băm SHA-256 (blind index `phone_hash`) và tra cứu đăng nhập/đăng ký.
 */
export function normalizePhoneNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.trim().replace(/[\s.\-()]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+84')) {
    return `0${cleaned.slice(3)}`;
  }
  if (cleaned.startsWith('84') && cleaned.length >= 10 && cleaned.length <= 12) {
    return `0${cleaned.slice(2)}`;
  }
  return cleaned;
}

export function normalizePreferredLocaleOrThrow(locale?: string | null): SupportedLocale {
  if (locale === undefined || locale === null || locale.trim() === '') {
    return resolveSystemDefaultLocale();
  }
  const normalized = locale.trim().toLowerCase();
  if (!isSupportedLocale(normalized)) {
    throw new BadRequestAppException('users.invalidPreferredLocale', [{ locale }], { locale });
  }
  return normalized;
}

export function normalizePreferredTimezoneOrThrow(timezone?: string | null): string {
  if (timezone === undefined || timezone === null || timezone.trim() === '') {
    return resolveSystemDefaultTimezone();
  }
  const trimmed = timezone.trim();
  if (!isValidIanaTimezone(trimmed)) {
    throw new BadRequestAppException('users.invalidPreferredTimezone', [{ timezone: trimmed }], {
      timezone: trimmed,
    });
  }
  return trimmed;
}

export function registerUsersUsageCheckers(params: {
  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository | null;
  userOrgRepository: UserOrganizationUnitRepository;
}): void {
  const { userRepository, userProfileRepository, userOrgRepository } = params;

  defaultCodeRegistry.registerUsageChecker(
    USERS_CODE_TYPES.STATUS,
    'users.status',
    async ({ numericCode }) => {
      const { total } = await userRepository.searchPaginated({
        status: parseUserStatus(numericCode),
        includeArchived: true,
        page: 1,
        limit: 1,
      });
      return total;
    },
  );

  defaultCodeRegistry.registerUsageChecker(
    USERS_CODE_TYPES.GENDER,
    'user_profiles.gender',
    async ({ numericCode }) => {
      if (!userProfileRepository) return 0;
      const { items } = await userRepository.searchPaginated({
        includeArchived: true,
        page: 1,
        limit: 10000,
      });
      const userIds = items.filter((u) => !u.deletedAt).map((u) => Number(u.id));
      if (userIds.length === 0) return 0;
      const profiles = await userProfileRepository.findByUserIds(userIds);
      return profiles.filter((p) => Number(p.gender) === Number(numericCode)).length;
    },
  );

  defaultCodeRegistry.registerUsageChecker(
    USERS_CODE_TYPES.POSITION_TITLE,
    'user_organization_units.position_title',
    async ({ numericCode, code }) => {
      const { items } = await userRepository.searchPaginated({
        includeArchived: true,
        page: 1,
        limit: 10000,
      });
      const userIds = items.filter((u) => !u.deletedAt).map((u) => Number(u.id));
      if (userIds.length === 0) return 0;
      const assignments = await userOrgRepository.findByUserIds(userIds);
      const labelVi = defaultCodeRegistry.getLabel(
        USERS_CODE_TYPES.POSITION_TITLE,
        numericCode,
        'vi',
      );
      const labelEn = defaultCodeRegistry.getLabel(
        USERS_CODE_TYPES.POSITION_TITLE,
        numericCode,
        'en',
      );
      const candidates = new Set(
        [code, String(numericCode), labelVi, labelEn]
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      );
      return assignments.filter(
        (a) => a.positionTitle && candidates.has(a.positionTitle.trim().toUpperCase()),
      ).length;
    },
  );
}
