import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'search_zero_result_keywords' })
@Index('uq_search_zero_result_keyword_key', ['keywordKey'], { unique: true })
@Index('idx_search_zero_result_count', ['module', 'searchCount'])
export class SearchZeroResultKeywordEntity extends TypeOrmBaseEntity {
  @Column({ name: 'keyword_key', type: 'varchar', length: 255 })
  public keywordKey!: string;

  @Column({ name: 'keyword', type: 'varchar', length: 200 })
  public keyword!: string;

  @Column({ name: 'normalized_keyword', type: 'varchar', length: 200 })
  public normalizedKeyword!: string;

  @Column({ name: 'module', type: 'varchar', length: 64, nullable: true, default: null })
  public module!: string | null;

  @Column({ name: 'entity_type', type: 'varchar', length: 64, nullable: true, default: null })
  public entityType!: string | null;

  @Column({ name: 'search_count', type: 'int', default: 1 })
  public searchCount!: number;

  @Column({ name: 'first_searched_at', type: 'timestamp' })
  public firstSearchedAt!: Date;

  @Column({ name: 'last_searched_at', type: 'timestamp' })
  public lastSearchedAt!: Date;

  @Column({ name: 'last_actor_id', type: 'int', nullable: true, default: null })
  public lastActorId!: number | null;
}
