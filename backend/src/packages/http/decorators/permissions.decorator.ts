import { applyDecorators, SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'security:required_permissions';
export const REQUIRED_ANY_PERMISSIONS_KEY = 'security:required_any_permissions';
export const REQUIRED_ROLES_KEY = 'security:required_roles';

/**
 * Decorator khai báo danh sách quyền (Permissions) cần có để gọi API (mặc định yêu cầu đủ tất cả quyền được liệt kê).
 * Tự động được kiểm tra bởi `AuthGuard` và tự động hiển thị trên tài liệu Scalar / OpenAPI (`x-required-permissions`).
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Decorator khai báo danh sách quyền (Permissions) theo cơ chế OR (chỉ cần có ít nhất 1 quyền trong danh sách).
 * Dùng cho các endpoint nền tảng dùng chung nhiều module (`ImportsController`, `ExportsController`, `ReportsController`, `SearchController`).
 * Vẫn đồng bộ `REQUIRED_PERMISSIONS_KEY` để tài liệu OpenAPI / Scalar hiển thị đầy đủ danh sách quyền được chấp nhận.
 */
export const RequireAnyPermission = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, true),
  );

/**
 * Decorator khai báo danh sách vai trò (Roles) cần có để gọi API.
 * Tự động được kiểm tra bởi `AuthGuard` và tự động hiển thị trên tài liệu Scalar / OpenAPI (`x-required-roles`).
 */
export const RequireRoles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
