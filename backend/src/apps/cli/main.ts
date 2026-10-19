import 'reflect-metadata';
import { bootstrapCli } from './bootstrap/cli.bootstrap.js';

void bootstrapCli().finally(() => {
  process.exit(process.exitCode ?? 0);
});
