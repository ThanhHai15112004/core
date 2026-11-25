import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiDoc, ApiGroup, Public, RequireAnyPermission } from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  detailedHealthResponseSchema,
  healthCheckResponseSchema,
  livenessCheckResponseSchema,
  readinessCheckResponseSchema,
} from '../responses/health.response.js';
import { HEALTH_ROUTES } from '../routes/health.routes.js';
import { HealthService } from '../services/health.service.js';
import type {
  DetailedHealthCheckResult,
  HealthCheckResult,
  LivenessCheckResult,
  PublicHealthCheckResult,
  ReadinessCheckResult,
} from '../types/health.types.js';

@ApiGroup(
  'System Health',
  'Kiểm tra Liveness, Readiness, Database (có timeout), Redis & Queue (nghiêm trọng vs suy giảm), Storage, Email/SMS/Provider, Migration và phân quyền chi tiết cho quản trị viên',
)
@Controller(HEALTH_ROUTES.PREFIX)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Kiểm tra sức khỏe tổng quan — tự ẩn chi tiết nhạy cảm nếu người gọi không phải quản trị viên */
  @Public()
  @Get(HEALTH_ROUTES.CHECK)
  @ApiDoc({
    summary: 'Kiểm tra sức khỏe hệ thống (Healthcheck)',
    description:
      'Endpoint tổng hợp cho Load Balancer và Console. Khi bật `health.public.hide_details`, người dùng công khai chỉ nhận trạng thái tổng quát (`status`, `ready`, `live`, `uptime`); quản trị viên có JWT hợp lệ sẽ nhận đầy đủ `checks`.',
    response: healthCheckResponseSchema,
    responseExample: {
      status: 'ok',
      ready: true,
      live: true,
      uptime: 3600,
      timestamp: '2026-11-25T09:00:00.000Z',
      redacted: true,
    },
  })
  public async check(
    @CurrentUser() actor?: UserIdentity | null,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<HealthCheckResult | PublicHealthCheckResult> {
    const result = await this.healthService.getPublicOrAdminHealth(actor);
    if (result.status === 'down') {
      reply?.status?.(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  /** Liveness Check — chỉ kiểm tra process còn sống (không phụ thuộc DB/Redis ngoài) */
  @Public()
  @Get(HEALTH_ROUTES.LIVE)
  @ApiDoc({
    summary: 'Liveness Check (kiểm tra process còn sống)',
    description:
      'Dùng cho Kubernetes/Load Balancer livenessProbe. Kiểm tra tiến trình chưa shutdown, Event Loop và V8 Heap; trả 503 khi tiến trình không còn sống.',
    response: livenessCheckResponseSchema,
    responseExample: {
      status: 'ok',
      live: true,
      uptime: 3600,
      timestamp: '2026-11-25T09:00:00.000Z',
    },
  })
  public async liveness(
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<LivenessCheckResult> {
    const result = await this.healthService.liveness();
    if (!result.live) {
      reply?.status?.(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: result.status,
      live: result.live,
      uptime: result.uptime,
      timestamp: result.timestamp,
    };
  }

  /** Readiness Check — kiểm tra ứng dụng có sẵn sàng tiếp nhận request */
  @Public()
  @Get(HEALTH_ROUTES.READY)
  @ApiDoc({
    summary: 'Readiness Check (kiểm tra sẵn sàng nhận request)',
    description:
      'Dùng cho Kubernetes/Load Balancer readinessProbe. Kiểm tra runtime, Database (có timeout), Redis, Storage và tùy chọn Migration. Trả HTTP 503 khi chưa sẵn sàng; ẩn chi tiết nhạy cảm khỏi người gọi công khai.',
    response: readinessCheckResponseSchema,
    responseExample: {
      status: 'ok',
      ready: true,
      uptime: 3600,
      timestamp: '2026-11-25T09:00:00.000Z',
      redacted: true,
    },
  })
  public async readiness(
    @CurrentUser() actor?: UserIdentity | null,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<ReadinessCheckResult> {
    const result = await this.healthService.getPublicOrAdminReadiness(actor);
    if (!result.ready) {
      reply?.status?.(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  /** Báo cáo chẩn đoán Health Check đầy đủ — chỉ quản trị viên được phép xem */
  @Get(HEALTH_ROUTES.DETAILS)
  @RequireAnyPermission('health.read', 'system.ops.read', 'settings.read')
  @ApiDoc({
    summary: 'Chi tiết Health Check & Dependencies (Admin only)',
    description:
      'Trả về thông số đầy đủ của Process/Event Loop, Database timeout, Redis & Queue (critical vs degraded), Storage, Email/SMS/Provider, cảnh báo phiên bản Migration và bộ cấu hình Health Settings đang áp dụng.',
    response: detailedHealthResponseSchema,
  })
  public async details(): Promise<DetailedHealthCheckResult> {
    return this.healthService.getDetailedHealth();
  }
}
