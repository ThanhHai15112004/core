import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import type { PaginatedResult } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { ORGANIZATION_MEMBERS_ROUTES } from '../routes/organization-members.routes.js';
import { OrganizationMembersService } from '../services/organization-members.service.js';
import {
  type AssignOrganizationMembershipsRequest,
  type ListMemberSubordinatesQuery,
  type ListOrganizationMembersQuery,
  type TransferOrganizationMemberRequest,
  type UpdateOrganizationMemberManagersRequest,
  assignOrganizationMembershipsSchema,
  listMemberSubordinatesQuerySchema,
  listOrganizationMembersQuerySchema,
  transferOrganizationMemberSchema,
  updateOrganizationMemberManagersSchema,
} from '../requests/organization-members.requests.js';
import {
  type OrganizationMemberDetailResponse,
  type OrganizationMemberResponse,
  type UserOrganizationHistoryItemResponse,
  type UserSubordinatesOverviewResponse,
  organizationMemberDetailResponseSchema,
  organizationMemberResponseSchema,
  organizationMemberSubordinatesResponseSchema,
  userOrganizationHistoryItemSchema,
} from '../responses/organization-members.response.js';

@ApiGroup(
  'Organization Members',
  'Quản lý thành viên đơn vị, chức vụ, người quản lý trực tiếp/tạm thời, điều chuyển và cấp dưới (Mục 9.2)',
)
@Controller(ORGANIZATION_MEMBERS_ROUTES.PREFIX)
export class OrganizationMembersController {
  constructor(private readonly organizationMembersService: OrganizationMembersService) {}

  @Get()
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary: 'Danh sách thành viên theo đơn vị tổ chức, chức vụ và người quản lý (Mục 9.2)',
    response: organizationMemberResponseSchema,
    pagination: 'offset',
  })
  public async listMembers(
    @ValidatedQuery(listOrganizationMembersQuerySchema) query: ListOrganizationMembersQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<OrganizationMemberResponse>> {
    return this.organizationMembersService.listMembersPaginated(query, actor);
  }

  @Get(ORGANIZATION_MEMBERS_ROUTES.BY_USER_ID)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary:
      'Xem chi tiết hồ sơ thành viên đơn vị, lịch sử điều chuyển và tổng quan cấp dưới (Mục 9.2)',
    response: organizationMemberDetailResponseSchema,
  })
  public async getMemberDetail(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OrganizationMemberDetailResponse> {
    return this.organizationMembersService.getMemberDetail(userId, actor);
  }

  @Put(ORGANIZATION_MEMBERS_ROUTES.MEMBERSHIPS)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary:
      'Gán người dùng vào một hoặc nhiều đơn vị (đơn vị chính/phụ, chức vụ, thời hạn bắt đầu/kết thúc — Mục 9.2.1, 9.2.2, 9.2.3)',
    response: organizationMemberResponseSchema,
  })
  public async assignMemberships(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(assignOrganizationMembershipsSchema)
    body: AssignOrganizationMembershipsRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OrganizationMemberResponse> {
    return this.organizationMembersService.assignMemberships(userId, body, actor?.id, actor);
  }

  @Post(ORGANIZATION_MEMBERS_ROUTES.TRANSFER)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary:
      'Điều chuyển thành viên từ đơn vị hiện tại sang đơn vị khác và lưu lịch sử membership (Mục 9.2.6)',
    response: organizationMemberResponseSchema,
  })
  public async transferMember(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(transferOrganizationMemberSchema) body: TransferOrganizationMemberRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OrganizationMemberResponse> {
    return this.organizationMembersService.transferMemberUnit(userId, body, actor?.id, actor);
  }

  @Patch(ORGANIZATION_MEMBERS_ROUTES.MANAGERS)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary:
      'Thiết lập người quản lý trực tiếp (có thể khác cây tổ chức) và người quản lý tạm thời có thời hạn (Mục 9.2.4, 9.2.5)',
    response: organizationMemberResponseSchema,
  })
  public async updateManagers(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(updateOrganizationMemberManagersSchema)
    body: UpdateOrganizationMemberManagersRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OrganizationMemberResponse> {
    return this.organizationMembersService.updateMemberManagers(userId, body, actor?.id, actor);
  }

  @Get(ORGANIZATION_MEMBERS_ROUTES.HISTORY)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary:
      'Xem lịch sử tham gia, cập nhật, điều chuyển và kết thúc đơn vị của thành viên (Mục 9.2.6)',
    response: z.array(userOrganizationHistoryItemSchema),
  })
  public async getMemberHistory(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    return this.organizationMembersService.getMemberHistory(userId, actor);
  }

  @Get(ORGANIZATION_MEMBERS_ROUTES.SUBORDINATES)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary:
      'Tra cứu danh sách cấp dưới (trực tiếp, tạm thời, gián tiếp) và chuỗi phê duyệt phục vụ Data Scope & Approval (Mục 9.2.7)',
    response: organizationMemberSubordinatesResponseSchema,
  })
  public async getMemberSubordinates(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedQuery(listMemberSubordinatesQuerySchema) query: ListMemberSubordinatesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    return this.organizationMembersService.getSubordinatesOverview(userId, query, actor);
  }
}
