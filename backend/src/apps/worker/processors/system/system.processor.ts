import { Injectable, Logger } from '@nestjs/common';
import type { MessageEnvelope } from '@packages/messaging/index.js';

@Injectable()
export class SystemProcessor {
  private readonly logger = new Logger(SystemProcessor.name);

  /**
   * Xử lý lặp lại an toàn (chỉ ghi log, không có tác dụng phụ) — trang Messaging hiện "Idempotent"
   * khi retry/replay. Processor có tác dụng phụ phải đặt `false` (hoặc `null` nếu chưa rõ).
   */
  public readonly idempotent: boolean | null = true;

  public async processJob(topic: string, envelope: MessageEnvelope): Promise<void> {
    this.logger.log(
      `Processing message "${topic}" (${envelope.id}) from ${envelope.producer ?? 'unknown'}`,
    );
  }
}
