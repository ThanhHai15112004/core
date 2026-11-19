import { Injectable } from '@nestjs/common';
import { BadRequestAppException } from '@packages/kernel/index.js';
import { MoMoPaymentAdapter } from '../adapters/momo-payment.adapter.js';
import { SandboxPaymentAdapter } from '../adapters/sandbox-payment.adapter.js';
import { StripePaymentAdapter } from '../adapters/stripe-payment.adapter.js';
import { VnPayPaymentAdapter } from '../adapters/vnpay-payment.adapter.js';
import type { IPaymentProviderAdapter } from '../contracts/index.js';
import type { PaymentDriverCode } from '../enum/payments.enum.js';
import type { PaymentDriverMetadata } from '../types/payments.types.js';

@Injectable()
export class PaymentAdapterRegistryService {
  private readonly adapters = new Map<string, IPaymentProviderAdapter>();

  constructor(
    sandboxAdapter: SandboxPaymentAdapter,
    vnPayAdapter: VnPayPaymentAdapter,
    momoAdapter: MoMoPaymentAdapter,
    stripeAdapter: StripePaymentAdapter,
  ) {
    this.registerAdapter(sandboxAdapter);
    this.registerAdapter(vnPayAdapter);
    this.registerAdapter(momoAdapter);
    this.registerAdapter(stripeAdapter);
  }

  public registerAdapter(adapter: IPaymentProviderAdapter): void {
    this.adapters.set(adapter.driverCode.trim().toLowerCase(), adapter);
  }

  public getAdapterOrThrow(driverCode: PaymentDriverCode | string): IPaymentProviderAdapter {
    const adapter = this.adapters.get(driverCode.trim().toLowerCase());
    if (!adapter) {
      throw new BadRequestAppException('payments.unsupportedDriver', [{ driverCode }]);
    }
    return adapter;
  }

  public listDrivers(): PaymentDriverMetadata[] {
    return Array.from(this.adapters.values()).map((a) => a.getMetadata());
  }
}
