import { expect, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HTTP_ERROR_CODE, HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import type { ApiErrorResponse } from '@packages/http/index.js';
import {
  TokenService,
  type TokenPayload,
  type UserIdentity,
} from '@packages/security/index.js';
import { userIdentityFactory } from '../fixtures/data-factory.fixture.js';

export interface ActingAsContext {
  readonly user: UserIdentity;
  readonly token: string;
  readonly headers: Record<string, string>;
}

const tokenRegistryByApp = new WeakMap<INestApplication, Map<string, UserIdentity>>();
const instrumentedApps = new WeakSet<INestApplication>();

/**
 * Cài đặt interceptor test trên `TokenService` của ứng dụng kiểm thử.
 * Cho phép ánh xạ chính xác các token test sang `UserIdentity` (gồm `roles` và `permissions` tùy chỉnh),
 * đồng thời từ chối các token không hợp lệ (`invalid-token`).
 */
function ensureTokenServiceInstrumented(app: INestApplication): Map<string, UserIdentity> {
  let registry = tokenRegistryByApp.get(app);
  if (!registry) {
    registry = new Map<string, UserIdentity>();
    tokenRegistryByApp.set(app, registry);
  }

  if (!instrumentedApps.has(app)) {
    const tokenService = app.get(TokenService);

    jest.spyOn(tokenService, 'verify').mockImplementation(async (token: string) => {
      const matched = registry!.get(token);
      if (!matched) {
        return null;
      }
      return {
        sub: matched.id,
        roles: [...matched.roles],
      };
    });

    jest
      .spyOn(tokenService, 'validateUser')
      .mockImplementation(async (payload: TokenPayload) => {
        for (const identity of registry!.values()) {
          if (identity.id === payload.sub) {
            return identity;
          }
        }
        return null;
      });

    instrumentedApps.add(app);
  }

  return registry;
}

/**
 * Giả lập một người dùng đã xác thực (`actingAs`) với danh sách `roles` và `permissions` tùy chọn.
 * Trả về `token`, `user` và `headers: { authorization: 'Bearer <token>' }` để truyền vào `app.inject()`.
 */
export function actingAs(
  app: INestApplication,
  overrides?: Partial<UserIdentity>,
): ActingAsContext {
  const registry = ensureTokenServiceInstrumented(app);
  const user = userIdentityFactory.build(overrides);
  const token = `test-jwt-${user.id}-${registry.size + 1}`;
  registry.set(token, user);

  return {
    user,
    token,
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
}

export interface EndpointAuthMatrixOptions {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly payload?: unknown;
  /** Danh sách roles yêu cầu trên endpoint (tương ứng `@RequireRoles(...)`). */
  readonly requiredRoles?: readonly string[];
  /** Danh sách permissions yêu cầu trên endpoint (tương ứng `@RequirePermissions(...)`). */
  readonly requiredPermissions?: readonly string[];
  /** Mã HTTP kỳ vọng khi đủ quyền truy cập (mặc định `200`). */
  readonly expectedAllowedStatus?: number;
}

/**
 * Helper tự động kiểm tra ma trận phân quyền RBAC trên một HTTP Endpoint:
 * 1. Không có header Authorization -> `401 Unauthorized`
 * 2. Token sai định dạng hoặc không hợp lệ -> `401 Unauthorized`
 * 3. User thiếu Role yêu cầu (nếu có `requiredRoles`) -> `403 Forbidden` (`FORBIDDEN`)
 * 4. User thiếu Permission yêu cầu (nếu có `requiredPermissions`) -> `403 Forbidden` (`FORBIDDEN` + `missingPermissions`)
 * 5. User có đầy đủ Role & Permission -> trả về `expectedAllowedStatus` (mặc định `200`).
 */
export async function assertEndpointAuthMatrix(
  app: NestFastifyApplication,
  options: EndpointAuthMatrixOptions,
): Promise<void> {
  ensureTokenServiceInstrumented(app);

  // 1. Không gửi Authorization header -> 401
  const unauthenticatedRes = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
  });
  expect(unauthenticatedRes.statusCode).toBe(HTTP_STATUS_CODE.UNAUTHORIZED);

  // 2. Gửi Bearer token không hợp lệ -> 401
  const invalidTokenRes = await app.inject({
    method: options.method,
    url: options.url,
    headers: { authorization: 'Bearer invalid-or-expired-test-token' },
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
  });
  expect(invalidTokenRes.statusCode).toBe(HTTP_STATUS_CODE.UNAUTHORIZED);

  // 3. Nếu yêu cầu Role -> kiểm tra user không có role đó bị chặn 403
  const requiredRoles = options.requiredRoles ?? [];
  if (requiredRoles.length > 0) {
    const missingRoleAuth = actingAs(app, {
      roles: ['guest_without_required_role'],
      permissions: [...(options.requiredPermissions ?? [])],
    });
    const missingRoleRes = await app.inject({
      method: options.method,
      url: options.url,
      headers: missingRoleAuth.headers,
      ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    });
    expect(missingRoleRes.statusCode).toBe(HTTP_STATUS_CODE.FORBIDDEN);
    const body = missingRoleRes.json<ApiErrorResponse>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(HTTP_ERROR_CODE.FORBIDDEN);
  }

  // 4. Nếu yêu cầu Permission -> kiểm tra user thiếu permission bị chặn 403 kèm chi tiết missingPermissions
  const requiredPermissions = options.requiredPermissions ?? [];
  if (requiredPermissions.length > 0) {
    const missingPermAuth = actingAs(app, {
      roles: requiredRoles.length > 0 ? [...requiredRoles] : ['user'],
      permissions: [],
    });
    const missingPermRes = await app.inject({
      method: options.method,
      url: options.url,
      headers: missingPermAuth.headers,
      ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    });
    expect(missingPermRes.statusCode).toBe(HTTP_STATUS_CODE.FORBIDDEN);
    const body = missingPermRes.json<ApiErrorResponse>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(HTTP_ERROR_CODE.FORBIDDEN);
    expect(JSON.stringify(body.error.details ?? [])).toContain(requiredPermissions[0]!);
  }

  // 5. User có đầy đủ Roles & Permissions -> thành công
  const authorizedAuth = actingAs(app, {
    roles: requiredRoles.length > 0 ? [...requiredRoles] : ['user'],
    permissions: [...requiredPermissions],
  });
  const allowedRes = await app.inject({
    method: options.method,
    url: options.url,
    headers: authorizedAuth.headers,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
  });
  expect(allowedRes.statusCode).toBe(options.expectedAllowedStatus ?? HTTP_STATUS_CODE.OK);
}
