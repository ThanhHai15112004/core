import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  Public,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CODES_ROUTES } from '../routes/codes.routes.js';
import { CodesService } from '../services/codes.service.js';
import {
  type BootstrapCodesQuery,
  type BulkImportCodesRequest,
  type CreateCodeTypeRequest,
  type CreateCodeValueRequest,
  type ExportCodesQuery,
  type ExportCodesTemplateQuery,
  type ListCodeTypesQuery,
  type ListCodeValuesQuery,
  type ReorderCodeValuesRequest,
  type UpdateCodeTypeRequest,
  type UpdateCodeValueRequest,
  bootstrapCodesQuerySchema,
  bulkImportCodesSchema,
  createCodeTypeSchema,
  createCodeValueSchema,
  exportCodesQuerySchema,
  exportCodesTemplateQuerySchema,
  listCodeTypesQuerySchema,
  listCodeValuesQuerySchema,
  reorderCodeValuesSchema,
  typeCodeParamSchema,
  updateCodeTypeSchema,
  updateCodeValueSchema,
} from '../requests/codes.requests.js';
import {
  type BootstrapCodesResponse,
  type BulkImportCodesResultResponse,
  type CodeTypeSummaryResponse,
  type CodeValueUsageResponse,
  type ExportCodesResponse,
  type ResolvedCodeValueResponse,
  type SyncCodesResultResponse,
  bootstrapCodesResponseSchema,
  bulkImportCodesResultResponseSchema,
  codeTypeSummaryResponseSchema,
  codeValueUsageResponseSchema,
  exportCodesResponseSchema,
  resolvedCodeValueResponseSchema,
  syncCodesResultResponseSchema,
} from '../responses/codes.response.js';

