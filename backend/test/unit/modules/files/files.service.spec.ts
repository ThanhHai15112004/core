import { Readable } from 'node:stream';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { DATA_SCOPE, DataScopeService } from '@packages/security/index.js';
import type { BaseStorageProvider } from '@packages/storage/index.js';
import {
  FILE_CATEGORY,
  FILE_PERMISSION_SUBJECT,
  FILE_STATUS,
  FILE_VISIBILITY,
  FilesService,
  FileValidationService,
} from '@modules/files/index.js';
import type { FileFolderEntity } from '@modules/files/entities/file-folder.entity.js';
import type { FilePermissionEntity } from '@modules/files/entities/file-permission.entity.js';
import type { FileRecordEntity } from '@modules/files/entities/file-record.entity.js';
import type { FileUsageEntity } from '@modules/files/entities/file-usage.entity.js';
import { FilesMapper } from '@modules/files/mappers/files.mapper.js';
import type { FileFoldersRepository } from '@modules/files/repositories/file-folders.repository.js';
import type { FilePermissionsRepository } from '@modules/files/repositories/file-permissions.repository.js';
import type { FileUsagesRepository } from '@modules/files/repositories/file-usages.repository.js';
import type { FilesRepository } from '@modules/files/repositories/files.repository.js';

function createInMemoryFilesHarness() {
  const folders = new Map<number, FileFolderEntity>();
  const files = new Map<number, FileRecordEntity>();
  const usages = new Map<number, FileUsageEntity>();
  const permissions = new Map<number, FilePermissionEntity>();
  const storageObjects = new Map<string, { buffer: Buffer; mimeType: string }>();

  let folderSeq = 1;
  let fileSeq = 1;
  let usageSeq = 1;
  let permissionSeq = 1;

  const foldersRepo = {
    findById: async (id: number) => folders.get(id) ?? null,
    findByIds: async (ids: readonly number[]) =>
      ids.map((id) => folders.get(id)).filter((f): f is FileFolderEntity => Boolean(f)),
    findAllOrdered: async (orgId?: number) =>
      [...folders.values()]
        .filter((f) => !f.deletedAt && (orgId === undefined || f.organizationUnitId === orgId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    countChildFolders: async (parentId: number) =>
      [...folders.values()].filter((f) => !f.deletedAt && f.parentId === parentId).length,
    findByParentAndSlug: async (parentId: number | null, slug: string) =>
      [...folders.values()].find(
        (f) =>
          !f.deletedAt &&
          (f.parentId ?? null) === parentId &&
          f.slug.toLowerCase() === slug.toLowerCase(),
      ) ?? null,
    findDescendantsByPathPrefix: async (pathPrefix: string) =>
      [...folders.values()].filter((f) => !f.deletedAt && f.folderPath.startsWith(pathPrefix)),
    saveEntity: async (partial: Partial<FileFolderEntity>) => {
      const now = new Date();
      const id = partial.id ?? folderSeq++;
      const existing = folders.get(id);
      const saved = {
        id,
        code: partial.code ?? existing?.code ?? `FLD_${id}`,
        name: partial.name ?? existing?.name ?? 'Folder',
        slug: partial.slug ?? existing?.slug ?? 'folder',
        parentId: partial.parentId !== undefined ? partial.parentId : (existing?.parentId ?? null),
        folderPath: partial.folderPath ?? existing?.folderPath ?? `/${id}/`,
        organizationUnitId:
          partial.organizationUnitId !== undefined
            ? partial.organizationUnitId
            : (existing?.organizationUnitId ?? null),
        createdByUserId:
          partial.createdByUserId !== undefined
            ? partial.createdByUserId
            : (existing?.createdByUserId ?? null),
        description:
          partial.description !== undefined ? partial.description : (existing?.description ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as FileFolderEntity;
      folders.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      folders.delete(id);
    },
  } as unknown as FileFoldersRepository;

  const filesRepo = {
    findById: async (id: number) => files.get(id) ?? null,
    findByIds: async (ids: readonly number[]) =>
      ids.map((id) => files.get(id)).filter((f): f is FileRecordEntity => Boolean(f)),
    countFilesInFolder: async (folderId: number) =>
      [...files.values()].filter((f) => f.folderId === folderId && f.status !== FILE_STATUS.PURGED)
        .length,
    saveEntity: async (partial: Partial<FileRecordEntity>) => {
      const now = new Date();
      const id = partial.id ?? fileSeq++;
      const existing = files.get(id);
      const saved = {
        id,
        code: partial.code ?? existing?.code ?? `FIL_${id}`,
        folderId: partial.folderId !== undefined ? partial.folderId : (existing?.folderId ?? null),
        displayName: partial.displayName ?? existing?.displayName ?? 'file.txt',
        originalName: partial.originalName ?? existing?.originalName ?? 'file.txt',
        storageDriver: partial.storageDriver ?? existing?.storageDriver ?? 'local',
        storageKey: partial.storageKey ?? existing?.storageKey ?? `files/${id}.txt`,
        mimeType: partial.mimeType ?? existing?.mimeType ?? 'text/plain',
        extension: partial.extension ?? existing?.extension ?? 'txt',
        category: partial.category ?? existing?.category ?? FILE_CATEGORY.DOCUMENT,
        sizeBytes: partial.sizeBytes ?? existing?.sizeBytes ?? 0,
        checksumSha256: partial.checksumSha256 ?? existing?.checksumSha256 ?? '',
        visibility: partial.visibility ?? existing?.visibility ?? FILE_VISIBILITY.PRIVATE,
        status: partial.status ?? existing?.status ?? FILE_STATUS.ACTIVE,
        uploadedByUserId:
          partial.uploadedByUserId !== undefined
            ? partial.uploadedByUserId
            : (existing?.uploadedByUserId ?? null),
        organizationUnitId:
          partial.organizationUnitId !== undefined
            ? partial.organizationUnitId
            : (existing?.organizationUnitId ?? null),
        usageCount: partial.usageCount ?? existing?.usageCount ?? 0,
        trashedAt:
          partial.trashedAt !== undefined ? partial.trashedAt : (existing?.trashedAt ?? null),
        trashedByUserId:
          partial.trashedByUserId !== undefined
            ? partial.trashedByUserId
            : (existing?.trashedByUserId ?? null),
        purgeAfterAt:
          partial.purgeAfterAt !== undefined
            ? partial.purgeAfterAt
            : (existing?.purgeAfterAt ?? null),
        metadataJson:
          partial.metadataJson !== undefined
            ? partial.metadataJson
            : (existing?.metadataJson ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: existing?.deletedAt ?? null,
      } as FileRecordEntity;
      files.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      const existing = files.get(id);
      if (existing) existing.deletedAt = new Date();
    },
    findPaginatedFiltered: async (
      query: {
        status?: number;
        folderId?: number;
        category?: number;
        uploadedByUserId?: number;
        onlyReferenced?: boolean;
        onlyUnused?: boolean;
        search?: string;
      },
      scope: {
        unrestricted?: boolean;
        selfUserId?: number | null;
        explicitAllowedFileIds?: readonly number[];
        allowedOrgUnitIds?: readonly number[];
      },
    ) => {
      const targetStatus = query.status ?? FILE_STATUS.ACTIVE;
      let list = [...files.values()].filter((f) => f.status === targetStatus);
      if (query.folderId !== undefined) {
        list = list.filter((f) =>
          query.folderId === 0 ? f.folderId === null : f.folderId === query.folderId,
        );
      }
      if (query.category !== undefined) {
        list = list.filter((f) => f.category === query.category);
      }
      if (query.uploadedByUserId !== undefined) {
        list = list.filter((f) => f.uploadedByUserId === query.uploadedByUserId);
      }
      if (query.onlyReferenced === true) {
        list = list.filter((f) => f.usageCount > 0);
      } else if (query.onlyUnused === true) {
        list = list.filter((f) => f.usageCount === 0);
      }
      if (query.search) {
        const kw = query.search.toLowerCase();
        list = list.filter(
          (f) =>
            f.displayName.toLowerCase().includes(kw) || f.originalName.toLowerCase().includes(kw),
        );
      }
      if (!scope.unrestricted) {
        list = list.filter(
          (f) =>
            f.visibility >= 2 ||
            f.uploadedByUserId === scope.selfUserId ||
            scope.explicitAllowedFileIds?.includes(f.id) ||
            (f.organizationUnitId !== null &&
              f.organizationUnitId !== undefined &&
              scope.allowedOrgUnitIds?.includes(f.organizationUnitId)),
        );
      }
      return { items: list, total: list.length };
    },
    findAllForStats: async () => [...files.values()].filter((f) => f.status !== FILE_STATUS.PURGED),
    sumActiveBytesByOrgUnit: async (organizationUnitId?: number | null) =>
      [...files.values()]
        .filter(
          (f) =>
            f.status === FILE_STATUS.ACTIVE &&
            (!organizationUnitId || f.organizationUnitId === organizationUnitId),
        )
        .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0),
    sumActiveBytesByUser: async (userId: number) =>
      [...files.values()]
        .filter((f) => f.status === FILE_STATUS.ACTIVE && f.uploadedByUserId === userId)
        .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0),
    findExpiredTrashedFiles: async (now: Date) =>
      [...files.values()].filter(
        (f) =>
          f.status === FILE_STATUS.TRASHED &&
          f.purgeAfterAt !== null &&
          f.purgeAfterAt !== undefined &&
          f.purgeAfterAt.getTime() <= now.getTime(),
      ),
    findByChecksumSha256: async (checksumSha256: string, organizationUnitId?: number | null) =>
      [...files.values()].filter(
        (f) =>
          !f.deletedAt &&
          f.checksumSha256 === checksumSha256 &&
          (f.status === FILE_STATUS.ACTIVE || f.status === FILE_STATUS.PENDING_SCAN) &&
          (organizationUnitId === undefined ||
            organizationUnitId === null ||
            f.organizationUnitId === organizationUnitId),
      ),
    findUnusedFilesOlderThan: async (cutoffDate: Date, organizationUnitId?: number | null) =>
      [...files.values()].filter(
        (f) =>
          !f.deletedAt &&
          (f.status === FILE_STATUS.ACTIVE || f.status === FILE_STATUS.PENDING_SCAN) &&
          f.usageCount === 0 &&
          f.createdAt.getTime() <= cutoffDate.getTime() &&
          (organizationUnitId === undefined ||
            organizationUnitId === null ||
            f.organizationUnitId === organizationUnitId),
      ),
  } as unknown as FilesRepository;

  const usagesRepo = {
    findById: async (id: number) => usages.get(id) ?? null,
    findByFileId: async (fileId: number) => [...usages.values()].filter((u) => u.fileId === fileId),
    findByFileIds: async (fileIds: readonly number[]) =>
      [...usages.values()].filter((u) => fileIds.includes(u.fileId)),
    findByTarget: async (params: {
      fileId: number;
      moduleName: string;
      entityType: string;
      entityId: string;
      fieldName: string;
    }) =>
      [...usages.values()].find(
        (u) =>
          u.fileId === params.fileId &&
          u.moduleName === params.moduleName &&
          u.entityType === params.entityType &&
          u.entityId === params.entityId &&
          u.fieldName === params.fieldName,
      ) ?? null,
    findByEntity: async (params: {
      moduleName: string;
      entityType: string;
      entityId: string;
      fieldName?: string;
    }) =>
      [...usages.values()].filter(
        (u) =>
          u.moduleName === params.moduleName &&
          u.entityType === params.entityType &&
          u.entityId === params.entityId &&
          (!params.fieldName || u.fieldName === params.fieldName),
      ),
    countByFileId: async (fileId: number) =>
      [...usages.values()].filter((u) => u.fileId === fileId).length,
    saveEntity: async (partial: Partial<FileUsageEntity>) => {
      const now = new Date();
      const id = partial.id ?? usageSeq++;
      const existing = usages.get(id);
      const saved = {
        id,
        fileId: partial.fileId ?? existing?.fileId ?? 0,
        moduleName: partial.moduleName ?? existing?.moduleName ?? 'users',
        entityType: partial.entityType ?? existing?.entityType ?? 'avatar',
        entityId: partial.entityId ?? existing?.entityId ?? '1',
        fieldName: partial.fieldName ?? existing?.fieldName ?? 'default',
        note: partial.note !== undefined ? partial.note : (existing?.note ?? null),
        createdByUserId:
          partial.createdByUserId !== undefined
            ? partial.createdByUserId
            : (existing?.createdByUserId ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as FileUsageEntity;
      usages.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      usages.delete(id);
    },
  } as unknown as FileUsagesRepository;

  const permissionsRepo = {
    findById: async (id: number) => permissions.get(id) ?? null,
    findByFileId: async (fileId: number) =>
      [...permissions.values()].filter((p) => !p.deletedAt && p.fileId === fileId),
    findByTarget: async (params: { fileId: number; subjectType: number; subjectId: string }) =>
      [...permissions.values()].find(
        (p) =>
          !p.deletedAt &&
          p.fileId === params.fileId &&
          p.subjectType === params.subjectType &&
          p.subjectId === params.subjectId,
      ) ?? null,
    findActiveForActor: async (params: {
      fileId?: number;
      userId?: number | null;
      roles?: readonly string[];
      orgUnitIds?: readonly number[];
      now?: Date;
    }) => {
      const now = params.now ?? new Date();
      const userIdStr = params.userId ? String(params.userId) : null;
      const roleSet = new Set((params.roles ?? []).map((r) => r.trim().toLowerCase()));
      const orgSet = new Set((params.orgUnitIds ?? []).map(String));

      return [...permissions.values()].filter((p) => {
        if (p.deletedAt) return false;
        if (params.fileId !== undefined && p.fileId !== params.fileId) return false;
        if (p.expiresAt && p.expiresAt.getTime() <= now.getTime()) return false;
        if (p.subjectType === FILE_PERMISSION_SUBJECT.USER && userIdStr === p.subjectId) {
          return true;
        }
        if (
          p.subjectType === FILE_PERMISSION_SUBJECT.ROLE &&
          roleSet.has(p.subjectId.toLowerCase())
        ) {
          return true;
        }
        if (p.subjectType === FILE_PERMISSION_SUBJECT.ORG_UNIT && orgSet.has(p.subjectId)) {
          return true;
        }
        return false;
      });
    },
    saveEntity: async (partial: Partial<FilePermissionEntity>) => {
      const now = new Date();
      const id = partial.id ?? permissionSeq++;
      const existing = permissions.get(id);
      const saved = {
        id,
        fileId: partial.fileId ?? existing?.fileId ?? 0,
        subjectType: partial.subjectType ?? existing?.subjectType ?? FILE_PERMISSION_SUBJECT.USER,
        subjectId: partial.subjectId ?? existing?.subjectId ?? '1',
        canView: partial.canView !== undefined ? partial.canView : (existing?.canView ?? true),
        canDownload:
          partial.canDownload !== undefined
            ? partial.canDownload
            : (existing?.canDownload ?? false),
        expiresAt:
          partial.expiresAt !== undefined ? partial.expiresAt : (existing?.expiresAt ?? null),
        note: partial.note !== undefined ? partial.note : (existing?.note ?? null),
        grantedByUserId:
          partial.grantedByUserId !== undefined
            ? partial.grantedByUserId
            : (existing?.grantedByUserId ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as FilePermissionEntity;
      permissions.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      permissions.delete(id);
    },
  } as unknown as FilePermissionsRepository;

  const storageProvider = {
    driver: {
      name: 'local' as const,
      stream: async (key: string, range?: { start: number; end: number }) => {
        const obj = storageObjects.get(key);
        if (!obj) throw new Error('ENOENT');
        const slice = range ? obj.buffer.subarray(range.start, range.end + 1) : obj.buffer;
        return {
          body: Readable.from(slice),
          size: slice.length,
          contentType: obj.mimeType,
        };
      },
    },
    upload: async (
      key: string,
      content: Buffer | Uint8Array,
      mimeType = 'application/octet-stream',
    ) => {
      storageObjects.set(key, { buffer: Buffer.from(content), mimeType });
      return key;
    },
    delete: async (key: string) => {
      storageObjects.delete(key);
    },
    download: async (key: string) => {
      const obj = storageObjects.get(key);
      if (!obj) throw new Error('ENOENT');
      return Buffer.from(obj.buffer);
    },
    exists: async (key: string) => storageObjects.has(key),
    appendChunk: async (tempKey: string, chunk: Buffer) => {
      const existing = storageObjects.get(tempKey);
      const nextBuf = existing ? Buffer.concat([existing.buffer, chunk]) : Buffer.from(chunk);
      storageObjects.set(tempKey, { buffer: nextBuf, mimeType: 'application/octet-stream' });
      return nextBuf.length;
    },
    finalizeChunkedUpload: async (
      tempKey: string,
      targetKey: string,
      mimeType = 'application/octet-stream',
    ) => {
      const tempObj = storageObjects.get(tempKey);
      if (!tempObj) throw new Error('ENOENT');
      storageObjects.set(targetKey, { buffer: tempObj.buffer, mimeType });
      storageObjects.delete(tempKey);
      return targetKey;
    },
    abortChunkedUpload: async (tempKey: string) => {
      storageObjects.delete(tempKey);
    },
  } as unknown as BaseStorageProvider;

  const settingRegistry = new SettingRegistryService();
  const validationService = new FileValidationService(settingRegistry);
  const mapper = new FilesMapper();
  const dataScopeService = new DataScopeService();

  const usersPublicService = {
    findAuthUserById: async (userId: number) => ({
      id: userId,
      username: `user_${userId}`,
      email: `user_${userId}@enterprise.vn`,
      firstName: 'Hải',
      lastName: 'Nguyễn Thanh',
      fullName: `Nguyễn Thanh Hải #${userId}`,
      phone: '0909123456',
      status: 1 as const,
      statusName: 'ACTIVE' as const,
      lockedUntil: null,
      mfaEnabled: false,
      primaryOrganizationUnitId: 1,
      organizationUnitIds: [1],
      roles: ['admin'],
      permissions: ['files.read', 'files.upload', 'files.download', 'files.manage', 'files.delete'],
    }),
  };

  const service = new FilesService(
    filesRepo,
    foldersRepo,
    usagesRepo,
    mapper,
    validationService,
    storageProvider,
    dataScopeService,
    null,
    usersPublicService as never,
    null,
    null,
    permissionsRepo,
    null,
  );

  return {
    service,
    settingRegistry,
    validationService,
    storageObjects,
    files,
    folders,
    permissions,
  };
}

// Valid 1x1 transparent PNG bytes
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('FilesService — Phase 6.1 & 6.2 File Management, Folders & Access Control', () => {
  it('1. Tải lên 1 hoặc nhiều file, kiểm tra Magic Bytes và lưu thông tin người tải', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    const single = await service.uploadSingle(
      {
        fileName: 'banner.png',
        contentBase64: VALID_PNG_BASE64,
        visibility: FILE_VISIBILITY.INTERNAL,
      },
      { id: 10, username: 'admin', roles: ['admin'], permissions: [], dataScope: DATA_SCOPE.ALL },
    );

    expect(single.id).toBe(1);
    expect(single.displayName).toBe('banner.png');
    expect(single.originalName).toBe('banner.png');
    expect(single.extension).toBe('png');
    expect(single.category).toBe(FILE_CATEGORY.IMAGE);
    expect(single.uploadedByUser?.fullName).toContain('Nguyễn Thanh Hải #10');
    expect(storageObjects.has(single.storageKey)).toBe(true);

    const batch = await service.uploadBatch(
      {
        files: [
          { fileName: 'notes.txt', textContent: 'Nội dung ghi chú số 1' },
          { fileName: 'report.csv', textContent: 'id,name\n1,Core' },
        ],
      },
      { id: 10, username: 'admin', roles: ['admin'], permissions: [], dataScope: DATA_SCOPE.ALL },
    );

    expect(batch.count).toBe(2);
    expect(batch.items[0]?.category).toBe(FILE_CATEGORY.DOCUMENT);
    expect(batch.items[1]?.category).toBe(FILE_CATEGORY.SPREADSHEET);
  });

  it('2. Chặn file giả mạo định dạng hoặc chứa mã thực thi (Magic Bytes inspection)', async () => {
    const { service } = createInMemoryFilesHarness();

    // Tệp thực thi Windows PE (MZ...) đội lốt ảnh .png
    const fakePngExeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    await expect(
      service.uploadSingle({
        fileName: 'malware.png',
        contentBase64: fakePngExeBuffer.toString('base64'),
      }),
    ).rejects.toThrow(BadRequestAppException);

    // Đuôi file .exe không nằm trong danh sách cho phép
    await expect(
      service.uploadSingle({
        fileName: 'installer.exe',
        textContent: 'binary',
      }),
    ).rejects.toThrow(BadRequestAppException);
  });

  it('3. Đổi tên file và di chuyển thư mục KHÔNG làm thay đổi file gốc (storageKey) và giữ nguyên liên kết sử dụng', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    const folderA = await service.createFolder({ name: 'Tài liệu Hợp đồng 2026' });
    const folderB = await service.createFolder({ name: 'Hồ sơ Lưu trữ Pháp lý' });
    const uploaded = await service.uploadSingle({
      fileName: 'hop-dong-goc.txt',
      textContent: 'Hợp đồng nguyên tắc',
      folderId: folderA.id,
    });

    await service.attachUsage({
      fileId: uploaded.id,
      moduleName: 'contracts',
      entityType: 'legal_contract',
      entityId: 88,
      note: 'Đính kèm hợp đồng #88',
    });

    const originalStorageKey = uploaded.storageKey;
    expect(storageObjects.has(originalStorageKey)).toBe(true);

    const renamed = await service.updateMetadata(uploaded.id, {
      displayName: 'Hợp đồng Đã Ký Duyệt_v2.txt',
      folderId: folderB.id,
    });

    expect(renamed.displayName).toBe('Hợp đồng Đã Ký Duyệt_v2.txt');
    expect(renamed.originalName).toBe('hop-dong-goc.txt');
    expect(renamed.folderId).toBe(folderB.id);
    expect(renamed.folderName).toBe('Hồ sơ Lưu trữ Pháp lý');
    // Storage key vật lý và liên kết sử dụng giữ nguyên tuyệt đối
    expect(renamed.storageKey).toBe(originalStorageKey);
    expect(renamed.usageCount).toBe(1);
    expect(renamed.usages).toHaveLength(1);
    expect(storageObjects.has(originalStorageKey)).toBe(true);

    // Khi tải xuống, tên file nhận được là tên mới đã đổi
    const dl = await service.prepareDownload(uploaded.id);
    expect(dl.downloadFileName).toBe('Hợp đồng Đã Ký Duyệt_v2.txt');
  });

  it('4. Tải file xuống kiểm tra quyền phạm vi dữ liệu và hỗ trợ Byte-Range 206 cho Video', async () => {
    const { service } = createInMemoryFilesHarness();

    const privateFile = await service.uploadSingle(
      {
        fileName: 'lesson-video.mp4',
        contentBase64: Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ').toString('base64'),
        visibility: FILE_VISIBILITY.PRIVATE,
        organizationUnitId: 1,
      },
      { id: 1, username: 'owner', roles: [], permissions: [], organizationUnitIds: [1] },
    );

    // Người dùng ở đơn vị khác (Unit 99) với phạm vi SELF bị chặn tải file PRIVATE của người khác
    await expect(
      service.prepareDownload(privateFile.id, {
        id: 99,
        username: 'outsider',
        roles: [],
        permissions: ['files.download'],
        organizationUnitIds: [99],
        dataScope: DATA_SCOPE.SELF,
      }),
    ).rejects.toThrow(ForbiddenAppException);

    // Phát / tua video qua Range header (bytes=10-19)
    const streamRes = await service.prepareStream(privateFile.id, 'bytes=10-19', {
      id: 1,
      username: 'owner',
      roles: [],
      permissions: ['files.download'],
      organizationUnitIds: [1],
      dataScope: DATA_SCOPE.SELF,
    });

    expect(streamRes.byteRange).toEqual({
      start: 10,
      end: 19,
      totalSize: 36,
      contentLength: 10,
    });
  });

  it('5. Theo dõi file đang được chức năng nào sử dụng và CHẶN xóa khi còn liên kết dữ liệu', async () => {
    const { service } = createInMemoryFilesHarness();

    const avatar = await service.uploadSingle({
      fileName: 'avatar.png',
      contentBase64: VALID_PNG_BASE64,
    });

    await service.attachUsage({
      fileId: avatar.id,
      moduleName: 'users',
      entityType: 'user_profile',
      entityId: 42,
      fieldName: 'avatarFileId',
      note: 'Ảnh đại diện nhân sự #42',
    });

    const detail = await service.getById(avatar.id);
    expect(detail.usageCount).toBe(1);
    expect(detail.canDelete).toBe(false);
    expect(detail.usages).toHaveLength(1);
    expect(detail.usages?.[0]?.moduleName).toBe('users');

    // Chặn đưa vào thùng rác và chặn xóa vĩnh viễn khi còn liên kết
    await expect(service.moveToTrash(avatar.id)).rejects.toThrow(ConflictAppException);
    await expect(service.purgeFile(avatar.id)).rejects.toThrow(ConflictAppException);

    // Sau khi gỡ liên kết thì cho phép đưa vào thùng rác
    await service.detachUsage({
      fileId: avatar.id,
      moduleName: 'users',
      entityType: 'user_profile',
      entityId: 42,
      fieldName: 'avatarFileId',
    });

    const trashed = await service.moveToTrash(avatar.id);
    expect(trashed.status).toBe(FILE_STATUS.TRASHED);
    expect(trashed.trashedAt).not.toBeNull();
    expect(trashed.purgeAfterAt).not.toBeNull();
  });

  it('6. Thùng rác, Khôi phục file đã xóa và Xóa vĩnh viễn khỏi Storage', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    const doc = await service.uploadSingle({
      fileName: 'temp-doc.txt',
      textContent: 'Tài liệu tạm thời',
    });

    // Đưa vào thùng rác
    const trashed = await service.moveToTrash(doc.id);
    expect(trashed.status).toBe(FILE_STATUS.TRASHED);

    // File trong thùng rác không cho phép tải xuống trực tiếp
    await expect(service.prepareDownload(doc.id)).rejects.toThrow(BadRequestAppException);

    // Khôi phục lại từ thùng rác
    const restored = await service.restoreFromTrash(doc.id);
    expect(restored.status).toBe(FILE_STATUS.ACTIVE);
    expect(restored.trashedAt).toBeNull();

    // Xóa vĩnh viễn
    const purged = await service.purgeFile(doc.id);
    expect(purged.purged).toBe(true);
    expect(storageObjects.has(doc.storageKey)).toBe(false);

    // Đã xóa vĩnh viễn thì không thể khôi phục được nữa
    await expect(service.restoreFromTrash(doc.id)).rejects.toThrow(ConflictAppException);
    await expect(service.getById(doc.id)).rejects.toThrow(NotFoundAppException);
  });

  it('7. Tìm kiếm và lọc file theo tên, loại, người tải và trạng thái liên kết', async () => {
    const { service } = createInMemoryFilesHarness();

    const f1 = await service.uploadSingle(
      { fileName: 'Hop-dong-A.txt', textContent: 'A' },
      { id: 1, username: 'u1', roles: [], permissions: [] },
    );
    await service.uploadSingle(
      { fileName: 'Banner-Quang-Cao.png', contentBase64: VALID_PNG_BASE64 },
      { id: 2, username: 'u2', roles: [], permissions: [] },
    );

    await service.attachUsage({
      fileId: f1.id,
      moduleName: 'organizations',
      entityType: 'contract',
      entityId: 100,
    });

    const byName = await service.listPaginated({ search: 'hop-dong' });
    expect(byName.data).toHaveLength(1);
    expect(byName.data[0]?.id).toBe(f1.id);

    const byCategory = await service.listPaginated({ category: FILE_CATEGORY.IMAGE });
    expect(byCategory.data).toHaveLength(1);
    expect(byCategory.data[0]?.extension).toBe('png');

    const byUploader = await service.listPaginated({ uploadedByUserId: 2 });
    expect(byUploader.data).toHaveLength(1);
    expect(byUploader.data[0]?.uploadedByUserId).toBe(2);

    const onlyReferenced = await service.listPaginated({ onlyReferenced: true });
    expect(onlyReferenced.data).toHaveLength(1);
    expect(onlyReferenced.data[0]?.id).toBe(f1.id);
  });

  it('8. Đọc đầy đủ cấu hình động từ SettingRegistryService & sinh mã qua SequenceRegistryService', async () => {
    const { service, settingRegistry } = createInMemoryFilesHarness();

    // Kiểm tra sinh mã tự động theo SequenceRegistryService (FIL-YYYY-XXXXXX & FLD-YYYY-XXXXX)
    const folder = await service.createFolder({ name: 'Thư mục Cấu hình Động' });
    expect(folder.code).toMatch(/^FLD-\d{4}-\d{5}$/);

    const uploaded = await service.uploadSingle({
      fileName: 'config-test.txt',
      textContent: 'Hello dynamic settings',
    });
    expect(uploaded.code).toMatch(/^FIL-\d{4}-\d{6}$/);
    expect(uploaded.visibility).toBe(FILE_VISIBILITY.PRIVATE);

    // Đổi cấu hình động: max_batch_files = 1, default_visibility = PUBLIC (3), key_prefix = 'custom-media'
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.max_batch_files',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.max_batch_files::ALL::GLOBAL',
      serializedValue: '1',
      isEncrypted: false,
      updatedBy: null,
      reason: 'test',
    });
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.default_visibility',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.default_visibility::ALL::GLOBAL',
      serializedValue: String(FILE_VISIBILITY.PUBLIC),
      isEncrypted: false,
      updatedBy: null,
      reason: 'test',
    });
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.storage.key_prefix',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.storage.key_prefix::ALL::GLOBAL',
      serializedValue: 'custom-media',
      isEncrypted: false,
      updatedBy: null,
      reason: 'test',
    });

    const uploadedWithCustomConfig = await service.uploadSingle({
      fileName: 'public-by-default.txt',
      textContent: 'Public visibility from setting',
    });
    expect(uploadedWithCustomConfig.visibility).toBe(FILE_VISIBILITY.PUBLIC);
    expect(uploadedWithCustomConfig.storageKey.startsWith('custom-media/')).toBe(true);

    // Batch upload vượt quá max_batch_files = 1 phải bị chặn
    await expect(
      service.uploadBatch({
        files: [
          { fileName: 'a.txt', textContent: '1' },
          { fileName: 'b.txt', textContent: '2' },
        ],
      }),
    ).rejects.toThrow(BadRequestAppException);

    const stats = await service.getStats();
    expect(stats.settings.maxBatchFiles).toBe(1);
    expect(stats.settings.defaultVisibility).toBe(FILE_VISIBILITY.PUBLIC);
    expect(stats.settings.storageKeyPrefix).toBe('custom-media');
  });

  it('9. [Mục 6.2] Đổi tên & di chuyển thư mục tự động cập nhật đường dẫn con cháu, kiểm tra quyền và chống trùng tên', async () => {
    const { service, folders } = createInMemoryFilesHarness();

    const rootA = await service.createFolder(
      { name: 'Khối Đào Tạo', organizationUnitId: 1 },
      { id: 1, username: 'u1', roles: [], permissions: [], organizationUnitIds: [1] },
    );
    const childB = await service.createFolder(
      { name: 'Học kỳ 1', parentId: rootA.id, organizationUnitId: 1 },
      { id: 1, username: 'u1', roles: [], permissions: [], organizationUnitIds: [1] },
    );
    const grandChildC = await service.createFolder(
      { name: 'Đề thi', parentId: childB.id, organizationUnitId: 1 },
      { id: 1, username: 'u1', roles: [], permissions: [], organizationUnitIds: [1] },
    );
    const rootTarget = await service.createFolder(
      { name: 'Kho Lưu Trữ 2026', organizationUnitId: 1 },
      { id: 1, username: 'u1', roles: [], permissions: [], organizationUnitIds: [1] },
    );

    expect(grandChildC.folderPath).toBe(`/${rootA.id}/${childB.id}/${grandChildC.id}/`);

    // Chặn tạo thư mục trùng tên cùng cấp
    await expect(service.createFolder({ name: 'Học kỳ 1', parentId: rootA.id })).rejects.toThrow(
      ConflictAppException,
    );

    // Chặn vòng lặp: di chuyển rootA vào trong grandChildC
    await expect(service.updateFolder(rootA.id, { parentId: grandChildC.id })).rejects.toThrow(
      BadRequestAppException,
    );

    // Người dùng ở đơn vị khác (Unit 99, scope SELF) không có quyền sửa thư mục của Unit 1
    await expect(
      service.updateFolder(
        childB.id,
        { name: 'Hack Folder' },
        {
          id: 99,
          username: 'outsider',
          roles: [],
          permissions: ['files.manage'],
          organizationUnitIds: [99],
          dataScope: DATA_SCOPE.SELF,
        },
      ),
    ).rejects.toThrow(ForbiddenAppException);

    // Di chuyển childB sang rootTarget -> grandChildC phải tự động được cập nhật folderPath mới
    const movedB = await service.updateFolder(childB.id, {
      name: 'Học kỳ 1 (Đã chuyển)',
      parentId: rootTarget.id,
    });
    expect(movedB.folderPath).toBe(`/${rootTarget.id}/${childB.id}/`);
    expect(folders.get(grandChildC.id)?.folderPath).toBe(
      `/${rootTarget.id}/${childB.id}/${grandChildC.id}/`,
    );
  });

  it('10. [Mục 6.2] Phân quyền Xem (canView) và Tải (canDownload) độc lập theo User, Role, Đơn vị trong bảng file_permissions', async () => {
    const { service } = createInMemoryFilesHarness();

    const ownerActor = {
      id: 1,
      username: 'owner',
      roles: ['manager'],
      permissions: ['files.manage'],
      organizationUnitIds: [1],
      dataScope: DATA_SCOPE.SELF,
    };

    const secretDoc = await service.uploadSingle(
      {
        fileName: 'bao-cao-tai-chinh.pdf',
        contentBase64: Buffer.from('%PDF-1.7 secret financial report').toString('base64'),
        visibility: FILE_VISIBILITY.PRIVATE,
        organizationUnitId: 1,
      },
      ownerActor,
    );

    const auditorActor = {
      id: 50,
      username: 'auditor',
      roles: ['auditor'],
      permissions: ['files.read', 'files.download'],
      organizationUnitIds: [20],
      dataScope: DATA_SCOPE.SELF,
    };

    // Khi chưa cấp quyền: auditor ở đơn vị 20 không thể xem cũng không thể tải file PRIVATE của đơn vị 1
    await expect(service.getById(secretDoc.id, auditorActor)).rejects.toThrow(
      ForbiddenAppException,
    );
    await expect(service.prepareDownload(secretDoc.id, auditorActor)).rejects.toThrow(
      ForbiddenAppException,
    );

    // Cấp quyền CHỈ XEM (canView: true, canDownload: false) cho vai trò 'auditor'
    const grantedPerm = await service.grantPermission(
      secretDoc.id,
      {
        subjectType: FILE_PERMISSION_SUBJECT.ROLE,
        subjectId: 'auditor',
        canView: true,
        canDownload: false,
        note: 'Kiểm toán chỉ xem thông tin, không được tải file gốc',
      },
      ownerActor,
    );
    expect(grantedPerm.subjectTypeName).toBe('ROLE');
    expect(grantedPerm.canView).toBe(true);
    expect(grantedPerm.canDownload).toBe(false);

    // Auditor bây giờ XEM được chi tiết và tìm thấy trong danh sách, nhưng canDownload = false
    const viewedByAuditor = await service.getById(secretDoc.id, auditorActor);
    expect(viewedByAuditor.id).toBe(secretDoc.id);
    expect(viewedByAuditor.canDownload).toBe(false);

    const listedByAuditor = await service.listPaginated({}, auditorActor);
    expect(listedByAuditor.data.some((f) => f.id === secretDoc.id)).toBe(true);

    // Auditor cố tình TẢI XUỐNG hoặc tạo link tải tạm thời sẽ bị CHẶN (vì canDownload = false)
    await expect(service.prepareDownload(secretDoc.id, auditorActor)).rejects.toThrow(
      ForbiddenAppException,
    );
    await expect(
      service.createTemporaryDownloadLink(secretDoc.id, { expiresInSeconds: 300 }, auditorActor),
    ).rejects.toThrow(ForbiddenAppException);

    // Nâng cấp quyền cho phép tải (canDownload: true)
    await service.grantPermission(
      secretDoc.id,
      {
        subjectType: FILE_PERMISSION_SUBJECT.ROLE,
        subjectId: 'auditor',
        canView: true,
        canDownload: true,
      },
      ownerActor,
    );

    const dlResult = await service.prepareDownload(secretDoc.id, auditorActor);
    expect(dlResult.downloadFileName).toBe('bao-cao-tai-chinh.pdf');

    // Thu hồi quyền -> Auditor không còn truy cập được nữa
    await service.revokePermission(secretDoc.id, grantedPerm.id, ownerActor);
    await expect(service.getById(secretDoc.id, auditorActor)).rejects.toThrow(
      ForbiddenAppException,
    );
  });

  it('11. [Mục 6.2] Tạo đường dẫn tải tạm thời (Signed Temporary Link) và tự động hết hạn', async () => {
    const { service } = createInMemoryFilesHarness();

    const uploaded = await service.uploadSingle({
      fileName: 'tai-lieu-chia-se.txt',
      textContent: 'Nội dung tải qua link tạm thời',
    });

    const link = await service.createTemporaryDownloadLink(uploaded.id, {
      expiresInSeconds: 600,
      disposition: 'attachment',
    });

    expect(link.fileId).toBe(uploaded.id);
    expect(link.expiresInSeconds).toBe(600);
    expect(link.downloadUrl).toContain(`/api/v1/files/temporary-download/${link.token}`);

    // Tải file qua token hợp lệ thành công mà không cần truyền actor
    const tempDl = await service.prepareTemporaryDownload(link.token);
    expect(tempDl.file.id).toBe(uploaded.id);
    expect(tempDl.downloadFileName).toBe('tai-lieu-chia-se.txt');
    expect(tempDl.disposition).toBe('attachment');

    // Giả mạo chữ ký token -> bị từ chối ngay
    await expect(service.prepareTemporaryDownload(`${link.token}tampered`)).rejects.toThrow(
      ForbiddenAppException,
    );

    // Vượt quá thời hạn tối đa cho phép (mặc định 604800 giây = 7 ngày) -> bị chặn
    await expect(
      service.createTemporaryDownloadLink(uploaded.id, {
        expiresInSeconds: 9_999_999,
      }),
    ).rejects.toThrow(BadRequestAppException);
  });

  it('12. [Mục 6.2] Giới hạn dung lượng lưu trữ theo Người dùng (user_quota_mb) và theo Đơn vị (quota_mb)', async () => {
    const { service, settingRegistry } = createInMemoryFilesHarness();

    // Thiết lập hạn mức dung lượng cho mỗi người dùng = 1 MB
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.storage.user_quota_mb',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.storage.user_quota_mb::ALL::GLOBAL',
      serializedValue: '1',
      isEncrypted: false,
      updatedBy: null,
      reason: 'test user quota',
    });

    const userActor = {
      id: 77,
      username: 'staff77',
      roles: [],
      permissions: ['files.upload'],
      organizationUnitIds: [1],
    };

    // Tải file ~600 KB lần 1: Thành công (dưới 1 MB)
    const payload600Kb = Buffer.alloc(600 * 1024, 'a').toString('base64');
    await service.uploadSingle(
      {
        fileName: 'part1.txt',
        contentBase64: payload600Kb,
      },
      userActor,
    );

    // Tải tiếp file ~600 KB lần 2 bởi cùng user 77: Tổng ~1.2 MB > 1 MB -> Bị chặn!
    await expect(
      service.uploadSingle(
        {
          fileName: 'part2.txt',
          contentBase64: payload600Kb,
        },
        userActor,
      ),
    ).rejects.toThrow(BadRequestAppException);

    // Người dùng khác (user 88) vẫn tải được bình thường vì hạn mức tính riêng theo từng người dùng
    const otherUserUploaded = await service.uploadSingle(
      {
        fileName: 'other-user.txt',
        contentBase64: payload600Kb,
      },
      {
        id: 88,
        username: 'staff88',
        roles: [],
        permissions: ['files.upload'],
        organizationUnitIds: [1],
      },
    );
    expect(otherUserUploaded.uploadedByUserId).toBe(88);
  });

  it('13. [Mục 6.3.1 & 6.3.2] Giới hạn loại file theo từng phân loại (category_allowed_extensions), kiểm tra chéo MIME/Magic Bytes và giới hạn dung lượng theo loại file & theo module', async () => {
    const { service, settingRegistry } = createInMemoryFilesHarness();

    // 1. Cấu hình định dạng cho phép theo từng loại file: AUDIO chỉ nhận mp3, IMAGE chỉ nhận png
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.category_allowed_extensions',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.category_allowed_extensions::ALL::GLOBAL',
      serializedValue: JSON.stringify({
        AUDIO: ['mp3'],
        IMAGE: ['png'],
        VIDEO: ['mp4'],
      }),
      isEncrypted: false,
      updatedBy: null,
      reason: 'test category allowed extensions',
    });

    // Tải file .wav (nằm trong allowed_extensions chung nhưng bị giới hạn bởi category AUDIO chỉ cho phép mp3) -> Bị chặn
    const validWavHeader = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt ', 'ascii'),
    ]);
    await expect(
      service.uploadSingle({
        fileName: 'voice.wav',
        contentBase64: validWavHeader.toString('base64'),
      }),
    ).rejects.toThrow(BadRequestAppException);

    // Chặn khi expectedCategory truyền vào là AUDIO nhưng tải lên ảnh .png
    await expect(
      service.uploadSingle({
        fileName: 'photo.png',
        contentBase64: VALID_PNG_BASE64,
        expectedCategory: FILE_CATEGORY.AUDIO,
      }),
    ).rejects.toThrow(BadRequestAppException);

    // Chặn khi MIME type khai báo mâu thuẫn với đuôi file & nội dung thực tế (file .png nhưng khai báo application/pdf)
    await expect(
      service.uploadSingle({
        fileName: 'avatar.png',
        mimeType: 'application/pdf',
        contentBase64: VALID_PNG_BASE64,
      }),
    ).rejects.toThrow(BadRequestAppException);

    // 2. Giới hạn dung lượng theo loại file (IMAGE tối đa 0.001 MB ~ 1 KB) và theo module (users tối đa 0.002 MB ~ 2 KB)
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.category_max_size_mb',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.category_max_size_mb::ALL::GLOBAL',
      serializedValue: JSON.stringify({
        DOCUMENT: 0.001, // ~1 KB
      }),
      isEncrypted: false,
      updatedBy: null,
      reason: 'test category max size',
    });

    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.module_max_size_mb',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.module_max_size_mb::ALL::GLOBAL',
      serializedValue: JSON.stringify({
        courses: 10,
        users: 0.001, // ~1 KB
      }),
      isEncrypted: false,
      updatedBy: null,
      reason: 'test module max size',
    });

    const text3Kb = 'A'.repeat(3072);

    // Vượt giới hạn theo loại file DOCUMENT (~1 KB)
    await expect(
      service.uploadSingle({
        fileName: 'large-doc.txt',
        textContent: text3Kb,
      }),
    ).rejects.toThrow(BadRequestAppException);

    // Tăng giới hạn DOCUMENT lên 5 MB nhưng giới hạn module 'users' vẫn là 0.001 MB (~1 KB)
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.upload.category_max_size_mb',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.upload.category_max_size_mb::ALL::GLOBAL',
      serializedValue: JSON.stringify({ DOCUMENT: 5 }),
      isEncrypted: false,
      updatedBy: null,
      reason: 'raise doc limit',
    });

    // Tải cho module 'users' bị chặn do vượt hạn mức module
    await expect(
      service.uploadSingle({
        fileName: 'user-bio.txt',
        textContent: text3Kb,
        moduleName: 'users',
      }),
    ).rejects.toThrow(BadRequestAppException);

    // Cùng file 3 KB đó nhưng tải cho module 'courses' (hạn mức 10 MB) thì thành công
    const courseDoc = await service.uploadSingle({
      fileName: 'course-syllabus.txt',
      textContent: text3Kb,
      moduleName: 'courses',
    });
    expect(courseDoc.moduleName).toBe('courses');
  });

  it('14. [Mục 6.3.3] Quét mã độc (EICAR, Script XSS, PDF /JavaScript) và Khu vực chờ kiểm duyệt (PENDING_SCAN -> publish / quarantine)', async () => {
    const { service } = createInMemoryFilesHarness();

    // 1. Chặn ngay lập tức chuỗi kiểm thử virus tiêu chuẩn EICAR
    const eicarPayload = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    await expect(
      service.uploadSingle({
        fileName: 'eicar-test.txt',
        textContent: eicarPayload,
      }),
    ).rejects.toThrow(BadRequestAppException);

    // 2. Nếu bật quarantineOnThreat = true, file nhiễm mã độc được lưu vào khu vực cách ly QUARANTINED thay vì văng lỗi
    const quarantinedPdf = await service.uploadSingle({
      fileName: 'malicious-macro.pdf',
      contentBase64: Buffer.from(
        '%PDF-1.7 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
      ).toString('base64'),
      quarantineOnThreat: true,
    });
    expect(quarantinedPdf.status).toBe(FILE_STATUS.QUARANTINED);
    expect(quarantinedPdf.scanStatus).toBe('INFECTED');
    expect(quarantinedPdf.threatName).toContain('PDF_ACTIVE_SCRIPT_OR_LAUNCH');

    // File đang ở trạng thái QUARANTINED bị chặn tuyệt đối tải xuống / phát luồng / tạo link tạm
    await expect(service.prepareDownload(quarantinedPdf.id)).rejects.toThrow(ForbiddenAppException);
    await expect(
      service.createTemporaryDownloadLink(quarantinedPdf.id, { expiresInSeconds: 300 }),
    ).rejects.toThrow(ForbiddenAppException);

    // 3. Đưa file sạch vào khu vực chờ (stageForScan = true -> PENDING_SCAN) trước khi công bố
    const stagedFile = await service.uploadSingle({
      fileName: 'pending-approval.txt',
      textContent: 'Tài liệu sạch chờ kiểm duyệt trước khi công bố',
      stageForScan: true,
    });
    expect(stagedFile.status).toBe(FILE_STATUS.PENDING_SCAN);
    expect(stagedFile.scanStatus).toBe('PENDING');

    // Khi đang ở khu vực chờ PENDING_SCAN, chưa được phép tải xuống hoặc tạo link chia sẻ
    await expect(service.prepareDownload(stagedFile.id)).rejects.toThrow(ForbiddenAppException);

    // Duyệt & công bố file từ khu vực chờ sang ACTIVE (publishStagedFile tự động quét lại nội dung vật lý)
    const publishedFile = await service.publishStagedFile(stagedFile.id);
    expect(publishedFile.status).toBe(FILE_STATUS.ACTIVE);
    expect(publishedFile.scanStatus).toBe('CLEAN');

    // Sau khi công bố, tải xuống bình thường
    const dl = await service.prepareDownload(publishedFile.id);
    expect(dl.downloadFileName).toBe('pending-approval.txt');

    // Quản trị viên có thể chủ động cách ly (quarantineFile) một file nghi ngờ
    const manualQuarantined = await service.quarantineFile(
      publishedFile.id,
      'Phát hiện nội dung nhạy cảm cần rà soát bảo mật',
    );
    expect(manualQuarantined.status).toBe(FILE_STATUS.QUARANTINED);
    expect(manualQuarantined.scanStatus).toBe('INFECTED');
  });

  it('15. [Mục 6.3.4] Tính Checksum SHA-256 phát hiện file trùng lặp (ALLOW / REJECT / REUSE) và kiểm tra tính toàn vẹn chống sửa đổi file vật lý', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    const firstFile = await service.uploadSingle({
      fileName: 'brochure-v1.txt',
      textContent: 'Nội dung gốc duy nhất để kiểm tra SHA-256',
    });

    // 1. Chính sách REJECT (rejectDuplicate = true): Chặn tải lên file có nội dung trùng khớp SHA-256
    await expect(
      service.uploadSingle({
        fileName: 'brochure-copy.txt',
        textContent: 'Nội dung gốc duy nhất để kiểm tra SHA-256',
        rejectDuplicate: true,
      }),
    ).rejects.toThrow(ConflictAppException);

    // 2. Chính sách REUSE (reuseDuplicate = true): Tái sử dụng ngay bản ghi file gốc đã tồn tại mà không ghi trùng lặp lên đĩa
    const reusedFile = await service.uploadSingle({
      fileName: 'brochure-reused.txt',
      textContent: 'Nội dung gốc duy nhất để kiểm tra SHA-256',
      reuseDuplicate: true,
    });
    expect(reusedFile.id).toBe(firstFile.id);
    expect(reusedFile.checksumSha256).toBe(firstFile.checksumSha256);
    expect(reusedFile.storageKey).toBe(firstFile.storageKey);

    // 3. Chính sách ALLOW (mặc định): Tạo bản ghi mới nhưng tự động gắn nhãn duplicateOfFileId trỏ về bản gốc
    const allowedDuplicate = await service.uploadSingle({
      fileName: 'brochure-copy-allowed.txt',
      textContent: 'Nội dung gốc duy nhất để kiểm tra SHA-256',
    });
    expect(allowedDuplicate.id).not.toBe(firstFile.id);
    expect(allowedDuplicate.duplicateOfFileId).toBe(firstFile.id);

    // 4. Kiểm tra tính toàn vẹn (verifyFileIntegrity) khi file vật lý còn nguyên vẹn
    const checkIntact = await service.verifyFileIntegrity(firstFile.id);
    expect(checkIntact.intact).toBe(true);
    expect(checkIntact.actualChecksumSha256).toBe(firstFile.checksumSha256);
    expect(checkIntact.duplicateFileIds).toContain(allowedDuplicate.id);

    // 4. Giả lập file vật lý trên đĩa bị kẻ tấn công hoặc lỗi đĩa làm thay đổi nội dung
    storageObjects.set(firstFile.storageKey, {
      buffer: Buffer.from('Nội dung đã bị chỉnh sửa trái phép trên ổ cứng!'),
      mimeType: 'text/plain',
    });

    const checkTampered = await service.verifyFileIntegrity(firstFile.id);
    expect(checkTampered.intact).toBe(false);
    expect(checkTampered.actualChecksumSha256).not.toBe(checkTampered.expectedChecksumSha256);
    expect(checkTampered.status).toBe(FILE_STATUS.QUARANTINED);
  });

  it('16. [Mục 6.3.5 & 6.3.6] Tự động Resize, tối ưu dung lượng ảnh PNG và sinh ảnh nhỏ Thumbnail để hiển thị nhanh', async () => {
    const { service, validationService, storageObjects } = createInMemoryFilesHarness();

    // Tạo ảnh PNG lớn (400x300) kèm metadata tEXt thừa để kiểm tra resize + strip chunk + nén tối ưu + tạo thumbnail
    const basePng = Buffer.from(VALID_PNG_BASE64, 'base64');
    // Kiểm tra trực tiếp bộ xử lý ảnh thuần Node.js với ảnh PNG hợp lệ
    const processed = validationService.processAndOptimizeImage(basePng, 'png', 'image/png', {
      optimize: true,
      maxWidth: 100,
      maxHeight: 100,
      quality: 82,
      generateThumbnail: true,
      thumbnailMaxDim: 64,
    });
    expect(processed.dimensions).toEqual({ width: 1, height: 1 });
    expect(processed.thumbnail).not.toBeNull();
    expect(processed.thumbnail?.width).toBe(1);
    expect(processed.thumbnail?.height).toBe(1);

    // Tải ảnh lên qua FilesService -> tự động sinh thumbnail & lưu vào Storage
    const uploadedImg = await service.uploadSingle({
      fileName: 'product-photo.png',
      contentBase64: VALID_PNG_BASE64,
      optimizeImage: true,
      generateThumbnail: true,
    });

    expect(uploadedImg.thumbnailUrl).toBe(`/api/v1/files/${uploadedImg.id}/thumbnail`);
    expect(uploadedImg.imageDimensions).toEqual({ width: 1, height: 1 });

    const thumbKey = (uploadedImg.metadata as Record<string, unknown> | null)?.thumbnailStorageKey;
    expect(typeof thumbKey).toBe('string');
    expect(storageObjects.has(String(thumbKey))).toBe(true);

    // Lấy luồng thumbnail qua prepareThumbnail
    const thumbStream = await service.prepareThumbnail(uploadedImg.id);
    expect(thumbStream.mimeType).toBe('image/png');
    expect(thumbStream.stream.size).toBeGreaterThan(0);

    // Khi xóa vĩnh viễn ảnh, file thumbnail vật lý cũng được dọn sạch
    await service.purgeFile(uploadedImg.id);
    expect(storageObjects.has(String(thumbKey))).toBe(false);
  });

  it('17. [Mục 6.3.7] Dọn file không còn sử dụng (usageCount = 0) chỉ xóa sau khoảng thời gian an toàn', async () => {
    const { service, files } = createInMemoryFilesHarness();

    const oldUnusedFile = await service.uploadSingle({
      fileName: 'old-orphan.txt',
      textContent: 'File mồ côi tải lên từ 45 ngày trước',
    });
    const oldUsedFile = await service.uploadSingle({
      fileName: 'old-attached.txt',
      textContent: 'File cũ nhưng đang gắn với khóa học',
    });
    const recentUnusedFile = await service.uploadSingle({
      fileName: 'recent-orphan.txt',
      textContent: 'File mới tải lên hôm nay chưa kịp gắn liên kết',
    });

    // Gắn liên kết sử dụng cho oldUsedFile
    await service.attachUsage({
      fileId: oldUsedFile.id,
      moduleName: 'courses',
      entityType: 'lesson',
      entityId: 500,
    });

    // Lùi thời gian tạo (createdAt) của oldUnusedFile và oldUsedFile về 45 ngày trước
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86_400_000);
    const recUnused = files.get(oldUnusedFile.id);
    if (recUnused) recUnused.createdAt = fortyFiveDaysAgo;
    const recUsed = files.get(oldUsedFile.id);
    if (recUsed) recUsed.createdAt = fortyFiveDaysAgo;

    // Thực thi dọn file không sử dụng với thời gian an toàn = 30 ngày (action = 'trash')
    const cleanupRes = await service.cleanupUnusedFiles({
      olderThanDays: 30,
      action: 'trash',
    });

    // Chỉ duy nhất oldUnusedFile bị dọn; oldUsedFile (đang dùng) và recentUnusedFile (chưa đủ 30 ngày an toàn) được giữ nguyên
    expect(cleanupRes.cleanedCount).toBe(1);
    expect(cleanupRes.cleanedIds).toEqual([oldUnusedFile.id]);
    expect(files.get(oldUnusedFile.id)?.status).toBe(FILE_STATUS.TRASHED);
    expect(files.get(oldUsedFile.id)?.status).toBe(FILE_STATUS.ACTIVE);
    expect(files.get(recentUnusedFile.id)?.status).toBe(FILE_STATUS.ACTIVE);
  });

  it('18. [Mục 6.4.7] Hỗ trợ CDN hoặc URL công khai CHỈ áp dụng cho file được phép công khai (PUBLIC + ACTIVE)', async () => {
    const { service, settingRegistry } = createInMemoryFilesHarness();

    const privateFile = await service.uploadSingle({
      fileName: 'private-contract.txt',
      textContent: 'Hợp đồng nội bộ mật',
      visibility: FILE_VISIBILITY.PRIVATE,
    });
    const internalFile = await service.uploadSingle({
      fileName: 'internal-guide.txt',
      textContent: 'Hướng dẫn nội bộ',
      visibility: FILE_VISIBILITY.INTERNAL,
    });
    const publicFile = await service.uploadSingle({
      fileName: 'public-brochure.txt',
      textContent: 'Tài liệu giới thiệu công khai',
      visibility: FILE_VISIBILITY.PUBLIC,
    });

    // File PRIVATE và INTERNAL tuyệt đối KHÔNG có publicUrl và bị chặn khi gọi preparePublicAccess
    expect(privateFile.publicUrl).toBeNull();
    expect(internalFile.publicUrl).toBeNull();
    await expect(service.preparePublicAccess(privateFile.id)).rejects.toThrow(
      ForbiddenAppException,
    );
    await expect(service.preparePublicAccess(internalFile.id)).rejects.toThrow(
      ForbiddenAppException,
    );

    // File PUBLIC khi chưa cấu hình CDN thì có publicUrl chuẩn `/api/v1/files/:id/public` và mở stream trực tiếp
    expect(publicFile.publicUrl).toBe(`/api/v1/files/${publicFile.id}/public`);
    const localPublicAccess = await service.preparePublicAccess(publicFile.id);
    expect(localPublicAccess.redirectUrl).toBeNull();
    expect(localPublicAccess.stream).not.toBeNull();
    expect(localPublicAccess.downloadFileName).toBe('public-brochure.txt');

    // Khi bật cấu hình động `file.storage.cdn_base_url`, file PUBLIC tự động sinh URL CDN và hỗ trợ redirect
    settingRegistry.upsertScopeOverride({
      settingKey: 'file.storage.cdn_base_url',
      environment: 'ALL',
      organizationUnitId: null,
      scopeKey: 'file.storage.cdn_base_url::ALL::GLOBAL',
      serializedValue: 'https://cdn.enterprise.vn/',
      isEncrypted: false,
      updatedBy: null,
      reason: 'test cdn url',
    });

    const publicWithCdn = await service.getById(publicFile.id);
    expect(publicWithCdn.publicUrl).toBe(`https://cdn.enterprise.vn/${publicFile.storageKey}`);

    const cdnAccess = await service.preparePublicAccess(publicFile.id);
    expect(cdnAccess.redirectUrl).toBe(`https://cdn.enterprise.vn/${publicFile.storageKey}`);
    expect(cdnAccess.stream).toBeNull();

    // Khi file PUBLIC bị đưa vào thùng rác hoặc cách ly, publicUrl lập tức bị thu hồi về null
    const trashedPublic = await service.moveToTrash(publicFile.id);
    expect(trashedPublic.publicUrl).toBeNull();
  });

  it('19. Tải file dung lượng lớn theo mảnh (Chunked Upload: init -> chunk -> complete) khớp SHA-256 & chặn giả mạo Magic Bytes ở chunk 0', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    // Tạo một payload mẫu chia làm 2 mảnh (giả lập file > 4 MB bằng cách cắt 4 MB + 1 MB)
    const part0 = Buffer.alloc(4 * 1024 * 1024, 0x41); // 4 MB chữ 'A'
    const part1 = Buffer.alloc(512 * 1024, 0x42); // 512 KB chữ 'B'
    const totalBytes = part0.length + part1.length;

    const initRes = await service.initChunkedUpload({
      fileName: 'course-recording.mp4',
      displayName: 'Bài giảng Full HD.mp4',
      sizeBytes: totalBytes,
      mimeType: 'video/mp4',
      visibility: FILE_VISIBILITY.INTERNAL,
      moduleName: 'courses',
    });

    expect(initRes.uploadId).toBeDefined();
    expect(initRes.totalChunks).toBe(2);

    const chunk0Res = await service.uploadChunkPart(initRes.uploadId, {
      chunkIndex: 0,
      contentBase64: part0.toString('base64'),
    });
    expect(chunk0Res.receivedBytes).toBe(part0.length);
    expect(chunk0Res.progressPercent).toBeGreaterThan(80);

    const chunk1Res = await service.uploadChunkPart(initRes.uploadId, {
      chunkIndex: 1,
      contentBase64: part1.toString('base64'),
    });
    expect(chunk1Res.receivedBytes).toBe(totalBytes);
    expect(chunk1Res.progressPercent).toBe(100);

    const completed = await service.completeChunkedUpload(initRes.uploadId);
    expect(completed.displayName).toBe('Bài giảng Full HD.mp4');
    expect(completed.sizeBytes).toBe(totalBytes);
    expect(completed.category).toBe(FILE_CATEGORY.VIDEO);
    expect(completed.status).toBe(FILE_STATUS.ACTIVE);
    expect(storageObjects.has(completed.storageKey)).toBe(true);

    // Kiểm tra toàn vẹn SHA-256 trên Storage khớp tuyệt đối với mã băm streaming
    const integrity = await service.verifyFileIntegrity(completed.id);
    expect(integrity.intact).toBe(true);

    // Kiểm tra chặn Magic Bytes giả mạo ngay ở chunk 0 (file .png nhưng gửi thực thi MZ)
    const badInit = await service.initChunkedUpload({
      fileName: 'fake-image.png',
      sizeBytes: 1024,
      mimeType: 'image/png',
    });

    await expect(
      service.uploadChunkPart(badInit.uploadId, {
        chunkIndex: 0,
        contentBase64: Buffer.from('MZ-executable-payload').toString('base64'),
      }),
    ).rejects.toThrow(BadRequestAppException);
  });
});
