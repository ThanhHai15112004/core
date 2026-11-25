import { randomUUID } from 'node:crypto';
import type {
  CreateDomainEventInput,
  DomainEvent,
  DomainEventContextSnapshot,
} from '../contracts/domain-event.contract.js';
import {
  DOMAIN_EVENT_ERROR_CODE,
  DomainEventNamingViolationException,
  DomainEventPayloadViolationException,
} from '../errors/domain-event.exception.js';

/** Watermark thống nhất với `TypeOrmBaseEntity` & `TransformResponseInterceptor`. */
const ORM_ENTITY_WATERMARK = Symbol.for('core:orm_entity');

/** Giới hạn an toàn cho payload Domain Event (tránh nhồi nguyên bản ghi lớn hoặc vòng lặp sâu). */
export const DOMAIN_EVENT_MAX_PAYLOAD_BYTES = 64 * 1024;
export const DOMAIN_EVENT_MAX_PAYLOAD_DEPTH = 6;

/**
 * Chuẩn PascalCase tối thiểu 2 từ ghép (`UserCreated`, `OrderApproved`, `UserRolesAssigned`).
 * Không cho phép 1 từ đơn chung chung như `User` hoặc camelCase/snake_case.
 */
const PASCAL_EVENT_NAME_REGEX = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/;

/**
 * Chuẩn `dot.snake_case` dùng trong `module.manifest.json` và webhook matcher
 * (vd `user.created`, `user.roles_assigned`, `custom-fields.definition.created`).
 */
const DOT_EVENT_NAME_REGEX = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

/**
 * Danh sách khóa nhạy cảm tuyệt đối cấm đưa vào payload Domain Event (đồng bộ & mở rộng từ `logging/redaction`).
 * So khớp sau khi chuẩn hóa về chữ thường và bỏ dấu `-`, `_`.
 */
const FORBIDDEN_SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'oldpassword',
  'newpassword',
  'passwd',
  'secret',
  'clientsecret',
  'clientsecrethash',
  'signingsecret',
  'totpsecret',
  'encryptedsecret',
  'secretkey',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'idtoken',
  'authtoken',
  'xauthtoken',
  'bearer',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'privatekey',
  'encryptionkey',
  'masterkey',
  'creditcardnumber',
  'cardnumber',
  'cvv',
  'cvc',
  'otp',
  'emailotpcodehash',
  'smsotpcodehash',
  'recoverycodes',
  'recoverycodeshashjson',
  'codehash',
  'sessionid',
  'credential',
  'credentials',
  'salt',
]);

const FORBIDDEN_SECRET_SUFFIXES = [
  'password',
  'passwordhash',
  'secret',
  'secrethash',
  'privatekey',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
];

const FORBIDDEN_ENTITY_META_KEYS = new Set(['__entity__', '__typename', '_entity']);

/** Kiểm tra tên có đúng chuẩn PascalCase Domain Event (`UserCreated`, `OrderApproved`) hay không. */
export function isValidPascalEventName(name: string): boolean {
  const clean = name.trim();
  if (clean.length < 4 || clean.length > 120) return false;
  return PASCAL_EVENT_NAME_REGEX.test(clean);
}

/** Kiểm tra tên có đúng chuẩn `dot.snake_case` (`user.created`, `payments.transaction.succeeded`) hay không. */
export function isValidDotEventName(name: string): boolean {
  const clean = name.trim().toLowerCase();
  if (clean.length < 3 || clean.length > 160) return false;
  return DOT_EVENT_NAME_REGEX.test(clean);
}

/**
 * Chuyển đổi tên sự kiện sang chuẩn canonical PascalCase (`UserCreated`, `OrderApproved`).
 * Chấp nhận đầu vào PascalCase sẵn hoặc `dot.snake_case` từ `module.manifest.json`.
 */
export function toPascalEventName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new DomainEventNamingViolationException(rawName, 'Event name must not be empty');
  }
  if (isValidPascalEventName(trimmed)) {
    return trimmed;
  }
  const lowered = trimmed.toLowerCase();
  if (isValidDotEventName(lowered)) {
    const tokens = lowered.split(/[._-]+/).filter(Boolean);
    const pascal = tokens
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join('');
    if (isValidPascalEventName(pascal)) {
      return pascal;
    }
  }
  throw new DomainEventNamingViolationException(
    rawName,
    'Event name must be PascalCase with Entity+Action (e.g. "UserCreated", "OrderApproved") or dot.snake_case (e.g. "user.created")',
  );
}