@ApiGroup('Codes & Lookup Dictionary', 'Quản lý danh mục động (Lookup Table) và mã chuẩn Hybrid')
@Controller(CODES_ROUTES.PREFIX)
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  /** Tải toàn bộ từ điển danh mục động (Bootstrap Dictionary) cho Web/Mobile App trong 1 request */
  @Public()
  @Get(CODES_ROUTES.BOOTSTRAP)
  @ApiDoc({
    summary: 'Tải từ điển danh mục động (Bootstrap Dictionary) kèm nhãn đa ngôn ngữ',
    response: bootstrapCodesResponseSchema,
  })
  public async getBootstrapDictionary(
    @ValidatedQuery(bootstrapCodesQuerySchema) query: BootstrapCodesQuery,
  ): Promise<BootstrapCodesResponse> {
    return this.codesService.getBootstrapDictionary(query);
  }

  /** Liệt kê danh sách các nhóm danh mục (`code_types`) theo module */
  @Get()
  @RequirePermissions('codes.read')
  @ApiDoc({
    summary: 'Danh sách các nhóm danh mục (code_types) trên toàn hệ thống',
    response: z.array(codeTypeSummaryResponseSchema),
  })
  public async listCodeTypes(
    @ValidatedQuery(listCodeTypesQuerySchema) query: ListCodeTypesQuery,
  ): Promise<CodeTypeSummaryResponse[]> {
    const items = await this.codesService.listCodeTypes(query);
    return items.map((item) => ({
      ...item,
      values: item.values ? [...item.values] : undefined,
    }));
  }

  /** Đồng bộ idempotent các khai báo `codeTypes` từ `module.manifest.json` vào Database & L1 Cache */
  @Post(CODES_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Đồng bộ danh mục chuẩn từ module.manifest.json vào code_types & code_values',
    response: syncCodesResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncCodesResultResponse> {
    const result = await this.codesService.syncManifests();
    return {
      ...result,
      syncedModules: [...result.syncedModules],
    };
  }

  /** Xuất danh mục dùng chung ra Excel (.xlsx) hoặc CSV (.csv) phục vụ quản trị (Mục 5.4.7) */
  @Get(CODES_ROUTES.EXPORT)
  @RequirePermissions('codes.read')
  @ApiDoc({
    summary: 'Xuất danh mục dùng chung (Master Data) ra định dạng Excel (.xlsx) hoặc CSV (.csv)',
    response: exportCodesResponseSchema,
  })
  public async exportCodes(
    @ValidatedQuery(exportCodesQuerySchema) query: ExportCodesQuery,
  ): Promise<ExportCodesResponse> {
    return this.codesService.exportCodes(query);
  }

  /** Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) phục vụ Import danh mục (Mục 5.4.6) */
  @Get(CODES_ROUTES.IMPORT_TEMPLATE)
  @RequirePermissions('codes.read')
  @ApiDoc({
    summary: 'Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) để nhập danh mục hàng loạt',
    response: exportCodesResponseSchema,
  })
  public async exportImportTemplate(
    @ValidatedQuery(exportCodesTemplateQuerySchema) query: ExportCodesTemplateQuery,
  ): Promise<ExportCodesResponse> {
    return this.codesService.exportImportTemplate(query.format === 'csv' ? 'csv' : 'xlsx');
  }

  /** Nhập danh mục hàng loạt từ Excel (.xlsx), CSV hoặc JSON có kiểm tra trùng mã (Mục 5.4.6) */
  @Post(CODES_ROUTES.IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary:
      'Nhập danh mục dùng chung hàng loạt từ Excel (.xlsx), CSV hoặc JSON có kiểm tra trùng mã',
    response: bulkImportCodesResultResponseSchema,
  })
  public async bulkImportCodes(
    @ValidatedBody(bulkImportCodesSchema) body: BulkImportCodesRequest,
  ): Promise<BulkImportCodesResultResponse> {
    return this.codesService.bulkImportCodeValues(body);
  }

  /** Tạo mới một nhóm danh mục dùng chung (`code_types` — Mục 5.4.1) */
  @Post()
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Tạo mới nhóm danh mục dùng chung (code_types: loại hồ sơ, trạng thái, khu vực...)',
    status: HTTP_STATUS_CODE.CREATED,
    response: codeTypeSummaryResponseSchema,
  })
  public async createCodeType(
    @ValidatedBody(createCodeTypeSchema) body: CreateCodeTypeRequest,
  ): Promise<CodeTypeSummaryResponse> {
    const item = await this.codesService.createCodeType(body);
    return {
      ...item,
      values: item.values ? [...item.values] : undefined,
    };
  }

  /** Cập nhật thông tin nhóm danh mục (`code_types` — Mục 5.4.1) */
  @Patch(CODES_ROUTES.BY_TYPE)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Cập nhật tên hiển thị, mô tả hoặc trạng thái của một nhóm danh mục (code_types)',
    response: codeTypeSummaryResponseSchema,
  })
  public async updateCodeType(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedBody(updateCodeTypeSchema) body: UpdateCodeTypeRequest,
  ): Promise<CodeTypeSummaryResponse> {
    const item = await this.codesService.updateCodeType(typeCode, body);
    return {
      ...item,
      values: item.values ? [...item.values] : undefined,
    };
  }

  /** Xem danh sách các giá trị (`code_values`) của một nhóm danh mục `typeCode` */
  @Get(CODES_ROUTES.BY_TYPE_VALUES)
  @RequirePermissions('codes.read')
  @ApiDoc({
    summary: 'Danh sách giá trị danh mục (code_values) theo typeCode',
    response: z.array(resolvedCodeValueResponseSchema),
  })
  public async listCodeValues(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedQuery(listCodeValuesQuerySchema) query: ListCodeValuesQuery,
  ): Promise<ResolvedCodeValueResponse[]> {
    return this.codesService.listCodeValues(typeCode, query);
  }

  /** Thêm mới một giá trị danh mục động vào nhóm `typeCode` (Mục 5.4.2) */
  @Post(CODES_ROUTES.BY_TYPE_VALUES)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Thêm mới giá trị danh mục động (code_values) cho nhóm typeCode',
    status: HTTP_STATUS_CODE.CREATED,
    response: resolvedCodeValueResponseSchema,
  })
  public async createCodeValue(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedBody(createCodeValueSchema) body: CreateCodeValueRequest,
  ): Promise<ResolvedCodeValueResponse> {
    return this.codesService.createCodeValue(typeCode, body);
  }

  /** Sắp xếp lại thứ tự hiển thị (`sortOrder`) cho các mục danh mục trong nhóm `typeCode` (Mục 5.4.3) */
  @Patch(CODES_ROUTES.BY_TYPE_VALUES_REORDER)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Sắp xếp lại thứ tự hiển thị (sortOrder) của các mục danh mục trong nhóm typeCode',
    response: z.array(resolvedCodeValueResponseSchema),
  })
  public async reorderCodeValues(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedBody(reorderCodeValuesSchema) body: ReorderCodeValuesRequest,
  ): Promise<ResolvedCodeValueResponse[]> {
    return this.codesService.reorderCodeValues(typeCode, body);
  }

  /** Nhập danh mục hàng loạt trực tiếp vào nhóm `typeCode` (Mục 5.4.6) */
  @Post(CODES_ROUTES.BY_TYPE_VALUES_IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Nhập danh mục hàng loạt vào nhóm typeCode kèm kiểm tra trùng mã',
    response: bulkImportCodesResultResponseSchema,
  })
  public async bulkImportCodeValuesByType(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedBody(bulkImportCodesSchema) body: BulkImportCodesRequest,
  ): Promise<BulkImportCodesResultResponse> {
    return this.codesService.bulkImportCodeValues(body, typeCode);
  }

  /** Kiểm tra xem mục danh mục có đang được sử dụng bởi dữ liệu liên quan hay không (Mục 5.4.8) */
  @Get(CODES_ROUTES.BY_TYPE_VALUE_USAGE)
  @RequirePermissions('codes.read')
  @ApiDoc({
    summary:
      'Kiểm tra mức độ sử dụng (inUse, totalUsageCount) của một mục danh mục trước khi sửa mã hoặc xóa',
    response: codeValueUsageResponseSchema,
  })
  public async checkCodeValueUsage(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedParams(positiveIntParamSchema, 'numericCode') numericCode: number,
  ): Promise<CodeValueUsageResponse> {
    const usage = await this.codesService.checkCodeValueUsage(typeCode, numericCode);
    return {
      ...usage,
      details: [...usage.details],
    };
  }

  /** Cập nhật nhãn đa ngôn ngữ, từ đồng nghĩa, màu sắc, thứ tự hoặc trạng thái của một giá trị danh mục (Mục 5.4.3 & 5.4.4) */
  @Patch(CODES_ROUTES.BY_TYPE_VALUE_NUMERIC)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary:
      'Cập nhật nhãn hiển thị đa ngôn ngữ, màu sắc, trạng thái hoặc đổi mã (nếu chưa sử dụng)',
    response: resolvedCodeValueResponseSchema,
  })
  public async updateCodeValue(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedParams(positiveIntParamSchema, 'numericCode') numericCode: number,
    @ValidatedBody(updateCodeValueSchema) body: UpdateCodeValueRequest,
  ): Promise<ResolvedCodeValueResponse> {
    return this.codesService.updateCodeValue(typeCode, numericCode, body);
  }

  /** Xóa mềm giá trị danh mục tùy chỉnh (Chặn xóa nếu `isSystem = true` hoặc đang được sử dụng — Mục 5.4.8) */
  @Delete(CODES_ROUTES.BY_TYPE_VALUE_NUMERIC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Xóa mềm giá trị danh mục động (chặn xóa nếu là mã hệ thống hoặc đang được sử dụng)',
    response: z.object({
      deleted: z.literal(true),
      typeCode: z.string(),
      numericCode: z.number().int(),
      code: z.string(),
    }),
  })
  public async removeCodeValue(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedParams(positiveIntParamSchema, 'numericCode') numericCode: number,
  ): Promise<{ deleted: true; typeCode: string; numericCode: number; code: string }> {
    return this.codesService.removeCodeValue(typeCode, numericCode);
  }
}
