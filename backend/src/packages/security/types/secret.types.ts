export type SecretDriver = 'env' | 'file' | 'vault' | 'custom';

export interface SecretOptions {
  /**
   * Thời gian sống của cache bí mật trong bộ nhớ (mili-giây).
   * Mặc định: 60_000 (1 phút). Đặt 0 để vô hiệu hoá cache.
   */
  cacheTtlMs?: number;

  /**
   * Thư mục chứa các file bí mật độc lập khi sử dụng driver 'file'.
   * Mặc định: '/run/secrets' hoặc './secrets'.
   */
  secretDir?: string;
}
