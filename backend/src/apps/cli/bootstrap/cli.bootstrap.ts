import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CliModule } from '../cli.module.js';
import { SystemCommand } from '../commands/system/system.command.js';

export async function bootstrapCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const logger = new Logger('CliBootstrap');
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] });

  try {
    const cmd = app.get(SystemCommand);
    await cmd.execute(args);
  } catch (error) {
    logger.error('CLI Command execution failed:', error instanceof Error ? error.stack : error);
    process.exit(1);
  } finally {
    await app.close();
  }
}
