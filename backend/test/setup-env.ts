import os from 'node:os';
import path from 'node:path';

/**
 * Chạy trước mọi file test (trước khi `.env.test` được nạp — loader không ghi đè biến đã có):
 * storage local của test nằm trong thư mục tạm của hệ điều hành, không bao giờ ghi vào repo.
 */
process.env['STORAGE_LOCAL_PATH'] ??= path.join(os.tmpdir(), `core-test-storage-${process.pid}`);

/**
 * RedisService trong test dùng ioredis-mock, nhưng BullMQ (messaging) tự mở kết nối theo REDIS_HOST/PORT.
 * Trỏ tới một cổng đóng để test không bao giờ chạm Redis thật (dùng chung với project khác) và broker
 * luôn ở trạng thái "không khả dụng" — kết quả test không phụ thuộc máy chạy.
 */
process.env['REDIS_PORT'] ??= '1';
