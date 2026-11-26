export * from './contracts/api-response.contract.js';
export * from './contracts/api-docs.contract.js';
export * from './decorators/public.decorator.js';
export * from './decorators/permissions.decorator.js';
export * from './decorators/validate.decorator.js';
export * from './decorators/api-doc.decorator.js';
export * from './decorators/idempotent.decorator.js';
export * from './decorators/request-timeout.decorator.js';
export * from './filters/global-exception.filter.js';
export * from './interceptors/idempotency.interceptor.js';
export * from './interceptors/request-timeout.interceptor.js';
export * from './interceptors/transform-response.interceptor.js';
export * from './http.module.js';
export * from './utils/capture.js';
export * from './utils/api-version.util.js';
export * from './utils/response.util.js';
export * from './utils/query-list.util.js';
export * from './utils/validation.util.js';
export * from './utils/openapi-builder.util.js';
export * from './utils/scalar-ui.util.js';
export * from './utils/openapi-diff.util.js';
export * from './utils/service-routing.util.js';
export * from './utils/gateway-consistency.util.js';
export {
  buildFastifyTrustProxyOption,
  configureDefaultTrustedProxyPolicy,
  getDefaultTrustedProxyPolicy,
  isIpInCidr,
  isTrustedProxyIp,
  normalizeIp,
  parseForwardedHeader,
  resolveClientIp,
  resolveEffectiveTrustedCidrs,
  resolveForwardedContext,
  type ForwardedContext,
  type ParsedForwardedHeader,
  type ProxyRequestLike,
  type ProxyTrustMode,
  type TrustedProxyPolicy,
} from '@packages/kernel/index.js';
