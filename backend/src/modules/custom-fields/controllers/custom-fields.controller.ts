import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { parseOrThrow, RequirePermissions } from '@packages/http/index.js';
import type { CustomFieldActorContext } from '@packages/kernel/index.js';
import {
  AuthGuard,
  CurrentUser,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  CreateCustomFieldDefinitionRequestSchema,
  FilterRecordsByCustomFieldsRequestSchema,
  ListCustomFieldDefinitionsQuerySchema,
  ListCustomFieldHistoriesQuerySchema,
  SaveCustomFieldValuesRequestSchema,
  UpdateCustomFieldDefinitionRequestSchema,
  UpdateCustomFieldOptionsRequestSchema,
} from '../requests/custom-fields.requests.js';
import { CustomFieldResponseMapper } from '../responses/custom-fields.response.js';
import { CUSTOM_FIELDS_ROUTES } from '../routes/custom-fields.routes.js';
import { CustomFieldsService } from '../services/custom-fields.service.js';

function toActorContext(user?: UserIdentity): CustomFieldActorContext {
  return {
    id: user?.id ? Number(user.id) : null,
    roles: user?.roles ?? [],
    permissions: user?.permissions ?? [],
    bypassPermissionCheck: Boolean(
      user?.roles?.some((r: string) => r.toLowerCase() === 'super_admin') ||
        user?.permissions?.includes('*'),
    ),
  };
}

