import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'scim_group_members' })
@Index('UQ_scim_group_members_group_user', ['scimGroupId', 'userId'], { unique: true })
@Index('IDX_scim_group_members_client_user', ['clientId', 'userId'])
export class ScimGroupMemberEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'client_id', type: 'int' })
  public clientId!: number;

  @Column({ name: 'scim_group_id', type: 'int' })
  public scimGroupId!: number;

  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;
}
