import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'search_documents' })
@Index('uq_search_documents_key', ['documentKey'], { unique: true })
@Index('idx_search_documents_module_entity', ['module', 'entityCode', 'status'])
@Index('idx_search_documents_scope', ['organizationUnitId', 'ownerId'])
export class SearchDocumentEntity extends TypeOrmBaseEntity {
  @Column({ name: 'document_key', type: 'varchar', length: 190 })
  public documentKey!: string;

  @Column({ name: 'entity_code', type: 'varchar', length: 128 })
  public entityCode!: string;

  @Column({ name: 'module', type: 'varchar', length: 64 })
  public module!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 64 })
  public entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 128 })
  public entityId!: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  public title!: string;

  @Column({ name: 'subtitle', type: 'varchar', length: 255, nullable: true, default: null })
  public subtitle!: string | null;

  @Column({ name: 'keywords_json', type: 'text', nullable: true, default: null })
  public keywordsJson!: string | null;

  @Column({ name: 'searchable_text', type: 'text' })
  public searchableText!: string;

  @Column({ name: 'owner_id', type: 'int', nullable: true, default: null })
  public ownerId!: number | null;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true, default: null })
  public organizationUnitId!: number | null;

  @Column({ name: 'status', type: 'varchar', length: 32, nullable: true, default: null })
  public status!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true, default: null })
  public metadataJson!: string | null;

  @Column({ name: 'source_updated_at', type: 'timestamp' })
  public sourceUpdatedAt!: Date;

  @Column({ name: 'indexed_at', type: 'timestamp' })
  public indexedAt!: Date;
}
