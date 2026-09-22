import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '@packages/http/index.js';
import {
  PackageRegistryService,
  type PackageSummaryDto,
} from '../services/package-registry.service.js';
import { SystemOverviewService } from '../services/system-overview.service.js';
import type { SystemOverviewResponseDto } from '../responses/overview.response.js';
import { SYSTEM_OPS_ROUTES } from '../constants/system-ops.constant.js';

@Controller(SYSTEM_OPS_ROUTES.PREFIX)
export class SystemOpsController {
  constructor(
    private readonly registryService: PackageRegistryService,
    private readonly overviewService: SystemOverviewService,
  ) {}

  @Public()
  @Get(SYSTEM_OPS_ROUTES.OVERVIEW)
  public async getOverview(): Promise<SystemOverviewResponseDto> {
    return this.overviewService.getOverview();
  }

  @Public()
  @Get(SYSTEM_OPS_ROUTES.PACKAGES)
  public async getPackages(): Promise<PackageSummaryDto[]> {
    return this.registryService.getAllSummaries();
  }

  @Public()
  @Get(SYSTEM_OPS_ROUTES.PACKAGE_DETAIL)
  public async getPackage(@Param('packageId') packageId: string): Promise<PackageSummaryDto> {
    const pkg = this.registryService.getPackage(packageId);
    if (!pkg) {
      throw new NotFoundException(`Package [${packageId}] không tồn tại trong hệ thống.`);
    }

    const statusReport = await pkg.getStatus();
    const actions = pkg.getActions ? pkg.getActions() : [];

    return {
      packageId: pkg.packageId,
      displayName: pkg.displayName,
      category: pkg.category,
      icon: pkg.icon,
      statusReport,
      actions,
    };
  }

  @Public()
  @Post(SYSTEM_OPS_ROUTES.EXECUTE_ACTION)
  @HttpCode(HttpStatus.OK)
  public async executeAction(
    @Param('packageId') packageId: string,
    @Param('actionId') actionId: string,
    @Body() body?: unknown,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    const result = await this.registryService.executeAction(packageId, actionId, body);
    return result;
  }
}
