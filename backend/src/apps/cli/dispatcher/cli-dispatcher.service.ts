import { Injectable, Logger } from '@nestjs/common';

export interface CliCommandDescriptor {
  name: string;
  domain: string;
  description: string;
  usage: string;
  execute: (args: string[]) => Promise<void>;
}

export interface ICliCommandProvider {
  /** Lấy danh sách các lệnh CLI do provider này cung cấp */
  getCommands(): CliCommandDescriptor[];
}

@Injectable()
export class CliDispatcherService {
  private readonly logger = new Logger(CliDispatcherService.name);
  private readonly commands = new Map<string, CliCommandDescriptor>();

  /** Đăng ký một lệnh CLI đơn lẻ vào danh mục quản lý */
  public registerCommand(desc: CliCommandDescriptor): void {
    this.commands.set(desc.name, desc);
  }

  /** Đăng ký tất cả các lệnh từ một provider vào dispatcher */
  public registerProvider(provider: ICliCommandProvider): void {
    for (const cmd of provider.getCommands()) {
      this.registerCommand(cmd);
    }
  }

  /** Lấy thông tin mô tả và hàm thực thi của một lệnh theo tên */
  public getCommand(name: string): CliCommandDescriptor | undefined {
    return this.commands.get(name);
  }

  /** Lấy toàn bộ danh sách các lệnh CLI đã được đăng ký */
  public getAllCommands(): CliCommandDescriptor[] {
    return Array.from(this.commands.values());
  }

  /** Phân tích đối số dòng lệnh và chuyển tiếp thực thi đến lệnh tương ứng */
  public async dispatch(args: string[]): Promise<void> {
    const commandName = args[0] ?? 'help';
    const restArgs = args.slice(1);

    if (commandName === 'help' || commandName === '--help' || commandName === '-h') {
      this.printHelp();
      return;
    }

    const command = this.getCommand(commandName);
    if (!command) {
      this.logger.error(
        `Unknown command "${commandName}". Run "help" to list all available commands.`,
      );
      this.printHelp();
      throw new Error(`Command "${commandName}" not found.`);
    }

    await command.execute(restArgs);
  }

  /** In ra bảng hướng dẫn sử dụng toàn bộ danh mục lệnh CLI theo từng nhóm domain */
  public printHelp(): void {
    const list = this.getAllCommands();
    const grouped = new Map<string, CliCommandDescriptor[]>();

    for (const cmd of list) {
      const items = grouped.get(cmd.domain) ?? [];
      items.push(cmd);
      grouped.set(cmd.domain, items);
    }

    console.log('\n======================================================');
    console.log('       Core Framework CLI Management Console         ');
    console.log('======================================================\n');
    console.log('Usage: npm run cli -- <command> [arguments] [options]\n');

    for (const [domain, cmds] of grouped.entries()) {
      console.log(`[${domain.toUpperCase()}]`);
      for (const c of cmds) {
        console.log(`  ${c.name.padEnd(24)} ${c.description}`);
        console.log(`    Usage: ${c.usage}`);
      }
      console.log('');
    }

    console.log('[GENERAL]');
    console.log(`  ${'help'.padEnd(24)} Display this help guide`);
    console.log('    Usage: npm run cli -- help\n');
  }
}
