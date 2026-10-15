import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { Public, RequirePermissions, RequireRoles } from '@packages/http/index.js';
import {
  AuthGuard,
  CurrentUser,
  type UserIdentity,
} from '@packages/security/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { actingAs, assertEndpointAuthMatrix } from '../../../concerns/permission.concern.js';

@Controller('test-rbac')
@UseGuards(AuthGuard)
class RbacTestController {
  @Public()
  @Get('public')
  public getPublic(): { message: string } {
    return { message: 'public-ok' };
  }

  @Get('profile')
  public getProfile(@CurrentUser() user: UserIdentity): UserIdentity {
    return user;
  }

  @RequireRoles('admin', 'super_admin')
  @Get('admin-only')
  public getAdminArea(): { area: string } {
    return { area: 'admin-dashboard' };
  }

  @RequireRoles('operator', 'admin')
  @RequirePermissions('ops.jobs.retry', 'ops.jobs.read')
  @Post('ops-action')
  public runProtectedAction(@CurrentUser('id') userId: number): { executedBy: number } {
    return { executedBy: userId };
  }
}

describe('Feature E2E: AuthGuard & Permission Test Helper (Task 2.7.3 & 2.7.6)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp({
      useGlobalPrefix: true,
      extraControllers: [RbacTestController],
    });
  });

  afterAll(async () => {
    await context.close();
  });

  it('cho phép truy cập route gắn @Public() không cần Bearer token', async () => {
    const res = await context.injectJson<{ message: string }>({
      method: 'GET',
      url: '/api/v1/test-rbac/public',
    });

    expect(res.status).toBe(HTTP_STATUS_CODE.OK);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ message: 'public-ok' });
  });

  it('actingAs() gắn đúng thông tin UserIdentity cho @CurrentUser() trên route cần đăng nhập', async () => {
    const session = actingAs(context.app, {
      id: 999,
      email: 'qa@core.local',
      roles: ['editor'],
      permissions: ['articles.write'],
    });

    const res = await context.injectJson<UserIdentity>({
      method: 'GET',
      url: '/api/v1/test-rbac/profile',
      headers: session.headers,
    });

    expect(res.status).toBe(HTTP_STATUS_CODE.OK);
    expect(res.body.data).toEqual({
      id: 999,
      email: 'qa@core.local',
      roles: ['editor'],
      permissions: ['articles.write'],
    });
  });

  it('assertEndpointAuthMatrix kiểm tra tự động route chỉ yêu cầu Role (@RequireRoles)', async () => {
    await assertEndpointAuthMatrix(context.app, {
      method: 'GET',
      url: '/api/v1/test-rbac/admin-only',
      requiredRoles: ['admin'],
      expectedAllowedStatus: HTTP_STATUS_CODE.OK,
    });
  });

  it('assertEndpointAuthMatrix kiểm tra tự động route yêu cầu kết hợp cả Role và Permissions (@RequireRoles + @RequirePermissions)', async () => {
    await assertEndpointAuthMatrix(context.app, {
      method: 'POST',
      url: '/api/v1/test-rbac/ops-action',
      requiredRoles: ['operator'],
      requiredPermissions: ['ops.jobs.retry', 'ops.jobs.read'],
      expectedAllowedStatus: HTTP_STATUS_CODE.CREATED,
    });
  });
});
