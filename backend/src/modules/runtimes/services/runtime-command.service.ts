import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotFoundAppException } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  COMMAND_TTL_SEC,
  runtimeKeys,
  type RuntimeCommand,
  type RuntimeCommandAction,
  type RuntimeCommandResult,
} from '@packages/runtime/index.js';
import { RuntimesService } from './runtimes.service.js';
import {
  RuntimeActionNotAllowedException,
  RuntimeTelemetryUnavailableException,
} from '../exceptions/runtime.exceptions.js';
import type { RuntimeCommandDto } from '../responses/runtime.response.js';

/** Restart không còn điều khiển từ Console — Docker / supervisor quản lý vòng đời process. */
export type ConsoleAction = 'stop' | 'start';

const ACTION_TO_COMMAND: Record<ConsoleAction, RuntimeCommandAction> = {
  stop: 'pause',
  start: 'resume',
};

/** Gửi lệnh điều khiển tới runtime qua Redis pub/sub và theo dõi kết quả. */
@Injectable()
export class RuntimeCommandService {
  private readonly keys: ReturnType<typeof runtimeKeys>;

  constructor(
    private readonly redis: RedisService,
    private readonly runtimes: RuntimesService,
    private readonly i18n: CoreI18nService,
  ) {
    this.keys = runtimeKeys(redis);
  }

  public async dispatch(rawId: string, action: ConsoleAction): Promise<RuntimeCommandDto> {
    const id = this.runtimes.assertRuntimeId(rawId);
    if (!this.redis.isReady()) throw new RuntimeTelemetryUnavailableException();

    const detail = await this.runtimes.getDetail(id);
    const availability = detail.actions[action];
    if (!availability.allowed) {
      throw new RuntimeActionNotAllowedException('runtime.error.actionNotAllowed', {
        action: this.i18n.t(`runtime.actionName.${action}`),
        reason: availability.reason ?? '',
      });
    }

    const command: RuntimeCommand = {
      id: randomUUID(),
      runtime: id,
      action: ACTION_TO_COMMAND[action],
      requestedAt: new Date().toISOString(),
    };
    const pending: RuntimeCommandResult = {
      id: command.id,
      status: 'pending',
      at: command.requestedAt,
    };

    await this.redis.client
      .multi()
      .set(this.keys.commandRecord(command.id), JSON.stringify(command), 'EX', COMMAND_TTL_SEC)
      .set(this.keys.commandResult(command.id), JSON.stringify(pending), 'EX', COMMAND_TTL_SEC)
      .exec();

    const receivers = await this.redis.client.publish(
      this.keys.commandChannel(id),
      JSON.stringify(command),
    );
    if (receivers === 0) {
      const failed: RuntimeCommandResult = {
        id: command.id,
        status: 'failed',
        message: 'runtime.command.noReceiver',
        at: new Date().toISOString(),
      };
      await this.redis.client.set(
        this.keys.commandResult(command.id),
        JSON.stringify(failed),
        'EX',
        COMMAND_TTL_SEC,
      );
    }
    return this.getCommand(command.id);
  }

  public async getCommand(commandId: string): Promise<RuntimeCommandDto> {
    if (!this.redis.isReady()) throw new RuntimeTelemetryUnavailableException();
    const [rawCommand, rawResult] = await this.redis.client.mget(
      this.keys.commandRecord(commandId),
      this.keys.commandResult(commandId),
    );
    if (!rawCommand)
      throw new NotFoundAppException('runtime.error.commandNotFound', { id: commandId });

    const command = JSON.parse(rawCommand) as RuntimeCommand;
    const result: RuntimeCommandResult = rawResult
      ? (JSON.parse(rawResult) as RuntimeCommandResult)
      : { id: commandId, status: 'pending', at: command.requestedAt };

    return {
      id: command.id,
      runtime: command.runtime,
      action: command.action,
      requestedAt: command.requestedAt,
      status: result.status,
      ...(result.message ? { message: this.i18n.t(result.message) } : {}),
    };
  }
}
