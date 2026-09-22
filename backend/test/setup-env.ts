import os from 'node:os';
import path from 'node:path';

/**
 * Chạy trước mọi file test (trước khi `.env.test` được nạp — loader không ghi đè biến đã có):
 * storage local của test nằm trong thư mục tạm của hệ điều hành, không bao giờ ghi vào repo.
 */
process.env['STORAGE_LOCAL_PATH'] ??= path.join(os.tmpdir(), `core-test-storage-${process.pid}`);
