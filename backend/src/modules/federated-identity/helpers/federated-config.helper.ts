import { SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import { FEDERATED_DEFAULTS, FEDERATED_SETTING_KEYS } from '../enum/federated-identity.enum.js';
import type {
  EffectiveProviderPolicy,
  FederatedRuntimeConfig,
} from '../types/federated-identity.types.js';

export function resolveFederatedRuntimeConfig(
  registry: SettingRegistryService = defaultSettingRegistry,
): FederatedRuntimeConfig {
  const autoLinkVerifiedEmail = registry.getBoolean(
    FEDERATED_SETTING_KEYS.AUTO_LINK_VERIFIED_EMAIL,
    undefined,
    FEDERATED_DEFAULTS.AUTO_LINK_VERIFIED_EMAIL,
  );
  const allowAutoRegister = registry.getBoolean(
    FEDERATED_SETTING_KEYS.ALLOW_AUTO_REGISTER,
    undefined,
    FEDERATED_DEFAULTS.ALLOW_AUTO_REGISTER,
  );
  const requireVerifiedEmailForRegister = registry.getBoolean(
    FEDERATED_SETTING_KEYS.REQUIRE_VERIFIED_EMAIL_FOR_REGISTER,
    undefined,
    FEDERATED_DEFAULTS.REQUIRE_VERIFIED_EMAIL_FOR_REGISTER,
  );
  const transactionTtlSeconds = registry.getNumber(
    FEDERATED_SETTING_KEYS.TRANSACTION_TTL_SECONDS,
    undefined,
    FEDERATED_DEFAULTS.TRANSACTION_TTL_SECONDS,
  );
  const jwksCacheTtlSeconds = registry.getNumber(
    FEDERATED_SETTING_KEYS.JWKS_CACHE_TTL_SECONDS,
    undefined,
    FEDERATED_DEFAULTS.JWKS_CACHE_TTL_SECONDS,
  );
  const requireStepUpForUnlink = registry.getBoolean(
    FEDERATED_SETTING_KEYS.REQUIRE_STEP_UP_FOR_UNLINK,
    undefined,
    FEDERATED_DEFAULTS.REQUIRE_STEP_UP_FOR_UNLINK,
  );
  const rawAllowedUris = registry.getJson<readonly string[]>(
    FEDERATED_SETTING_KEYS.ALLOWED_REDIRECT_URIS,
    undefined,
    [...FEDERATED_DEFAULTS.ALLOWED_REDIRECT_URIS],
  );

  const allowedRedirectUris = Array.isArray(rawAllowedUris)
    ? rawAllowedUris.map((u) => String(u).trim()).filter((u) => u.length > 0)
    : [...FEDERATED_DEFAULTS.ALLOWED_REDIRECT_URIS];

  return {
    autoLinkVerifiedEmail: Boolean(autoLinkVerifiedEmail),
    allowAutoRegister: Boolean(allowAutoRegister),
    requireVerifiedEmailForRegister: Boolean(requireVerifiedEmailForRegister),
    transactionTtlSeconds: Math.max(60, Math.min(1800, Math.trunc(transactionTtlSeconds))),
    jwksCacheTtlSeconds: Math.max(60, Math.min(86_400, Math.trunc(jwksCacheTtlSeconds))),
    requireStepUpForUnlink: Boolean(requireStepUpForUnlink),
    allowedRedirectUris,
  };
}

export function resolveEffectiveProviderPolicy(
  provider:
    | {
        readonly allowAutoRegisterOverride?: boolean | null | undefined;
        readonly autoLinkVerifiedEmailOverride?: boolean | null | undefined;
      }
    | null
    | undefined,
  runtimeConfig: FederatedRuntimeConfig,
): EffectiveProviderPolicy {
  return {
    allowAutoRegister:
      provider?.allowAutoRegisterOverride !== null &&
      provider?.allowAutoRegisterOverride !== undefined
        ? Boolean(provider.allowAutoRegisterOverride)
        : runtimeConfig.allowAutoRegister,
    autoLinkVerifiedEmail:
      provider?.autoLinkVerifiedEmailOverride !== null &&
      provider?.autoLinkVerifiedEmailOverride !== undefined
        ? Boolean(provider.autoLinkVerifiedEmailOverride)
        : runtimeConfig.autoLinkVerifiedEmail,
    requireVerifiedEmailForRegister: runtimeConfig.requireVerifiedEmailForRegister,
  };
}
