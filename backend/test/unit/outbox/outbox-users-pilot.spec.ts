import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService, TransactionManager } from '@packages/database/index.js';
import {
  DomainEventBusService,
  OUTBOX_EVENT_STATUS,
  OUTBOX_QUEUE_TOPICS,
  OutboxPublisherService,
  type DomainEvent,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { SystemProcessor } from '@apps/worker/processors/system/system.processor.js';
import { executeCreateUserRecordFlow } from '@modules/users/helpers/user-crud-orchestrator.helper.js';
import { USER_STATUS } from '@modules/users/contracts/index.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserProfileEntity } from '@modules/users/entities/user-profile.entity.js';
import type { UserResponse } from '@modules/users/responses/users.response.js';
import type { UserRepository } from '@modules/users/repositories/user.repository.js';
import type { IOrganizationMembersUnitPersistenceContract } from '@modules/organization-members/index.js';
import type { IRolesPublicService } from '@modules/roles/contracts/index.js';
import type { PasswordHasherService } from '@packages/security/index.js';
import { WebhooksDomainEventListener } from '@modules/webhooks/listeners/webhooks-domain-event.listener.js';
import type { WebhooksService } from '@modules/webhooks/services/webhooks.service.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('Users -> Transactional Outbox -> Worker -> DomainEventBus -> Webhooks Pilot', () => {
  it('writes UserCreated inside the user creation DB transaction and relays end-to-end via Worker', async () => {
    applyTestEnv({ DB_TRANSACTION_TIMEOUT_MS: '5000' });
    const config = new CoreConfigService();

    const committedOutbox: DomainEvent[] = [];
    let stagedOutbox: DomainEvent[] | null = null;
    let inTxWhenEnqueued = false;

    const mockDataSource = {
      isInitialized: true,
      createQueryRunner: () =>
        ({
          manager: {} as EntityManager,
          connect: async () => undefined,
          startTransaction: async () => {
            stagedOutbox = [];
          },
          commitTransaction: async () => {
            if (stagedOutbox) {
              committedOutbox.push(...stagedOutbox);
              stagedOutbox = null;
            }
          },
          rollbackTransaction: async () => {
            stagedOutbox = null;
          },
          release: async () => undefined,
          query: async () => [],
        }) as unknown as QueryRunner,
    } as unknown as DataSource;

    const txManager = new TransactionManager(
      {
        connected: () => mockDataSource,
        driver: 'mysql',
        getStatus: () => ({ state: 'connected' }),
      } as unknown as DatabaseConnectionService,
      config,
    );

    const bus = new DomainEventBusService();
    bus.setContextResolver(() => {
      const store = RequestContextService.current();
      return store
        ? {
            requestId: store.requestId ?? null,
            correlationId: store.correlationId ?? null,
            actorId: store.userId ?? null,
          }
        : undefined;
    });

    const outboxPublisher = new OutboxPublisherService(bus);
    outboxPublisher.registerWriter(async (event, options) => {
      inTxWhenEnqueued = txManager.isInTransaction();
      if (stagedOutbox) {
        stagedOutbox.push(event);
      } else {
        committedOutbox.push(event);
      }
      return {
        id: 1,
        eventId: event.id,
        eventType: event.type,
        dotName: event.metadata.dotName,
        status: OUTBOX_EVENT_STATUS.PENDING,
        statusName: 'PENDING',
        destinationQueue: options?.destinationQueue ?? QUEUES.SYSTEM_EVENTS,
        destinationTopic: options?.destinationTopic ?? OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
        persisted: true,
      };
    });

    const mockUserRepo = {
      findByEmail: async () => null,
      findByUsername: async () => null,
      findByPhoneHash: async () => null,
      saveEntity: async (data: Partial<UserEntity>) =>
        ({
          id: 123,
          username: data.username ?? 'pilot_user',
          email: data.email ?? 'pilot@example.com',
          status: data.status ?? USER_STATUS.ACTIVE,
          primaryOrganizationUnitId: data.primaryOrganizationUnitId ?? null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as unknown as UserEntity,
    } as unknown as UserRepository;

    const mockUserOrgRepo = {
      replaceUserOrganizations: async () => undefined,
    } as unknown as IOrganizationMembersUnitPersistenceContract;

    const mockRolesPublic = {
      findRolesByIds: async () => [],
      replaceUserRoles: async () => undefined,
    } as unknown as IRolesPublicService;

    const mockHasher = {
      hash: async () => 'hashed_secret',
    } as unknown as PasswordHasherService;

    let persistedFlag = false;

    await RequestContextService.runWith(
      { requestId: 'req-pilot-1', correlationId: 'corr-pilot-1', userId: '9' },
      async () => {
        await executeCreateUserRecordFlow({
          dto: {
            username: 'pilot_user',
            email: 'pilot@example.com',
            password: 'StrongPassword123!',
            fullName: 'Nguyen Pilot',
            status: USER_STATUS.ACTIVE,
            roleIds: [],
            organizationUnits: [],
          },
          actorId: 9,
          userRepository: mockUserRepo,
          userOrgRepository: mockUserOrgRepo,
          orgHistoryRepository: null,
          passwordHasher: mockHasher,
          rolesPublicService: mockRolesPublic,
          organizationsPublicService: null,
          transactionManager: txManager,
          auditLogService: null,
          encryptPhone: () => null,
          upsertUserProfile: async () => ({}) as UserProfileEntity,
          recordStatusHistory: async () => undefined,
          saveUserPasswordHash: async () => undefined,
          getById: async (uid) =>
            ({
              id: uid,
              username: 'pilot_user',
              email: 'pilot@example.com',
              phone: null,
              firstName: 'Pilot',
              lastName: 'Nguyen',
              fullName: 'Nguyen Pilot',
              avatarUrl: null,
              dateOfBirth: null,
              gender: null,
              genderName: null,
              identityNumber: null,
              address: null,
              city: null,
              country: null,
              bio: null,
              preferredLocale: 'vi',
              preferredTimezone: 'Asia/Ho_Chi_Minh',
              status: USER_STATUS.ACTIVE,
              statusName: 'ACTIVE',
              mfaEnabled: false,
              primaryOrganizationUnitId: null,
              managerId: null,
              temporaryManagerId: null,
              temporaryManagerFrom: null,
              temporaryManagerUntil: null,
              lockedUntil: null,
              lockReason: null,
              lastLoginAt: null,
              archivedAt: null,
              version: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              roles: [],
              organizationUnits: [],
            }) as unknown as UserResponse,
          syncUserSearchDocumentSafe: async () => undefined,
          outboxPublisher,
          onOutboxPersisted: (persisted) => {
            persistedFlag = persisted;
          },
        });
      },
    );

    // 1. Xác nhận ghi Outbox diễn ra NGAY BÊN TRONG DB transaction và đã commit
    expect(inTxWhenEnqueued).toBe(true);
    expect(persistedFlag).toBe(true);
    expect(committedOutbox).toHaveLength(1);
    const outboxEvent = committedOutbox[0]!;
    expect(outboxEvent.type).toBe('UserCreated');
    expect(outboxEvent.metadata.requestId).toBe('req-pilot-1');
    expect(outboxEvent.metadata.correlationId).toBe('corr-pilot-1');

    // 2. Xác nhận Worker SystemProcessor nhận `outbox.domain_event` và chuyển tiếp tới Webhooks listener
    const webhookDispatch = jest.fn(async () => ({
      eventName: 'user.created',
      eventId: outboxEvent.id,
      matchedEndpointsCount: 1,
      queuedCount: 1,
      failedEnqueueCount: 0,
      deliveryIds: [1],
    }));
    const webhookListener = new WebhooksDomainEventListener(
      { dispatchEvent: webhookDispatch } as unknown as WebhooksService,
      bus,
    );
    webhookListener.onModuleInit();

    const metrics = new MetricsRegistryService({ runtime: 'worker' });
    const processor = new SystemProcessor(
      config,
      metrics,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      bus,
    );

    const envelope: MessageEnvelope = {
      id: 'msg-outbox-1',
      topic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payload: { outboxId: 1, event: outboxEvent },
      timestamp: new Date().toISOString(),
      producer: 'worker',
      correlationId: 'corr-pilot-1',
    };

    const result = await (
      processor as unknown as {
        handle: (env: MessageEnvelope, job: Job) => Promise<Record<string, unknown>>;
      }
    ).handle(envelope, { id: 'job-1', attemptsMade: 0 } as unknown as Job);

    expect(result['handled']).toBe(true);
    expect(result['eventType']).toBe('UserCreated');
    expect(webhookDispatch).toHaveBeenCalledTimes(1);
    expect(webhookDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'user.created',
        eventId: outboxEvent.id,
        correlationId: 'corr-pilot-1',
        requestedBy: 9,
      }),
    );

    webhookListener.onModuleDestroy();
    applyTestEnv();
  });
});
