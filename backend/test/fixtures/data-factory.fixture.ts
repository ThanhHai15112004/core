import type { TokenPayload, UserIdentity } from '@packages/security/index.js';

/**
 * Giao diện Persister trừu tượng (tương thích với TypeORM Repository, BaseTypeOrmRepository hoặc hàm callback).
 */
export type FactoryPersister<T> = { save: (entity: T) => Promise<T> } | ((entity: T) => Promise<T>);

export type FactoryStateResolver<T> = Partial<T> | ((seq: number, base: T) => Partial<T>);

/**
 * Generic Data Factory dùng chung cho Unit, Integration và API E2E tests.
 * Hỗ trợ sequence tự tăng (deterministic), state/trait bất biến, và persist qua Repository.
 */
export class DataFactory<T extends object> {
  private sequence = 0;

  constructor(
    private readonly definition: (seq: number) => T,
    private readonly states: readonly FactoryStateResolver<T>[] = [],
  ) {}

  /** Đặt lại bộ đếm sequence về 0 (hữu ích trong `beforeEach`) */
  public resetSequence(): void {
    this.sequence = 0;
  }

  /** Tạo một bản sao Factory mới gắn thêm trạng thái biến thể (immutable state/trait) */
  public state(resolver: FactoryStateResolver<T>): DataFactory<T> {
    return new DataFactory<T>(this.definition, [...this.states, resolver]);
  }

  /** Sinh 1 đối tượng trong bộ nhớ (in-memory) với các thuộc tính ghi đè tùy chọn */
  public build(overrides?: Partial<T>): T {
    this.sequence += 1;
    const seq = this.sequence;
    let instance = { ...this.definition(seq) };

    for (const stateResolver of this.states) {
      const statePatch =
        typeof stateResolver === 'function' ? stateResolver(seq, instance) : stateResolver;
      instance = { ...instance, ...statePatch };
    }

    if (overrides) {
      instance = { ...instance, ...overrides };
    }

    return instance;
  }

  /** Sinh danh sách `count` đối tượng trong bộ nhớ */
  public buildMany(count: number, overrides?: Partial<T>): T[] {
    const items: T[] = [];
    for (let i = 0; i < count; i++) {
      items.push(this.build(overrides));
    }
    return items;
  }

  /** Sinh và lưu 1 đối tượng thông qua Repository hoặc hàm persister */
  public async create(persister: FactoryPersister<T>, overrides?: Partial<T>): Promise<T> {
    const entity = this.build(overrides);
    if (typeof persister === 'function') {
      return persister(entity);
    }
    return persister.save(entity);
  }

  /** Sinh và lưu `count` đối tượng thông qua Repository hoặc hàm persister */
  public async createMany(
    persister: FactoryPersister<T>,
    count: number,
    overrides?: Partial<T>,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      results.push(await this.create(persister, overrides));
    }
    return results;
  }
}

/**
 * Helper khởi tạo một DataFactory định kiểu mạnh.
 */
export function defineFactory<T extends object>(builder: (seq: number) => T): DataFactory<T> {
  return new DataFactory<T>(builder);
}

/**
 * Factory chuẩn tạo UserIdentity phục vụ kiểm thử xác thực & phân quyền.
 */
export const userIdentityFactory = defineFactory<UserIdentity>((seq) => ({
  id: seq,
  email: `user${seq}@test.local`,
  roles: ['user'],
  permissions: [],
}));

/**
 * Factory chuẩn tạo TokenPayload JWT phục vụ kiểm thử bảo mật.
 */
export const tokenPayloadFactory = defineFactory<TokenPayload>((seq) => ({
  sub: seq,
  roles: ['user'],
}));

/**
 * Fixture tạo tham số truy vấn phân trang chuẩn (Pagination Query Fixture).
 */
export function createPaginationQueryFixture(
  overrides?: Partial<{ page: number; limit: number; sort: string; search: string }>,
): { page: number; limit: number; sort?: string; search?: string } {
  return {
    page: overrides?.page ?? 1,
    limit: overrides?.limit ?? 20,
    ...(overrides?.sort ? { sort: overrides.sort } : {}),
    ...(overrides?.search ? { search: overrides.search } : {}),
  };
}
