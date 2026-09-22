import type { DatabaseMonitoringProvider, MonitoringCapability } from './monitoring.types.js';

const unsupported = async (): Promise<never> => {
  throw new Error('Not supported by this driver');
};

/**
 * Driver chưa có provider chuyên biệt (MSSQL, SQLite…): chỉ phần chung (health, latency/throughput từ
 * instrumentation của app). Mọi phần nâng cao hiện "Không hỗ trợ" thay vì số giả.
 */
export class BasicMonitoringProvider implements DatabaseMonitoringProvider {
  public readonly capabilities: ReadonlySet<MonitoringCapability> = new Set();

  constructor(public readonly driver: string) {}

  public serverInfo = unsupported;
  public sessions = unsupported;
  public digestStats = unsupported;
  public explain = unsupported;
  public transactions = unsupported;
  public lockWaits = unsupported;
  public tables = unsupported;
  public tableDetail = unsupported;
  public storage = unsupported;
  public cancel = unsupported;
  public terminate = unsupported;
}