/**
 * Chuyển đổi tên sự kiện sang dạng `dot.snake_case` (`user.created`, `order.approved`)
 * để tương thích 100% với `module.manifest.json` và `webhooks`.
 */
export function toDotEventName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new DomainEventNamingViolationException(rawName, 'Event name must not be empty');
  }
  const lowered = trimmed.toLowerCase();
  if (isValidDotEventName(lowered)) {
    return lowered;
  }
  if (isValidPascalEventName(trimmed)) {
    const words = trimmed.match(/[A-Z][a-z0-9]*/g);
    if (words && words.length >= 2) {
      const [domain, ...rest] = words;
      return `${domain!.toLowerCase()}.${rest.map((w) => w.toLowerCase()).join('_')}`;
    }
  }
  throw new DomainEventNamingViolationException(
    rawName,
    'Cannot convert invalid event name to dot.snake_case',
  );
}

/**
 * Chuẩn hóa cặp `{ type, dotName }` cho một Domain Event:
 * - `type`: canonical PascalCase (`UserCreated`, `OrderApproved`)
 * - `dotName`: dạng `dot.snake_case` (`user.created`, `order.approved`)
 */
export function normalizeDomainEventType(
  rawType: string,
  explicitDotName?: string,
): { readonly type: string; readonly dotName: string } {
  const type = toPascalEventName(rawType);
  let dotName: string;
  if (explicitDotName !== undefined) {
    const cleanDot = explicitDotName.trim().toLowerCase();
    if (!isValidDotEventName(cleanDot)) {
      throw new DomainEventNamingViolationException(
        explicitDotName,
        'Explicit dotName must follow dot.snake_case format (e.g. "user.created")',
      );
    }
    dotName = cleanDot;
  } else {
    dotName = toDotEventName(rawType);
  }
  return { type, dotName };
}

/** Kiểm tra xem mẫu đăng ký handler có khớp với Domain Event hay không. */
export function matchesDomainEventPattern(
  pattern: string,
  event: Pick<DomainEvent, 'type' | 'metadata'>,
): boolean {
  const clean = pattern.trim();
  if (!clean) return false;
  if (clean === '*') return true;

  if (clean === event.type) return true;

  const lowerPattern = clean.toLowerCase();
  const dotName = event.metadata.dotName.toLowerCase();
  if (lowerPattern === dotName) return true;

  if (lowerPattern.endsWith('.*')) {
    const prefix = lowerPattern.slice(0, -1); // giữ dấu "." cuối: "user."
    if (dotName.startsWith(prefix)) return true;
  }

  if (clean.endsWith('*') && !clean.endsWith('.*')) {
    const prefix = clean.slice(0, -1);
    if (prefix.length > 0 && event.type.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/** Kiểm tra khóa trường có thuộc danh sách trường nhạy cảm/secret bị cấm hay không. */
export function isForbiddenEventSecretKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/[-_]/g, '');
  if (!normalized) return false;
  if (FORBIDDEN_SECRET_KEYS.has(normalized)) return true;
  return FORBIDDEN_SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Kiểm tra giá trị có phải là ORM Entity hoặc instance class không phải Plain Object hay không. */
function isOrmEntityOrClassInstance(value: unknown): { detected: boolean; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { detected: false, reason: '' };
  }
  if (value instanceof Date) {
    return { detected: false, reason: '' };
  }
  if (ORM_ENTITY_WATERMARK in value) {
    return { detected: true, reason: 'ORM Entity watermark detected on payload object' };
  }
  const ctor = (value as { constructor?: unknown }).constructor;
  if (typeof ctor === 'function' && ctor !== Object) {
    if ((ctor as unknown as Record<symbol, unknown>)[ORM_ENTITY_WATERMARK] === true) {
      return {
        detected: true,
        reason: `ORM Entity class instance "${ctor.name || 'Entity'}" is forbidden in Domain Event payload`,
      };
    }
    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto !== null && proto !== Object.prototype) {
      return {
        detected: true,
        reason: `Non-plain class instance "${ctor.name || 'Object'}" is forbidden in Domain Event payload; pass a minimal plain DTO instead`,
      };
    }
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== null && proto !== Object.prototype) {
    return {
      detected: true,
      reason: 'Non-plain prototype object is forbidden in Domain Event payload',
    };
  }
  return { detected: false, reason: '' };
}

