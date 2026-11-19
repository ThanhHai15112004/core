import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { MoMoPaymentAdapter } from './adapters/momo-payment.adapter.js';
import { SandboxPaymentAdapter } from './adapters/sandbox-payment.adapter.js';
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter.js';
import { VnPayPaymentAdapter } from './adapters/vnpay-payment.adapter.js';
import { PAYMENTS_PUBLIC_SERVICE, PAYMENT_ADAPTER_REGISTRY } from './contracts/index.js';
import { PaymentsCallbackController } from './controllers/payments-callback.controller.js';
import { PaymentsController } from './controllers/payments.controller.js';
import { PaymentCallbackEntity } from './entities/payment-callback.entity.js';
import { PaymentProviderEntity } from './entities/payment-provider.entity.js';
import { PaymentReconciliationItemEntity } from './entities/payment-reconciliation-item.entity.js';
import { PaymentReconciliationEntity } from './entities/payment-reconciliation.entity.js';
import { PaymentRefundEntity } from './entities/payment-refund.entity.js';
import { PaymentTransactionEntity } from './entities/payment-transaction.entity.js';
import enPayments from './locales/en/payments.json' with { type: 'json' };
import viPayments from './locales/vi/payments.json' with { type: 'json' };
import { PaymentCallbackRepository } from './repositories/payment-callback.repository.js';
import { PaymentProviderRepository } from './repositories/payment-provider.repository.js';
import { PaymentReconciliationItemRepository } from './repositories/payment-reconciliation-item.repository.js';
import { PaymentReconciliationRepository } from './repositories/payment-reconciliation.repository.js';
import { PaymentRefundRepository } from './repositories/payment-refund.repository.js';
import { PaymentTransactionRepository } from './repositories/payment-transaction.repository.js';
import { PaymentAdapterRegistryService } from './services/payment-adapter-registry.service.js';
import { PaymentCallbacksService } from './services/payment-callbacks.service.js';
import { PaymentProvidersService } from './services/payment-providers.service.js';
import { PaymentReconciliationService } from './services/payment-reconciliation.service.js';
import { PaymentRefundsService } from './services/payment-refunds.service.js';
import { PaymentTransactionsService } from './services/payment-transactions.service.js';
import { PaymentsService } from './services/payments.service.js';

new CoreI18nService().registerNamespace('payments', {
  vi: viPayments,
  en: enPayments,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([
      PaymentProviderEntity,
      PaymentTransactionEntity,
      PaymentRefundEntity,
      PaymentCallbackEntity,
      PaymentReconciliationEntity,
      PaymentReconciliationItemEntity,
    ]),
  ],
  controllers: [PaymentsCallbackController, PaymentsController],
  providers: [
    PaymentProviderRepository,
    PaymentTransactionRepository,
    PaymentRefundRepository,
    PaymentCallbackRepository,
    PaymentReconciliationRepository,
    PaymentReconciliationItemRepository,
    SandboxPaymentAdapter,
    VnPayPaymentAdapter,
    MoMoPaymentAdapter,
    StripePaymentAdapter,
    PaymentAdapterRegistryService,
    PaymentProvidersService,
    PaymentTransactionsService,
    PaymentCallbacksService,
    PaymentRefundsService,
    PaymentReconciliationService,
    PaymentsService,
    {
      provide: PAYMENTS_PUBLIC_SERVICE,
      useExisting: PaymentsService,
    },
    {
      provide: PAYMENT_ADAPTER_REGISTRY,
      useExisting: PaymentAdapterRegistryService,
    },
  ],
  exports: [
    PaymentsService,
    PaymentAdapterRegistryService,
    PAYMENTS_PUBLIC_SERVICE,
    PAYMENT_ADAPTER_REGISTRY,
  ],
})
export class PaymentsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('payments', {
      vi: viPayments,
      en: enPayments,
    });
  }
}
