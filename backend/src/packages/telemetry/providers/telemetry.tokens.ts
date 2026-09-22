/**
 * Tên instance đang ghi số đo (vd. `api@host:1234`); `null` = không ghi (runtime chạy theo yêu cầu như CLI).
 * Do `RuntimeAgentModule` cung cấp.
 */
export const TELEMETRY_INSTANCE = Symbol('TELEMETRY_INSTANCE');
