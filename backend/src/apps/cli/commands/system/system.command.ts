import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SystemCommand {
  private readonly logger = new Logger(SystemCommand.name);

  public async execute(args: string[]): Promise<void> {
    this.logger.log(`Executing CLI command with args: ${args.join(', ')}`);
  }
}
