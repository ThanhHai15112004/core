import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  ProviderRegistryService,
  SequenceRegistryService,
  SettingRegistryService,
  type RecordProviderInvocationInput,
} from '@packages/kernel/index.js';
import { BaseStorageProvider, StorageConnectionService } from '@packages/storage/index.js';
import { AuditLogService, FieldEncryptionService } from '@packages/security/index.js';
import type { IAuthPublicService } from '../../../src/modules/auth/contracts/index.js';
import type { ICredentialsPublicService } from '../../../src/modules/credentials/contracts/index.js';
import { GoogleOAuthAdapter } from '../../../src/modules/federated-identity/adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from '../../../src/modules/federated-identity/adapters/microsoft-oauth.adapter.js';
import { FederatedAuthEventEntity } from '../../../src/modules/federated-identity/entities/federated-auth-event.entity.js';
import { FederatedAuthTransactionEntity } from '../../../src/modules/federated-identity/entities/federated-auth-transaction.entity.js';
import { FederatedIdentityProviderEntity } from '../../../src/modules/federated-identity/entities/federated-identity-provider.entity.js';
import {
  FEDERATED_FLOW_TYPE,
  FEDERATED_PROVIDER_STATUS,
  FEDERATED_SETTING_KEYS,
} from '../../../src/modules/federated-identity/enum/federated-identity.enum.js';
import type { FederatedAuthEventRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-event.repository.js';
import type { FederatedAuthTransactionRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-transaction.repository.js';
import type { FederatedIdentityProviderRepository } from '../../../src/modules/federated-identity/repositories/federated-identity-provider.repository.js';
import type { FederatedIdentityRepository } from '../../../src/modules/federated-identity/repositories/federated-identity.repository.js';
import { FederatedAuthFlowService } from '../../../src/modules/federated-identity/services/federated-auth-flow.service.js';
import { FederatedMonitoringService } from '../../../src/modules/federated-identity/services/federated-monitoring.service.js';
import { FederatedProvidersService } from '../../../src/modules/federated-identity/services/federated-providers.service.js';
import { OAuthProviderRegistryService } from '../../../src/modules/federated-identity/services/oauth-provider-registry.service.js';
import { NotificationChannelAdapterRegistry } from '../../../src/modules/notification-delivery/adapters/notification-channel.adapters.js';
import { NotificationDeliveryEntity } from '../../../src/modules/notification-delivery/entities/notification-delivery.entity.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
} from '../../../src/modules/notification-delivery/enum/notification-delivery.enum.js';
import { resolveNotificationRuntimeConfig } from '../../../src/modules/notification-delivery/helpers/notification-delivery-config.helper.js';
import type { NotificationDeliveryRepository } from '../../../src/modules/notification-delivery/repositories/notification-delivery.repository.js';
import { NotificationDeliveryService } from '../../../src/modules/notification-delivery/services/notification-delivery.service.js';
import { SandboxPaymentAdapter } from '../../../src/modules/payments/adapters/sandbox-payment.adapter.js';
import { MoMoPaymentAdapter } from '../../../src/modules/payments/adapters/momo-payment.adapter.js';
import { StripePaymentAdapter } from '../../../src/modules/payments/adapters/stripe-payment.adapter.js';
import { VnPayPaymentAdapter } from '../../../src/modules/payments/adapters/vnpay-payment.adapter.js';
import { PaymentProviderEntity } from '../../../src/modules/payments/entities/payment-provider.entity.js';
import { PaymentTransactionEntity } from '../../../src/modules/payments/entities/payment-transaction.entity.js';
import {
  PAYMENT_DRIVER_CODE,
  PAYMENT_ENVIRONMENT,
  PAYMENT_PROVIDER_STATUS,
  PAYMENT_SETTING_KEYS,
} from '../../../src/modules/payments/enum/payments.enum.js';
import type { PaymentCallbackRepository } from '../../../src/modules/payments/repositories/payment-callback.repository.js';
import type { PaymentProviderRepository } from '../../../src/modules/payments/repositories/payment-provider.repository.js';
import type { PaymentRefundRepository } from '../../../src/modules/payments/repositories/payment-refund.repository.js';
import type { PaymentTransactionRepository } from '../../../src/modules/payments/repositories/payment-transaction.repository.js';
import { PaymentAdapterRegistryService } from '../../../src/modules/payments/services/payment-adapter-registry.service.js';
import { PaymentProvidersService } from '../../../src/modules/payments/services/payment-providers.service.js';
import { PaymentTransactionsService } from '../../../src/modules/payments/services/payment-transactions.service.js';
import type { IUsersPublicService } from '../../../src/modules/users/contracts/index.js';

describe('Provider Registry (10.6) — Backward-Compatible Domain Hooks', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('Payments hook preserves default behavior when empty, routes by unit/fallback, enforces pause, and records telemetry', async () => {
    const providerRegistry = new ProviderRegistryService();
    const settingRegistry = new SettingRegistryService();
    settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.DEFAULT_CURRENCY, 'VND');
    settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.DEFAULT_EXPIRY_SECONDS, 900);
    settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.CALLBACK_TOLERANCE_SEC, 300);
    settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.MAX_STORED_PAYLOAD_BYTES, 65536);

    const observed: RecordProviderInvocationInput[] = [];
    providerRegistry.registerInvocationSink((item) => {
      observed.push(item);
    });

    const providers = new Map<number, PaymentProviderEntity>();
    const transactions = new Map<number, PaymentTransactionEntity>();
    let txSeq = 1;

    providers.set(
      1,
      Object.assign(new PaymentProviderEntity(), {
        id: 1,
        providerCode: 'sandbox-default',
        driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
        displayName: 'Sandbox Default',
        status: PAYMENT_PROVIDER_STATUS.ACTIVE,
        isEnabled: true,
        isDefault: true,
        environment: PAYMENT_ENVIRONMENT.SANDBOX,
        supportsPartialRefund: true,
        allowedCurrenciesJson: JSON.stringify(['VND', 'USD']),
        configJson: JSON.stringify({}),
      }),
    );
    providers.set(
      2,
      Object.assign(new PaymentProviderEntity(), {
        id: 2,
        providerCode: 'sandbox-unit20',
        driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
        displayName: 'Sandbox Unit 20',
        status: PAYMENT_PROVIDER_STATUS.ACTIVE,
        isEnabled: true,
        isDefault: false,
        environment: PAYMENT_ENVIRONMENT.SANDBOX,
        supportsPartialRefund: true,
        allowedCurrenciesJson: JSON.stringify(['VND', 'USD']),
        configJson: JSON.stringify({}),
      }),
    );

    const providerRepo = {
      findByCode: async (code: string) =>
        [...providers.values()].find((p) => p.providerCode === code.trim().toLowerCase()) ?? null,
      findDefaultActiveProvider: async () =>
        [...providers.values()].find((p) => p.isDefault && p.isEnabled) ?? null,
      updateTelemetry: async () => undefined,
    } as unknown as PaymentProviderRepository;

    const txRepo = {
      findByIdempotencyKey: async (key: string) =>
        [...transactions.values()].find((t) => t.idempotencyKey === key) ?? null,
      saveEntity: async (partial: Partial<PaymentTransactionEntity>) => {
        const id = partial.id ? Number(partial.id) : txSeq++;
        const now = new Date();
        const entity = Object.assign(
          new PaymentTransactionEntity(),
          transactions.get(id) ?? {},
          partial,
          {
            id,
            createdAt: now,
            updatedAt: now,
          },
        );
        transactions.set(id, entity);
        return entity;
      },
    } as unknown as PaymentTransactionRepository;

    const adapterRegistry = new PaymentAdapterRegistryService(
      new SandboxPaymentAdapter(),
      new VnPayPaymentAdapter(),
      new MoMoPaymentAdapter(),
      new StripePaymentAdapter(),
    );
    const providersService = new PaymentProvidersService(
      providerRepo,
      adapterRegistry,
      settingRegistry,
      new FieldEncryptionService(),
      new AuditLogService(),
      providerRegistry,
    );
    const txService = new PaymentTransactionsService(
      txRepo,
      providerRepo,
      {} as PaymentRefundRepository,
      {} as PaymentCallbackRepository,
      providersService,
      adapterRegistry,
      settingRegistry,
      new SequenceRegistryService(),
      undefined,
      undefined,
      providerRegistry,
    );
    cleanups.push(() => {
      providersService.onModuleDestroy();
      providerRegistry.clear();
    });

    // 1. Empty registry -> backward compatible default provider
    const tx1 = await txService.createPayment({
      idempotencyKey: 'pay-hook-1',
      merchantOrderRef: 'ORD-1',
      amount: 50000,
    });
    expect(tx1.transaction.providerCode).toBe('sandbox-default');

    // 2. Register Payment providers & unit 20 override
    providerRegistry.replaceSnapshot(
      [
        {
          id: 101,
          providerCode: 'sandbox-default',
          providerType: PROVIDER_TYPE.PAYMENT,
          driverCode: 'sandbox',
          displayName: 'Sandbox Default',
          domainRefCode: 'sandbox-default',
          httpServiceName: null,
          role: PROVIDER_ROLE.PRIMARY,
          priority: 10,
          isPrimary: true,
          fallbackAllowed: false,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
          healthStatusName: 'HEALTHY',
          lastHealthCheckAt: null,
          lastHealthLatencyMs: null,
          lastHealthErrorCode: null,
        },
        {
          id: 102,
          providerCode: 'sandbox-unit20',
          providerType: PROVIDER_TYPE.PAYMENT,
          driverCode: 'sandbox',
          displayName: 'Sandbox Unit 20',
          domainRefCode: 'sandbox-unit20',
          httpServiceName: null,
          role: PROVIDER_ROLE.FALLBACK,
          priority: 20,
          isPrimary: false,
          fallbackAllowed: true,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
          healthStatusName: 'HEALTHY',
          lastHealthCheckAt: null,
          lastHealthLatencyMs: null,
          lastHealthErrorCode: null,
        },
      ],
      [
        {
          id: 1,
          providerType: PROVIDER_TYPE.PAYMENT,
          organizationUnitId: 20,
          primaryProviderId: 102,
          fallbackProviderId: null,
          allowFallbackOverride: null,
          isEnabled: true,
        },
      ],
    );

    const tx2 = await txService.createPayment({
      idempotencyKey: 'pay-hook-2',
      merchantOrderRef: 'ORD-2',
      amount: 75000,
      organizationUnitId: 20,
    });
    expect(tx2.transaction.providerCode).toBe('sandbox-unit20');
    expect(observed.some((o) => o.providerType === PROVIDER_TYPE.PAYMENT && o.success)).toBe(true);

    // 3. Pause explicit provider -> blocked immediately
    providerRegistry.upsertProvider({
      ...providerRegistry.getProviderByCode(PROVIDER_TYPE.PAYMENT, 'sandbox-default')!,
      status: PROVIDER_STATUS.PAUSED,
      statusName: 'PAUSED',
    });
    await expect(
      txService.createPayment({
        idempotencyKey: 'pay-hook-3',
        merchantOrderRef: 'ORD-3',
        amount: 20000,
        providerCode: 'sandbox-default',
      }),
    ).rejects.toThrow(BadRequestAppException);

    // 4. Health probe verification
    const probe = providerRegistry.resolveHealthProbe(
      PROVIDER_TYPE.PAYMENT,
      'sandbox-default',
      'sandbox',
    );
    expect(probe).not.toBeNull();
    const probeRes = await probe!({
      providerId: 101,
      providerCode: 'sandbox-default',
      providerType: PROVIDER_TYPE.PAYMENT,
      driverCode: 'sandbox',
      domainRefCode: 'sandbox-default',
      secretRef: null,
      config: {},
      timeoutMs: 2000,
    });
    expect(probeRes.status).toBe('HEALTHY');
  });

  it('Notification Delivery hook routes Email/SMS by unit & policy, handles pause cleanly, and records telemetry', async () => {
    const providerRegistry = new ProviderRegistryService();
    const observed: RecordProviderInvocationInput[] = [];
    providerRegistry.registerInvocationSink((item) => {
      observed.push(item);
    });

    const deliveries: NotificationDeliveryEntity[] = [];
    let idSeq = 1;
    const channelsRepo = {
      repository: {
        create: (data: Partial<NotificationDeliveryEntity>) =>
          Object.assign(new NotificationDeliveryEntity(), data),
      },
      findActiveSuppressions: async () => [],
      findActiveSuppressionsForDestinations: async () => new Set<string>(),
      findDeliveryByIdempotencyKey: async () => null,
      getOrCreateQuotaUsage: async () => ({
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalSuppressed: 0,
        totalSegments: 0,
        totalCost: '0.0000',
        currency: 'VND',
      }),
      checkQuota: async () => ({ allowed: true }),
      recordQuotaDelta: async () => undefined,
      saveEntity: async (entity: NotificationDeliveryEntity) => {
        if (!entity.id) entity.id = idSeq++;
        deliveries.push(entity);
        return entity;
      },
    } as unknown as NotificationDeliveryRepository;

    const deliveryService = new NotificationDeliveryService(
      channelsRepo,
      new NotificationChannelAdapterRegistry(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      providerRegistry,
    );
    cleanups.push(() => providerRegistry.clear());

    providerRegistry.replaceSnapshot(
      [
        {
          id: 201,
          providerCode: 'sendgrid-main',
          providerType: PROVIDER_TYPE.EMAIL,
          driverCode: 'sendgrid',
          displayName: 'SendGrid Main',
          domainRefCode: null,
          httpServiceName: null,
          role: PROVIDER_ROLE.PRIMARY,
          priority: 10,
          isPrimary: true,
          fallbackAllowed: false,
          status: PROVIDER_STATUS.PAUSED,
          statusName: 'PAUSED',
          pausedAt: new Date().toISOString(),
          pausedReason: 'Maintenance',
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
          healthStatusName: 'HEALTHY',
          lastHealthCheckAt: null,
          lastHealthLatencyMs: null,
          lastHealthErrorCode: null,
        },
        {
          id: 202,
          providerCode: 'ses-backup',
          providerType: PROVIDER_TYPE.EMAIL,
          driverCode: 'ses',
          displayName: 'SES Backup',
          domainRefCode: null,
          httpServiceName: null,
          role: PROVIDER_ROLE.FALLBACK,
          priority: 20,
          isPrimary: false,
          fallbackAllowed: true,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
          healthStatusName: 'HEALTHY',
          lastHealthCheckAt: null,
          lastHealthLatencyMs: null,
          lastHealthErrorCode: null,
        },
      ],
      [],
    );

    // 1. Fallback disallowed -> fails delivery cleanly with PRIMARY_PAUSED_FALLBACK_DISALLOWED
    const runtimeConfig = {
      ...resolveNotificationRuntimeConfig(null),
      emailFeatureEnabled: true,
      smsFeatureEnabled: true,
    };
    await deliveryService.dispatchExternalChannelDeliveries({
      notification: {
        id: 1,
        code: 'NTF-001',
        title: 'Test Email',
        content: 'Hello',
        organizationUnitId: null,
      },
      savedRecipients: [{ id: 10, recipientUserId: 1, channel: NOTIFICATION_CHANNEL.EMAIL }],
      recipientUserIds: [1],
      metadata: {
        destinationOverrides: { EMAIL: 'user@example.com' },
      },
      runtimeConfig,
    });
    expect(deliveries[0]?.status).toBe(NOTIFICATION_DELIVERY_STATUS.FAILED);
    expect(deliveries[0]?.errorCode).toBe('PRIMARY_PAUSED_FALLBACK_DISALLOWED');

    // 2. Policy allows fallback -> sends via SES_BACKUP & records telemetry
    providerRegistry.setPolicyProvider(() => ({
      fallbackEnabled: true,
      fallbackAllowedTypes: [PROVIDER_TYPE.EMAIL, PROVIDER_TYPE.SMS],
      fallbackOnPaused: true,
      fallbackOnDown: true,
      fallbackOnDegraded: false,
      unitRoutingEnabled: true,
    }));

    await deliveryService.dispatchExternalChannelDeliveries({
      notification: {
        id: 2,
        code: 'NTF-002',
        title: 'Test Email 2',
        content: 'Hello fallback',
        organizationUnitId: null,
      },
      savedRecipients: [{ id: 11, recipientUserId: 1, channel: NOTIFICATION_CHANNEL.EMAIL }],
      recipientUserIds: [1],
      metadata: {
        destinationOverrides: { EMAIL: 'user@example.com' },
      },
      runtimeConfig,
    });
    expect(deliveries[1]?.status).toBe(NOTIFICATION_DELIVERY_STATUS.DELIVERED);
    expect(deliveries[1]?.providerCode).toBe('SES-BACKUP');
    expect(observed.some((o) => o.providerType === PROVIDER_TYPE.EMAIL && o.success)).toBe(true);
  });

  it('Federated Identity hook blocks paused providers immediately and forwards auth monitoring telemetry', async () => {
    const providerRegistry = new ProviderRegistryService();
    const settingRegistry = new SettingRegistryService();
    settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.ALLOWED_REDIRECT_URIS, [
      'http://localhost:5173/auth/oauth/callback',
    ]);

    const observed: RecordProviderInvocationInput[] = [];
    providerRegistry.registerInvocationSink((item) => {
      observed.push(item);
    });

    const events: FederatedAuthEventEntity[] = [];
    const fedProvider = Object.assign(new FederatedIdentityProviderEntity(), {
      id: 1,
      providerCode: 'google',
      driverCode: 'google',
      displayName: 'Google',
      status: FEDERATED_PROVIDER_STATUS.ACTIVE,
      isEnabled: true,
      clientId: 'client-123',
      clientSecretEncrypted: new FieldEncryptionService().encrypt('secret-xyz'),
    });

    const providerRepo = {
      findByCode: async (code: string) => (code === 'google' ? fedProvider : null),
      updateTelemetry: async () => undefined,
    } as unknown as FederatedIdentityProviderRepository;

    const eventRepo = {
      saveEntity: async (partial: Partial<FederatedAuthEventEntity>) => {
        const entity = Object.assign(new FederatedAuthEventEntity(), partial, {
          id: events.length + 1,
        });
        events.push(entity);
        return entity;
      },
    } as unknown as FederatedAuthEventRepository;

    const txRepo = {
      saveEntity: async (p: Partial<FederatedAuthTransactionEntity>) =>
        Object.assign(new FederatedAuthTransactionEntity(), p, { id: 1 }),
    } as unknown as FederatedAuthTransactionRepository;

    const monitoring = new FederatedMonitoringService(
      eventRepo,
      providerRepo,
      undefined,
      undefined,
      undefined,
      providerRegistry,
    );
    const oauthRegistry = new OAuthProviderRegistryService(
      new GoogleOAuthAdapter(),
      new MicrosoftOAuthAdapter(),
    );
    const providersService = new FederatedProvidersService(
      providerRepo,
      oauthRegistry,
      settingRegistry,
      new FieldEncryptionService(),
      new AuditLogService(),
      providerRegistry,
    );
    const authFlow = new FederatedAuthFlowService(
      providerRepo,
      {} as FederatedIdentityRepository,
      txRepo,
      providersService,
      oauthRegistry,
      monitoring,
      {} as IUsersPublicService,
      {} as ICredentialsPublicService,
      {} as IAuthPublicService,
      {} as never,
      settingRegistry,
      new FieldEncryptionService(),
      undefined,
      undefined,
      providerRegistry,
    );
    cleanups.push(() => {
      providersService.onModuleDestroy();
      providerRegistry.clear();
    });

    // Pause Google in Provider Registry -> blocked immediately
    providerRegistry.upsertProvider({
      id: 301,
      providerCode: 'google',
      providerType: PROVIDER_TYPE.IDENTITY,
      driverCode: 'google',
      displayName: 'Google OAuth',
      domainRefCode: 'google',
      httpServiceName: null,
      role: PROVIDER_ROLE.PRIMARY,
      priority: 10,
      isPrimary: true,
      fallbackAllowed: false,
      status: PROVIDER_STATUS.PAUSED,
      statusName: 'PAUSED',
      pausedAt: new Date().toISOString(),
      pausedReason: 'Emergency pause',
      secretRef: null,
      hasEncryptedSecrets: false,
      config: {},
      healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
      healthStatusName: 'HEALTHY',
      lastHealthCheckAt: null,
      lastHealthLatencyMs: null,
      lastHealthErrorCode: null,
    });

    await expect(
      authFlow.initiateAuthorize('google', FEDERATED_FLOW_TYPE.LOGIN, {
        redirectUri: 'http://localhost:5173/auth/oauth/callback',
      }),
    ).rejects.toThrow(ForbiddenAppException);

    expect(events.some((e) => e.errorCode === 'PROVIDER_PAUSED')).toBe(true);
    expect(
      observed.some(
        (o) =>
          o.providerType === PROVIDER_TYPE.IDENTITY &&
          !o.success &&
          o.errorCode === 'PROVIDER_PAUSED',
      ),
    ).toBe(true);
  });

  it('Storage hook registers STORAGE health probe and records upload/download invocation latency', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'core-pr-storage-'));
    const providerRegistry = new ProviderRegistryService();
    const observed: RecordProviderInvocationInput[] = [];
    providerRegistry.registerInvocationSink((item) => {
      observed.push(item);
    });

    const config = {
      isTest: true,
      storage: {
        driver: 'local',
        localPath: tempDir,
        cdnUrl: '',
        s3: {
          bucket: 'test',
          region: 'us-east-1',
          accessKey: '',
          secretKey: '',
          accessKeySecret: '',
          secretKeySecret: '',
        },
      },
    } as unknown as CoreConfigService;

    const storageProvider = new BaseStorageProvider(
      config,
      undefined,
      undefined,
      undefined,
      providerRegistry,
    );
    const connection = new StorageConnectionService(
      storageProvider,
      config,
      undefined,
      undefined,
      providerRegistry,
    );
    cleanups.push(() => {
      connection.onModuleDestroy();
      storageProvider.onModuleDestroy();
      providerRegistry.clear();
      rmSync(tempDir, { recursive: true, force: true });
    });

    await connection.onApplicationBootstrap();
    providerRegistry.upsertProvider({
      id: 401,
      providerCode: 'local-fs',
      providerType: PROVIDER_TYPE.STORAGE,
      driverCode: 'local',
      displayName: 'Local FS',
      domainRefCode: 'local',
      httpServiceName: null,
      role: PROVIDER_ROLE.PRIMARY,
      priority: 10,
      isPrimary: true,
      fallbackAllowed: false,
      status: PROVIDER_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      pausedAt: null,
      pausedReason: null,
      secretRef: null,
      hasEncryptedSecrets: false,
      config: {},
      healthStatus: PROVIDER_HEALTH_STATUS.UNKNOWN,
      healthStatusName: 'UNKNOWN',
      lastHealthCheckAt: null,
      lastHealthLatencyMs: null,
      lastHealthErrorCode: null,
    });

    const probe = providerRegistry.resolveHealthProbe(PROVIDER_TYPE.STORAGE, 'local-fs', 'local');
    expect(probe).not.toBeNull();
    const healthResult = await probe!({
      providerId: 401,
      providerCode: 'local-fs',
      providerType: PROVIDER_TYPE.STORAGE,
      driverCode: 'local',
      domainRefCode: 'local',
      secretRef: null,
      config: {},
      timeoutMs: 2000,
    });
    expect(healthResult.status).toBe('HEALTHY');

    await storageProvider.upload('test/hello.txt', Buffer.from('hello world'), 'text/plain');
    expect(
      observed.some(
        (o) => o.providerType === PROVIDER_TYPE.STORAGE && o.driverCode === 'local' && o.success,
      ),
    ).toBe(true);
  });
});