/**
 * Kiểm định nghiêm ngặt payload của Domain Event (throw ngay cả dev & prod khi vi phạm):
 * 1. Phải là plain object (không phải null/array/primitive/ORM Entity/class instance).
 * 2. Không chứa ORM Entity hoặc class instance ở bất kỳ cấp lồng nào.
 * 3. Không chứa khóa secret / trường nhạy cảm (`password`, `token`, `secret`, `apiKey`, `privateKey`...).
 * 4. Không chứa function, symbol, vòng lặp tham chiếu (circular reference), quá sâu hoặc vượt kích thước 64KB.
 * Trả về bản sao sạch được đóng băng nông/sâu để tránh handler sửa đổi chéo payload.
 */
export function assertSafeDomainEventPayload<TPayload extends Record<string, unknown>>(
  payload: TPayload,
): Readonly<TPayload> {
  if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DomainEventPayloadViolationException({
      code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
      violationKind: 'invalid_payload',
      fieldPath: 'payload',
      reason: 'Domain Event payload must be a non-null plain object',
    });
  }

  const rootEntityCheck = isOrmEntityOrClassInstance(payload);
  if (rootEntityCheck.detected) {
    throw new DomainEventPayloadViolationException({
      code: DOMAIN_EVENT_ERROR_CODE.ENTITY_LEAK,
      violationKind: 'entity_leak',
      fieldPath: 'payload',
      reason: rootEntityCheck.reason,
    });
  }

  const visited = new WeakSet<object>();

  const inspectAndClone = (value: unknown, fieldPath: string, depth: number): unknown => {
    if (value === null || value === undefined) return value;

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'boolean') return value;
    if (valueType === 'number') {
      if (!Number.isFinite(value)) {
        throw new DomainEventPayloadViolationException({
          code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
          violationKind: 'invalid_payload',
          fieldPath,
          reason: 'Non-finite number (NaN/Infinity) is not allowed in Domain Event payload',
        });
      }
      return value;
    }
    if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
      throw new DomainEventPayloadViolationException({
        code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
        violationKind: 'invalid_payload',
        fieldPath,
        reason: `Unsupported value type "${valueType}" in Domain Event payload`,
      });
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new DomainEventPayloadViolationException({
          code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
          violationKind: 'invalid_payload',
          fieldPath,
          reason: 'Invalid Date value in Domain Event payload',
        });
      }
      return value.toISOString();
    }

    if (depth > DOMAIN_EVENT_MAX_PAYLOAD_DEPTH) {
      throw new DomainEventPayloadViolationException({
        code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
        violationKind: 'invalid_payload',
        fieldPath,
        reason: `Domain Event payload exceeds maximum nesting depth (${DOMAIN_EVENT_MAX_PAYLOAD_DEPTH})`,
      });
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) {
        throw new DomainEventPayloadViolationException({
          code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
          violationKind: 'invalid_payload',
          fieldPath,
          reason: 'Circular reference detected in Domain Event payload array',
        });
      }
      visited.add(value);
      const clonedArr = value.map((item, idx) =>
        inspectAndClone(item, `${fieldPath}[${idx}]`, depth + 1),
      );
      return Object.freeze(clonedArr);
    }

    if (typeof value === 'object') {
      const entityCheck = isOrmEntityOrClassInstance(value);
      if (entityCheck.detected) {
        throw new DomainEventPayloadViolationException({
          code: DOMAIN_EVENT_ERROR_CODE.ENTITY_LEAK,
          violationKind: 'entity_leak',
          fieldPath,
          reason: entityCheck.reason,
        });
      }

      if (visited.has(value)) {
        throw new DomainEventPayloadViolationException({
          code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
          violationKind: 'invalid_payload',
          fieldPath,
          reason: 'Circular reference detected in Domain Event payload object',
        });
      }
      visited.add(value);

      const record = value as Record<string, unknown>;
      const clonedObj: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(record)) {
        const nextPath = `${fieldPath}.${key}`;
        if (FORBIDDEN_ENTITY_META_KEYS.has(key.toLowerCase())) {
          throw new DomainEventPayloadViolationException({
            code: DOMAIN_EVENT_ERROR_CODE.ENTITY_LEAK,
            violationKind: 'entity_leak',
            fieldPath: nextPath,
            reason: `Entity metadata field "${key}" is forbidden in Domain Event payload`,
          });
        }
        if (isForbiddenEventSecretKey(key)) {
          throw new DomainEventPayloadViolationException({
            code: DOMAIN_EVENT_ERROR_CODE.SECRET_LEAK,
            violationKind: 'secret_leak',
            fieldPath: nextPath,
            reason: `Sensitive/secret field "${key}" is strictly forbidden in Domain Event payload`,
          });
        }
        clonedObj[key] = inspectAndClone(nested, nextPath, depth + 1);
      }
      return Object.freeze(clonedObj);
    }

    return value;
  };

  const frozenPayload = inspectAndClone(payload, 'payload', 0) as Readonly<TPayload>;

  const serializedBytes = Buffer.byteLength(JSON.stringify(frozenPayload) ?? '', 'utf8');
  if (serializedBytes > DOMAIN_EVENT_MAX_PAYLOAD_BYTES) {
    throw new DomainEventPayloadViolationException({
      code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
      violationKind: 'invalid_payload',
      fieldPath: 'payload',
      reason: `Domain Event payload size (${serializedBytes} bytes) exceeds limit (${DOMAIN_EVENT_MAX_PAYLOAD_BYTES} bytes); pass identifiers instead of full records`,
    });
  }

  return frozenPayload;
}

