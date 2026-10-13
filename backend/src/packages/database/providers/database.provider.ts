import { Injectable } from '@nestjs/common';
import type { DatabaseConnectionContract } from '../contracts/database.contract.js';
import { DatabaseConnectionService } from './database-connection.service.js';

/** Hợp đồng kết nối cũ, nay đọc trạng thái thật từ `DatabaseConnectionService` (không còn cờ giả). */
@Injectable()
export class BaseDatabaseProvider implements DatabaseConnectionContract {
  constructor(private readonly connection: DatabaseConnectionService) {}

  /** Khởi tạo và thiết lập kết nối tới dịch vụ bên ngoài */
  public async connect(): Promise<void> {
    // Kết nối được mở nền lúc khởi động (có retry) — xem DatabaseConnectionService.
  }

  /** Đóng và ngắt kết nối an toàn tới dịch vụ bên ngoài */
  public async disconnect(): Promise<void> {
    // TypeOrmModule tự đóng DataSource khi app tắt.
  }

  /** Kiểm tra xem kết nối hiện tại có đang hoạt động hay không */
  public isConnected(): boolean {
    return this.connection.isConnected();
  }

  /** Kiểm tra trạng thái sẵn sàng và đo độ trễ kết nối */
  public async ping(): Promise<boolean> {
    return (await this.connection.ping()).ok;
  }
}
