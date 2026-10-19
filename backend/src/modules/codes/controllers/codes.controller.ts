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
  type CreateCodeValueRequest,
  type ListCodeTypesQuery,
  type ListCodeValuesQuery,
  type UpdateCodeValueRequest,
  bootstrapCodesQuerySchema,
  createCodeValueSchema,
  listCodeTypesQuerySchema,
  listCodeValuesQuerySchema,
  typeCodeParamSchema,
  updateCodeValueSchema,
} from '../requests/codes.requests.js';
import {
  type BootstrapCodesResponse,
  type CodeTypeSummaryResponse,
  type ResolvedCodeValueResponse,
  type SyncCodesResultResponse,
  bootstrapCodesResponseSchema,
  codeTypeSummaryResponseSchema,
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

  /** Thêm mới một giá trị danh mục động vào nhóm `typeCode` */
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

  /** Cập nhật nhãn đa ngôn ngữ, từ đồng nghĩa, màu sắc hoặc trạng thái của một giá trị danh mục */
  @Patch(CODES_ROUTES.BY_TYPE_VALUE_NUMERIC)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Cập nhật nhãn hiển thị đa ngôn ngữ, màu sắc hoặc trạng thái giá trị danh mục',
    response: resolvedCodeValueResponseSchema,
  })
  public async updateCodeValue(
    @ValidatedParams(typeCodeParamSchema, 'typeCode') typeCode: string,
    @ValidatedParams(positiveIntParamSchema, 'numericCode') numericCode: number,
    @ValidatedBody(updateCodeValueSchema) body: UpdateCodeValueRequest,
  ): Promise<ResolvedCodeValueResponse> {
    return this.codesService.updateCodeValue(typeCode, numericCode, body);
  }

  /** Xóa mềm giá trị danh mục tùy chỉnh (Chặn xóa nếu `isSystem = true`) */
  @Delete(CODES_ROUTES.BY_TYPE_VALUE_NUMERIC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('codes.manage')
  @ApiDoc({
    summary: 'Xóa mềm giá trị danh mục động (chặn xóa đối với giá trị gốc isSystem = true)',
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