/** Kiểm tra xem đầu vào đã là một `DomainEvent` hoàn chỉnh hay là `CreateDomainEventInput`. */
export function isDomainEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
>(value: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>): value is DomainEvent<TPayload> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'metadata' in value &&
    typeof value.metadata === 'object' &&
    value.metadata !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'occurredAt' in value &&
    typeof value.occurredAt === 'string'
  );
}

/**
 * Tạo đối tượng `DomainEvent` chuẩn bất biến:
 * - Tự sinh `id` (UUID v4), `occurredAt` (ISO-8601), `version` (mặc định `1`)
 * - Chuẩn hóa `type` (PascalCase) & `metadata.dotName` (`dot.snake_case`)
 * - Tự gắn `requestId`, `correlationId`, `actorId` từ ngữ cảnh hiện tại nếu không truyền tường minh
 * - Kiểm định nghiêm ngặt payload chống rò rỉ Entity/Secret
 */
export function createDomainEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
>(
  input: CreateDomainEventInput<TPayload>,
  context?: DomainEventContextSnapshot,
): DomainEvent<TPayload> {
  const { type, dotName } = normalizeDomainEventType(input.type, input.dotName);

  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new DomainEventPayloadViolationException({
      code: DOMAIN_EVENT_ERROR_CODE.INVALID_VERSION,
      violationKind: 'invalid_payload',
      fieldPath: 'version',
      reason: 'Domain Event version must be a positive integer (>= 1)',
    });
  }

  const sourceModule = input.sourceModule.trim().toLowerCase();
  if (!sourceModule) {
    throw new DomainEventPayloadViolationException({
      code: DOMAIN_EVENT_ERROR_CODE.INVALID_PAYLOAD,
      violationKind: 'invalid_payload',
      fieldPath: 'sourceModule',
      reason: 'Domain Event sourceModule is required',
    });
  }

  const safePayload = assertSafeDomainEventPayload(input.payload);
  const id = input.id?.trim() || randomUUID();
  const occurredAt = input.occurredAt?.trim() || new Date().toISOString();
  const requestId =
    input.requestId !== undefined ? input.requestId : (context?.requestId ?? null);
  const correlationId =
    input.correlationId !== undefined
      ? input.correlationId
      : (context?.correlationId ?? requestId ?? null);
  const actorId = input.actorId !== undefined ? input.actorId : (context?.actorId ?? null);

  return Object.freeze({
    id,
    type,
    version,
    occurredAt,
    aggregateId:
      input.aggregateId !== undefined && input.aggregateId !== null
        ? String(input.aggregateId)
        : null,
    aggregateType: input.aggregateType?.trim() || null,
    payload: safePayload,
    metadata: Object.freeze({
      requestId,
      correlationId,
      causationId: input.causationId ?? null,
      actorId,
      sourceModule,
      dotName,
    }),
  });
}
