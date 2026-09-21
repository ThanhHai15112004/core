export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');

export interface SecretProvider {
  /**
   * Lấy giá trị bí mật theo key.
   * Trả về null nếu key không tồn tại trong kho bí mật.
   */
  getSecret(key: string): Promise<string | null>;

  /**
   * Lấy danh sách bí mật theo tiền tố (tùy chọn)
   */
  getSecretsByPrefix?(prefix: string): Promise<Record<string, string>>;
}
