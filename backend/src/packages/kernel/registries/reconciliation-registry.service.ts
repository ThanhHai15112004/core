import { Injectable } from '@nestjs/common';
import type {
  DataRepairHandlerMetadata,
  IDataRepairHandler,
  IReconciliationRegistryPort,
  IReconciliationSourceAdapter,
  ReconciliationAdapterMetadata,
} from '../contracts/reconciliation.contract.js';

/**
 * Bộ đăng ký trung tâm cho Source Adapters đối soát và Data Repair / Compensation Handlers (11.5).
 * Mọi module nghiệp vụ có thể đăng ký adapter/handler của riêng mình vào đây tại `OnModuleInit`
 * mà không cần phụ thuộc chéo với `ReconciliationModule`.
 */
@Injectable()
export class ReconciliationRegistryService implements IReconciliationRegistryPort {
  private readonly adapters = new Map<string, IReconciliationSourceAdapter>();
  private readonly repairHandlers = new Map<string, IDataRepairHandler>();

  public registerAdapter(adapter: IReconciliationSourceAdapter): void {
    const key = adapter.code.trim().toLowerCase();
    if (!key) return;
    this.adapters.set(key, adapter);
  }

  public getAdapter(code: string): IReconciliationSourceAdapter | null {
    return this.adapters.get(code.trim().toLowerCase()) ?? null;
  }

  public listAdapters(): ReconciliationAdapterMetadata[] {
    return Array.from(this.adapters.values()).map((adapter) => ({
      code: adapter.code,
      name: adapter.name,
      description: adapter.description,
      targetModule: adapter.targetModule,
      supportsExternalUpload: adapter.supportsExternalUpload,
      ...(adapter.defaultMatchingRules
        ? { defaultMatchingRules: adapter.defaultMatchingRules }
        : {}),
    }));
  }

  public registerRepairHandler(handler: IDataRepairHandler): void {
    const key = handler.code.trim().toLowerCase();
    if (!key) return;
    this.repairHandlers.set(key, handler);
  }

  public getRepairHandler(code: string): IDataRepairHandler | null {
    return this.repairHandlers.get(code.trim().toLowerCase()) ?? null;
  }

  public listRepairHandlers(): DataRepairHandlerMetadata[] {
    return Array.from(this.repairHandlers.values()).map((handler) => ({
      code: handler.code,
      name: handler.name,
      description: handler.description,
      targetModule: handler.targetModule,
      supportedModes: handler.supportedModes,
      alwaysSensitive: Boolean(handler.alwaysSensitive),
      supportsRollback: handler.supportsRollback,
    }));
  }

  public clear(): void {
    this.adapters.clear();
    this.repairHandlers.clear();
  }
}

export const defaultReconciliationRegistry = new ReconciliationRegistryService();
