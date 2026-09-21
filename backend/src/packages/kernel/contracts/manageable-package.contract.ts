import { PackageStatus, PackageCategory } from '../types/manageable-package.enum.js';

export interface PackageActionDescriptor {
  id: string;
  label: string;
  description?: string;
  isDanger?: boolean;
  paramsSchema?: Record<string, unknown>;
}

export interface PackageStatusReport {
  status: PackageStatus;
  summary: string;
  metrics: Record<string, string | number | boolean>;
}

export interface ManageablePackage {
  readonly packageId: string;
  readonly displayName: string;
  readonly category: PackageCategory;
  readonly icon: string;

  getStatus(): Promise<PackageStatusReport>;
  getActions?(): PackageActionDescriptor[];
  executeAction?(
    actionId: string,
    params?: unknown,
  ): Promise<{ success: boolean; message: string; data?: unknown }>;
}

export const MANAGEABLE_PACKAGE = Symbol('MANAGEABLE_PACKAGE');
