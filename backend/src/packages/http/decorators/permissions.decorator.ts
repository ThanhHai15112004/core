import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'security:required_permissions';
export const REQUIRED_ROLES_KEY = 'security:required_roles';

/**
 * Decorator khai báo danh sách quyền (Permissions) cần có để gọi API.
 * Tự động được kiểm tra bởi `AuthGuard` và tự động hiển thị trên tài liệu Scalar / OpenAPI (`x-required-permissions`).
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Decorator khai báo danh sách vai trò (Roles) cần có để gọi API.
 * Tự động được kiểm tra bởi `AuthGuard` và tự động hiển thị trên tài liệu Scalar / OpenAPI (`x-required-roles`).
 */
export const RequireRoles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
