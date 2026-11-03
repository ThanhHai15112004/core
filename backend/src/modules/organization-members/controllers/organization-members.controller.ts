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
import type {
  UserOrganizationHistoryItemResponse,
  UserResponse,
  UserSubordinatesOverviewResponse,
} from '@modules/users/index.js';
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
  organizationMemberDetailResponseSchema,
  organizationMemberResponseSchema,
  organizationMemberSubordinatesResponseSchema,
  userOrganizationHistoryItemSchema,
} from '../responses/organization-members.response.js';

@ApiGroup(
  'Organization Members, Positions & Managers',
  'Quản lý thành viên đơn vị, chức vụ, người quản lý trực tiếp/tạm thời và tra cứu cấp dưới (Mục 9.2)',
)
@Controller(ORGANIZATION_MEMBERS_ROUTES.PREFIX)
export class OrganizationMembersController {
  constructor(private readonly organizationMembersService: OrganizationMembersService) {}

  /** Danh sách thành viên kèm đơn vị tham gia, chức vụ và người quản lý (Mục 9.2) */
  @Get()
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary: 'Lọc danh sách thành viên theo đơn vị, người quản lý kèm chức vụ và lịch sử tham gia',
    response: organizationMemberResponseSchema,
    pagination: 'offset',
  })
  public async listMembers(
    @ValidatedQuery(listOrganizationMembersQuerySchema) query: ListOrganizationMembersQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.organizationMembersService.listMembersPaginated(query, actor);
  }

  /** Xem chi tiết thành viên đơn vị, lịch sử điều chuyển và chuỗi cấp dưới/phê duyệt (Mục 9.2) */
  @Get(ORGANIZATION_MEMBERS_ROUTES.BY_USER_ID)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary: 'Xem chi tiết thành viên đơn vị, người quản lý, lịch sử membership và cấp dưới',
    response: organizationMemberDetailResponseSchema,
  })
  public async getMemberDetail(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OrganizationMemberDetailResponse> {
    return this.organizationMembersService.getMemberDetail(userId, actor);
  }

  /** Gán người dùng vào một hoặc nhiều đơn vị (chính/phụ, chức vụ, ngày bắt đầu/kết thúc — Mục 9.2.1, 9.2.2, 9.2.3) */
  @Put(ORGANIZATION_MEMBERS_ROUTES.MEMBERSHIPS)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary:
      'Gán người dùng vào đơn vị (chính/phụ, chức vụ positionTitle, ngày bắt đầu/kết thúc — Mục 9.2.1–9.2.3)',
    response: organizationMemberResponseSchema,
  })
  public async assignMemberships(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(assignOrganizationMembershipsSchema) body: AssignOrganizationMembershipsRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.organizationMembersService.assignOrganizationMemberships(
      userId,
      body,
      actor?.id,
      actor,
    );
  }

  /** Chuyển người dùng sang đơn vị khác và lưu lịch sử điều chuyển (Mục 9.2.6) */
  @Post(ORGANIZATION_MEMBERS_ROUTES.TRANSFER)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary: 'Chuyển người dùng sang đơn vị khác kèm giữ lịch sử membership (Mục 9.2.6)',
    response: organizationMemberResponseSchema,
  })
  public async transferMember(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(transferOrganizationMemberSchema) body: TransferOrganizationMemberRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.organizationMembersService.transferMemberOrganization(
      userId,
      body,
      actor?.id,
      actor,
    );
  }

  /** Thiết lập người quản lý trực tiếp và người quản lý tạm thời có thời hạn (Mục 9.2.4 & 9.2.5) */
  @Patch(ORGANIZATION_MEMBERS_ROUTES.MANAGERS)
  @RequirePermissions('organization-members.manage')
  @ApiDoc({
    summary: 'Thiết lập người quản lý trực tiếp và người quản lý tạm thời có thời hạn (Mục 9.2.4–9.2.5)',
    response: organizationMemberResponseSchema,
  })
  public async updateManagers(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedBody(updateOrganizationMemberManagersSchema)
    body: UpdateOrganizationMemberManagersRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.organizationMembersService.updateManagers(userId, body, actor?.id, actor);
  }

  /** Xem lịch sử gán và điều chuyển đơn vị của thành viên (Mục 9.2.6) */
  @Get(ORGANIZATION_MEMBERS_ROUTES.HISTORY)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary: 'Xem lịch sử tham gia, cập nhật và điều chuyển đơn vị của thành viên (Mục 9.2.6)',
    response: z.array(userOrganizationHistoryItemSchema),
  })
  public async getMembershipHistory(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    return this.organizationMembersService.getOrganizationHistory(userId, actor);
  }

  /** Tra cứu danh sách cấp dưới và chuỗi phê duyệt (Mục 9.2.7 — dùng cho Data Scope và Approval) */
  @Get(ORGANIZATION_MEMBERS_ROUTES.SUBORDINATES)
  @RequirePermissions('organization-members.read')
  @ApiDoc({
    summary: 'Tra cứu danh sách cấp dưới và chuỗi người phê duyệt (Mục 9.2.7)',
    response: organizationMemberSubordinatesResponseSchema,
  })
  public async getSubordinates(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedQuery(listMemberSubordinatesQuerySchema) query: ListMemberSubordinatesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    return this.organizationMembersService.getSubordinatesOverview(userId, query, actor);
  }
}
