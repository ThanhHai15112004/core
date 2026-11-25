import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '@packages/http/index.js';
import type { PackageActionResult } from '@packages/kernel/index.js';
import { SecretRegistryService, type SecretItemMeta } from '@packages/security/index.js';
import { ConfigInspectorService, type ConfigItemDto } from '@packages/config/index.js';
import {
  PackageRegistryService,
  type PackageSummaryDto,
} from '../services/package-registry.service.js';
import { SystemInfoService } from '../services/system-info.service.js';
import { SystemOverviewService } from '../services/system-overview.service.js';
import type {
  InstalledModulesResponseDto,
  SystemInfoResponseDto,
  SystemOverviewResponseDto,
} from '../responses/overview.response.js';
import { SYSTEM_OPS_ROUTES } from '../routes/system-ops.routes.js';

@Controller(SYSTEM_OPS_ROUTES.PREFIX)
export class SystemOpsController {
  constructor(
    private readonly registryService: PackageRegistryService,
    private readonly overviewService: SystemOverviewService,
    private readonly systemInfoService: SystemInfoService,
    private readonly secretRegistry: SecretRegistryService,
    private readonly configInspector: ConfigInspectorService,
  ) {}

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.OVERVIEW)
  public async getOverview(): Promise<SystemOverviewResponseDto> {
    return this.overviewService.getOverview();
  }

  /** Lấy thông tin phiên bản Core/Project, deployment (commit, image, build time) và tóm tắt module */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.SYSTEM_INFO)
  public getSystemInfo(): SystemInfoResponseDto {
    return this.systemInfoService.getSystemInfo();
  }

  /** Lấy danh sách các module đang được cài đặt kèm tên, phiên bản và trạng thái */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.MODULES)
  public getModules(): InstalledModulesResponseDto {
    return this.systemInfoService.getInstalledModules();
  }

  /** Lấy danh sách tóm tắt tất cả các packages hạ tầng đã đăng ký */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.PACKAGES)
  public async getPackages(): Promise<PackageSummaryDto[]> {
    return this.registryService.getAllSummaries();
  }

  /** Thực thi hành động vận hành tương ứng trên package */
  @Public()
  @Post(SYSTEM_OPS_ROUTES.EXECUTE_ACTION)
  @HttpCode(HttpStatus.OK)
  public async executeAction(
    @Param('packageId') packageId: string,
    @Param('actionId') actionId: string,
    @Body() body?: unknown,
  ): Promise<PackageActionResult> {
    return this.registryService.executeAction(packageId, actionId, body);
  }

  /** Lấy danh sách metadata của các secret đã đăng ký trong hệ thống */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.SECRETS)
  public async getSecrets(): Promise<SecretItemMeta[]> {
    return this.secretRegistry.listSecrets();
  }

  /** Kiểm tra và lấy danh sách cấu hình hệ thống từ ConfigInspector */
  @Public()
  @Get(SYSTEM_OPS_ROUTES.CONFIGURATION)
  public async getConfiguration(): Promise<ConfigItemDto[]> {
    return this.configInspector.inspectAll();
  }
}
