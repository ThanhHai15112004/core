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
  FILE_STATUS,
  FILE_VISIBILITY,
  FilesService,
  FileValidationService,
} from '@modules/files/index.js';
import type { FileFolderEntity } from '@modules/files/entities/file-folder.entity.js';
import type { FileRecordEntity } from '@modules/files/entities/file-record.entity.js';
import type { FileUsageEntity } from '@modules/files/entities/file-usage.entity.js';
import { FilesMapper } from '@modules/files/mappers/files.mapper.js';
import type { FileFoldersRepository } from '@modules/files/repositories/file-folders.repository.js';
import type { FileUsagesRepository } from '@modules/files/repositories/file-usages.repository.js';
import type { FilesRepository } from '@modules/files/repositories/files.repository.js';

function createInMemoryFilesHarness() {
  const folders = new Map<number, FileFolderEntity>();
  const files = new Map<number, FileRecordEntity>();
  const usages = new Map<number, FileUsageEntity>();
  const storageObjects = new Map<string, { buffer: Buffer; mimeType: string }>();

  let folderSeq = 1;
  let fileSeq = 1;
  let usageSeq = 1;

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
    saveEntity: async (partial: Partial<FileFolderEntity>) => {
      const now = new Date();
      const id = partial.id ?? folderSeq++;
      const existing = folders.get(id);
      const saved: FileFolderEntity = {
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
      };
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
      const saved: FileRecordEntity = {
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
      };
      files.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      const existing = files.get(id);
      if (existing) existing.deletedAt = new Date();
    },
    findPaginatedFiltered: async (query, scope) => {
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
            (f.organizationUnitId !== null &&
              f.organizationUnitId !== undefined &&
              scope.allowedOrgUnitIds?.includes(f.organizationUnitId)),
        );
      }
      return { items: list, total: list.length };
    },
    findAllForStats: async () => [...files.values()].filter((f) => f.status !== FILE_STATUS.PURGED),
    findExpiredTrashedFiles: async (now: Date) =>
      [...files.values()].filter(
        (f) =>
          f.status === FILE_STATUS.TRASHED &&
          f.purgeAfterAt !== null &&
          f.purgeAfterAt !== undefined &&
          f.purgeAfterAt.getTime() <= now.getTime(),
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
      const saved: FileUsageEntity = {
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
      };
      usages.set(id, saved);
      return saved;
    },
    softDeleteById: async (id: number) => {
      usages.delete(id);
    },
  } as unknown as FileUsagesRepository;

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
    exists: async (key: string) => storageObjects.has(key),
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
  );

  return {
    service,
    storageObjects,
    files,
  };
}

// Valid 1x1 transparent PNG bytes
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('FilesService — Phase 6.1 File Management & Shared Media Library', () => {
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

  it('3. Đổi tên file và di chuyển thư mục KHÔNG làm thay đổi file gốc (storageKey) trong Storage', async () => {
    const { service, storageObjects } = createInMemoryFilesHarness();

    const folder = await service.createFolder({ name: 'Tài liệu Hợp đồng 2026' });
    const uploaded = await service.uploadSingle({
      fileName: 'hop-dong-goc.txt',
      textContent: 'Hợp đồng nguyên tắc',
    });

    const originalStorageKey = uploaded.storageKey;
    expect(storageObjects.has(originalStorageKey)).toBe(true);

    const renamed = await service.updateMetadata(uploaded.id, {
      displayName: 'Hợp đồng Đã Ký Duyệt_v2.txt',
      folderId: folder.id,
    });

    expect(renamed.displayName).toBe('Hợp đồng Đã Ký Duyệt_v2.txt');
    expect(renamed.originalName).toBe('hop-dong-goc.txt');
    expect(renamed.folderId).toBe(folder.id);
    expect(renamed.folderName).toBe('Tài liệu Hợp đồng 2026');
    // Storage key vật lý giữ nguyên tuyệt đối
    expect(renamed.storageKey).toBe(originalStorageKey);
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
});
