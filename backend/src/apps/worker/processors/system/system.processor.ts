import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SystemProcessor {
  private readonly logger = new Logger(SystemProcessor.name);

  public async processJob(jobName: string, data: unknown): Promise<void> {
    this.logger.log(`Processing job "${jobName}" with data: ${JSON.stringify(data)}`);
  }
}
