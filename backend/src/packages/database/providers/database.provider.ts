import { Injectable } from '@nestjs/common';
import type { DatabaseConnectionContract } from '../contracts/database.contract.js';
import { DatabaseConnectionService } from './database-connection.service.js';

/** Hợp đồng kết nối cũ, nay đọc trạng thái thật từ `DatabaseConnectionService` (không còn cờ giả). */
@Injectable()
export class BaseDatabaseProvider implements DatabaseConnectionContract {
  constructor(private readonly connection: DatabaseConnectionService) {}

  public async connect(): Promise<void> {
    // Kết nối được mở nền lúc khởi động (có retry) — xem DatabaseConnectionService.
  }

  public async disconnect(): Promise<void> {
    // TypeOrmModule tự đóng DataSource khi app tắt.
  }

  public isConnected(): boolean {
    return this.connection.isConnected();
  }

  public async ping(): Promise<boolean> {
    return (await this.connection.ping()).ok;
  }
}
