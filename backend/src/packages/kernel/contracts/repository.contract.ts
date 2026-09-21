import type { BaseEntity } from '../base/base.entity.js';

export interface RepositoryContract<TEntity extends BaseEntity<TId>, TId = string> {
  findById(id: TId): Promise<TEntity | null>;
  save(entity: TEntity): Promise<void>;
  delete(id: TId): Promise<void>;
}