@Controller(CUSTOM_FIELDS_ROUTES.ROOT)
@UseGuards(AuthGuard)
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  /** 9.8.1: Danh sách các loại đối tượng được đăng ký mở rộng từ module.manifest.json */
  @Get(CUSTOM_FIELDS_ROUTES.ENTITIES)
  @RequirePermissions('custom-fields.read')
  public listExtensibleEntities() {
    return this.customFieldsService.listRegisteredEntitiesWithSummary();
  }

  /** 9.8.2: Danh sách cấu hình các trường tùy chỉnh */
  @Get(CUSTOM_FIELDS_ROUTES.DEFINITIONS)
  @RequirePermissions('custom-fields.read')
  public async listDefinitions(@Query() rawQuery: Record<string, unknown>) {
    const query = parseOrThrow(ListCustomFieldDefinitionsQuerySchema, rawQuery);
    return this.customFieldsService.listDefinitionsPaginated(query);
  }

  /** 9.8.2: Chi tiết cấu hình trường tùy chỉnh */
  @Get(CUSTOM_FIELDS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('custom-fields.read')
  public async getDefinitionById(@Param('id') id: string) {
    return this.customFieldsService.getDefinitionById(Number(id));
  }

  /** 9.8.2, 9.8.3, 9.8.4, 9.8.5, 9.8.6, 9.8.7, 9.8.8: Tạo mới trường tùy chỉnh */
  @Post(CUSTOM_FIELDS_ROUTES.DEFINITIONS)
  @RequirePermissions('custom-fields.manage')
  public async createDefinition(
    @Body() rawBody: unknown,
    @CurrentUser() user?: UserIdentity,
  ) {
    const body = parseOrThrow(CreateCustomFieldDefinitionRequestSchema, rawBody);
    return this.customFieldsService.createDefinition(
      body,
      user?.id ? Number(user.id) : null,
    );
  }

  /** 9.8.3, 9.8.4, 9.8.6, 9.8.7, 9.8.8: Cập nhật cấu hình trường (Chặn đổi kiểu dữ liệu tùy tiện) */
  @Patch(CUSTOM_FIELDS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('custom-fields.manage')
  public async updateDefinition(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @CurrentUser() user?: UserIdentity,
  ) {
    const body = parseOrThrow(UpdateCustomFieldDefinitionRequestSchema, rawBody);
    return this.customFieldsService.updateDefinition(
      Number(id),
      body,
      user?.id ? Number(user.id) : null,
    );
  }

  /** 9.8.5: Cập nhật danh sách lựa chọn (SELECT) có thứ tự và trạng thái */
  @Put(CUSTOM_FIELDS_ROUTES.DEFINITION_OPTIONS)
  @RequirePermissions('custom-fields.manage')
  public async updateDefinitionOptions(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @CurrentUser() user?: UserIdentity,
  ) {
    const body = parseOrThrow(UpdateCustomFieldOptionsRequestSchema, rawBody);
    const updated = await this.customFieldsService.updateFieldOptions(
      Number(id),
      body.options,
      user?.id ? Number(user.id) : null,
      body.reason,
    );
    return CustomFieldResponseMapper.toDefinitionResponse(updated);
  }

  /** 9.8.8: Lịch sử thay đổi của một trường cụ thể */
  @Get(CUSTOM_FIELDS_ROUTES.DEFINITION_HISTORIES)
  @RequirePermissions('custom-fields.read')
  public async listDefinitionHistories(
    @Param('id') id: string,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const query = parseOrThrow(ListCustomFieldHistoriesQuerySchema, {
      ...rawQuery,
      fieldId: Number(id),
    });
    return this.customFieldsService.listHistoriesPaginated(query);
  }

  /** 9.8.8: Toàn bộ lịch sử thay đổi cấu hình trường tùy chỉnh */
  @Get(CUSTOM_FIELDS_ROUTES.HISTORIES)
  @RequirePermissions('custom-fields.read')
  public async listAllHistories(@Query() rawQuery: Record<string, unknown>) {
    const query = parseOrThrow(ListCustomFieldHistoriesQuerySchema, rawQuery);
    return this.customFieldsService.listHistoriesPaginated(query);
  }

  /** 9.8.4 & 9.8.6: Đọc giá trị trường tùy chỉnh của một bản ghi theo quyền xem từng trường */
  @Get(CUSTOM_FIELDS_ROUTES.VALUES_BY_RECORD)
  @RequirePermissions('custom-fields.values.read')
  public async getRecordValues(
    @Param('entityCode') entityCode: string,
    @Param('recordId') recordId: string,
    @CurrentUser() user?: UserIdentity,
  ) {
    return this.customFieldsService.getRecordValuesResponse(
      entityCode,
      recordId,
      toActorContext(user),
    );
  }

  /** 9.8.3 & 9.8.4: Kiểm tra bắt buộc, validation, quyền sửa từng trường và lưu giá trị */
  @Put(CUSTOM_FIELDS_ROUTES.VALUES_BY_RECORD)
  @RequirePermissions('custom-fields.values.write')
  public async saveRecordValues(
    @Param('entityCode') entityCode: string,
    @Param('recordId') recordId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user?: UserIdentity,
  ) {
    const body = parseOrThrow(SaveCustomFieldValuesRequestSchema, rawBody);
    const actor = toActorContext(user);
    const saved = await this.customFieldsService.validateAndSaveRecordValues({
      entityCode,
      recordId,
      values: body.values,
      mode: body.mode,
      actor,
    });
    const visibleValues = await this.customFieldsService.getRecordValuesForApi(
      entityCode,
      recordId,
      { viewMode: 'detail', actor },
    );
    return {
      entityCode: entityCode.trim().toLowerCase(),
      recordId: String(recordId).trim(),
      savedCount: saved.length,
      values: visibleValues,
    };
  }

  /** 9.8.7: Lọc bản ghi theo trường tùy chỉnh (Chỉ cho phép trường được đánh index) */
  @Post(CUSTOM_FIELDS_ROUTES.VALUES_FILTER)
  @RequirePermissions('custom-fields.values.read')
  public async filterRecords(
    @Body() rawBody: unknown,
    @CurrentUser() user?: UserIdentity,
  ) {
    const body = parseOrThrow(FilterRecordsByCustomFieldsRequestSchema, rawBody);
    return this.customFieldsService.filterRecordsEndpoint(body, toActorContext(user));
  }
}
