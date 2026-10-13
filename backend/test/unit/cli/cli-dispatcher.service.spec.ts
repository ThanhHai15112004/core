import { describe, it, expect, jest } from '@jest/globals';
import { CliDispatcherService, type ICliCommandProvider } from '../../../src/apps/cli/dispatcher/cli-dispatcher.service.js';

describe('CliDispatcherService', () => {
  /** Kiểm thử việc đăng ký provider và phân phối đối số đến lệnh tương ứng */
  it('registers commands and dispatches correctly', async () => {
    const dispatcher = new CliDispatcherService();
    const executed: string[][] = [];

    const mockProvider: ICliCommandProvider = {
      getCommands: () => [
        {
          name: 'test:cmd',
          domain: 'Testing',
          description: 'A test command',
          usage: 'npm run cli -- test:cmd [arg1]',
          execute: async (args) => {
            executed.push(args);
          },
        },
      ],
    };

    dispatcher.registerProvider(mockProvider);

    expect(dispatcher.getCommand('test:cmd')).toBeDefined();
    expect(dispatcher.getCommand('test:cmd')?.domain).toBe('Testing');

    await dispatcher.dispatch(['test:cmd', 'arg-1', 'arg-2']);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toEqual(['arg-1', 'arg-2']);
  });

  /** Kiểm thử việc in bảng hướng dẫn help khi nhận tham số help */
  it('prints help when command is help or --help', async () => {
    const dispatcher = new CliDispatcherService();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await dispatcher.dispatch(['help']);
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });

  /** Kiểm thử việc ném lỗi khi gặp lệnh không tồn tại */
  it('throws error on unknown command', async () => {
    const dispatcher = new CliDispatcherService();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(dispatcher.dispatch(['unknown:command'])).rejects.toThrow('Command "unknown:command" not found.');
  });
});
