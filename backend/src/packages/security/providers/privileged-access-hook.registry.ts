import { Injectable } from '@nestjs/common';
import type { UserIdentity } from '../contracts/auth.contract.js';

export interface PrivilegedAccessGuardRequestContext {
  readonly user: UserIdentity;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly stepUpToken: string | null;
  readonly method: string;
  readonly url: string;
  readonly ipAddress: string | null;
}

export interface PrivilegedMatchedTargetInfo {
  readonly targetType: 'ROLE' | 'PERMISSION';
  readonly targetCode: string;
  readonly sensitivityLevel: string;
  readonly requireMfaStepUp: boolean;
  readonly alertOnUse: boolean;
}

export interface PrivilegedAccessGuardDecision {
  readonly allowed: boolean;
  readonly errorCode?: string | undefined;
  readonly errorDetails?: readonly Record<string, unknown>[] | undefined;
  readonly privilegedActionDetected?: boolean | undefined;
  readonly matchedTargets?: readonly PrivilegedMatchedTargetInfo[] | undefined;
}

export interface IPrivilegedAccessRequestEvaluator {
  evaluateRequest(ctx: PrivilegedAccessGuardRequestContext): Promise<PrivilegedAccessGuardDecision>;
  onPrivilegedAccessAllowed?(
    ctx: PrivilegedAccessGuardRequestContext & {
      readonly matchedTargets: readonly PrivilegedMatchedTargetInfo[];
    },
  ): Promise<void>;
}

export interface TemporaryPrivilegedAccessView {
  readonly roleIds: readonly number[];
  readonly roleCodes: readonly string[];
  readonly permissions: readonly string[];
  readonly activeGrantIds: readonly number[];
  readonly isBreakGlassActive: boolean;
}

export interface IPrivilegedTemporaryAccessResolver {
  resolveActiveTemporaryAccess(userId: number): Promise<TemporaryPrivilegedAccessView | null>;
}

export interface PrivilegedBreakGlassLoginCheckResult {
  readonly isBreakGlass: boolean;
  readonly requireMfa: boolean;
  readonly breakGlassId: number | null;
  readonly code?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
}

export interface IPrivilegedLoginPolicyHook {
  assertCanLogin(
    userId: number,
    meta?: { readonly ipAddress?: string | null; readonly userAgent?: string | null },
  ): Promise<PrivilegedBreakGlassLoginCheckResult>;
  onLoginSucceeded?(
    userId: number,
    context: PrivilegedBreakGlassLoginCheckResult & {
      readonly ipAddress?: string | null;
      readonly userAgent?: string | null;
    },
  ): Promise<void>;
}

/**
 * Registry thuần kỹ thuật không chứa nghiệp vụ (Zero Domain Leakage — Mục 14.4).
 * Cho phép module tùy chọn `privileged-access` đăng ký các hook kiểm soát MFA Step-Up,
 * hợp nhất quyền tạm thời JIT và giám sát Break-glass vào `@packages/security`, `auth` và `users`
 * mà không tạo phụ thuộc vòng.
 */
@Injectable()
export class PrivilegedAccessHookRegistry {
  private guardEvaluator: IPrivilegedAccessRequestEvaluator | null = null;
  private grantResolver: IPrivilegedTemporaryAccessResolver | null = null;
  private loginPolicy: IPrivilegedLoginPolicyHook | null = null;

  public registerGuardEvaluator(evaluator: IPrivilegedAccessRequestEvaluator | null): void {
    this.guardEvaluator = evaluator;
  }

  public getGuardEvaluator(): IPrivilegedAccessRequestEvaluator | null {
    return this.guardEvaluator;
  }

  public registerGrantResolver(resolver: IPrivilegedTemporaryAccessResolver | null): void {
    this.grantResolver = resolver;
  }

  public getGrantResolver(): IPrivilegedTemporaryAccessResolver | null {
    return this.grantResolver;
  }

  public registerLoginPolicy(policy: IPrivilegedLoginPolicyHook | null): void {
    this.loginPolicy = policy;
  }

  public getLoginPolicy(): IPrivilegedLoginPolicyHook | null {
    return this.loginPolicy;
  }

  public clearAll(): void {
    this.guardEvaluator = null;
    this.grantResolver = null;
    this.loginPolicy = null;
  }
}

export const defaultPrivilegedAccessHookRegistry = new PrivilegedAccessHookRegistry();
