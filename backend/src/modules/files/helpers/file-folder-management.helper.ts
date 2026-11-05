import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type {
  CreateFileFolderRequest,
  UpdateFileFolderRequest,
} from '../requests/files.requests.js';
import type { FileFolderResponse } from '../responses/files.response.js';
import {
  type FilesServiceContext,
  assertCanAccessFolder,
  isFolderAccessibleInScope,
  resolveFileScopeConstraint,
} from './file-access-control.helper.js';
import { slugifyFolderName } from './file-storage.helper.js';

/** Kiểm tra trùng tên/slug thư mục trong cùng một thư mục cha (`parentId`) */
export async function assertUniqueFolderSlugInParent(
  ctx: FilesServiceContext,
  parentId: number | null,
  slug: string,
  excludeFolderId?: number,
): Promise<void> {
  let duplicate: FileFolderEntity | null = null;
  if (typeof ctx.foldersRepo.findByParentAndSlug === 'function') {
    duplicate = await ctx.foldersRepo.findByParentAndSlug(parentId, slug);
  } else {
    const all = await ctx.foldersRepo.findAllOrdered();
    duplicate =
      all.find(
        (f) => (f.parentId ?? null) === parentId && f.slug.toLowerCase() === slug.toLowerCase(),
      ) ?? null;
  }

  if (duplicate && duplicate.id !== excludeFolderId) {
    throw new ConflictAppException('files.error.folderNameDuplicate');
  }
}

/** Cập nhật dây chuyền `folderPath` của toàn bộ thư mục con cháu khi di chuyển thư mục cha */
export async function cascadeUpdateDescendantFolderPaths(
  ctx: FilesServiceContext,
  parentFolderId: number,
  oldFolderPath: string,
  newFolderPath: string,
): Promise<void> {
  const descendants =
    typeof ctx.foldersRepo.findDescendantsByPathPrefix === 'function'
      ? await ctx.foldersRepo.findDescendantsByPathPrefix(oldFolderPath)
      : (await ctx.foldersRepo.findAllOrdered()).filter((f) =>
          f.folderPath.startsWith(oldFolderPath),
        );

  for (const child of descendants) {
    if (child.id === parentFolderId) continue;
    if (child.folderPath.startsWith(oldFolderPath)) {
      const updatedChildPath = `${newFolderPath}${child.folderPath.slice(oldFolderPath.length)}`;
      await ctx.foldersRepo.saveEntity({
        ...child,
        folderPath: updatedChildPath,
      });
    }
  }
}

/** Lấy danh sách thư mục lưu trữ (có lọc theo phạm vi dữ liệu của người dùng — Mục 6.2) */
export async function listFileFolders(
  ctx: FilesServiceContext,
  organizationUnitId?: number,
  actor?: UserIdentity,
): Promise<FileFolderResponse[]> {
  const folders = await ctx.foldersRepo.findAllOrdered(organizationUnitId);
  const scope = await resolveFileScopeConstraint(ctx, actor);
  if (scope.unrestricted) {
    return folders.map((f) => ctx.mapper.toFolderResponse(f));
  }

  const visibleFolders = folders.filter((f) => isFolderAccessibleInScope(f, scope));
  return visibleFolders.map((f) => ctx.mapper.toFolderResponse(f));
}

/** Tạo thư mục mới trong File Manager (kiểm tra quyền, chống trùng tên cùng cấp — Mục 6.2) */
export async function createFileFolder(
  ctx: FilesServiceContext,
  input: CreateFileFolderRequest,
  actor?: UserIdentity,
): Promise<FileFolderResponse> {
  let parentFolder: FileFolderEntity | null = null;
  if (input.parentId !== undefined && input.parentId !== null) {
    parentFolder = await ctx.foldersRepo.findById(input.parentId);
    if (!parentFolder) {
      throw new NotFoundAppException('files.error.parentFolderNotFound');
    }
    await assertCanAccessFolder(ctx, parentFolder, actor);
  }

  const trimmedName = input.name.trim();
  const slug = slugifyFolderName(trimmedName);
  const parentId = parentFolder ? parentFolder.id : null;
  await assertUniqueFolderSlugInParent(ctx, parentId, slug);

  const orgId =
    input.organizationUnitId ?? parentFolder?.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);
  const code = await ctx.generateEntityCode('files.folder_code', orgId);

  const created = await ctx.foldersRepo.saveEntity({
    code,
    name: trimmedName,
    slug,
    parentId,
    folderPath: '/',
    organizationUnitId: orgId,
    createdByUserId: actor?.id ?? null,
    description: input.description ?? null,
  });

  const folderPath = parentFolder
    ? `${parentFolder.folderPath.replace(/\/$/, '')}/${created.id}/`
    : `/${created.id}/`;
  const updated = await ctx.foldersRepo.saveEntity({
    ...created,
    folderPath,
  });

  await ctx.recordAudit(actor, 'folder.create', 'file_folder', String(updated.id), null, {
    name: updated.name,
    parentId: updated.parentId ?? null,
    folderPath: updated.folderPath,
  });

  return ctx.mapper.toFolderResponse(updated);
}

/**
 * Đổi tên hoặc di chuyển thư mục (Mục 6.2):
 * - Kiểm tra quyền quản lý trên thư mục hiện tại và thư mục cha đích.
 * - Kiểm tra chống vòng lặp cây thư mục và chống trùng tên cùng cấp.
 * - Tự động cập nhật dây chuyền `folderPath` cho toàn bộ thư mục con cháu (descendants).
 */
export async function updateFileFolder(
  ctx: FilesServiceContext,
  id: number,
  input: UpdateFileFolderRequest,
  actor?: UserIdentity,
): Promise<FileFolderResponse> {
  const folder = await ctx.foldersRepo.findById(id);
  if (!folder) {
    throw new NotFoundAppException('files.error.folderNotFound');
  }

  await assertCanAccessFolder(ctx, folder, actor);

  const oldFolderPath = folder.folderPath;
  let nextParentId = folder.parentId ?? null;
  let nextFolderPath = folder.folderPath;

  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      nextParentId = null;
      nextFolderPath = `/${folder.id}/`;
    } else {
      if (input.parentId === folder.id) {
        throw new BadRequestAppException('files.error.folderCycleDetected');
      }
      const parent = await ctx.foldersRepo.findById(input.parentId);
      if (!parent) {
        throw new NotFoundAppException('files.error.parentFolderNotFound');
      }
      await assertCanAccessFolder(ctx, parent, actor);
      if (parent.folderPath.includes(`/${folder.id}/`)) {
        throw new BadRequestAppException('files.error.folderCycleDetected');
      }
      nextParentId = parent.id;
      nextFolderPath = `${parent.folderPath.replace(/\/$/, '')}/${folder.id}/`;
    }
  }

  const nextName = input.name !== undefined ? input.name.trim() : folder.name;
  const nextSlug = slugifyFolderName(nextName);

  if (nextSlug !== folder.slug || nextParentId !== (folder.parentId ?? null)) {
    await assertUniqueFolderSlugInParent(ctx, nextParentId, nextSlug, folder.id);
  }

  const saved = await ctx.foldersRepo.saveEntity({
    ...folder,
    name: nextName,
    slug: nextSlug,
    parentId: nextParentId,
    folderPath: nextFolderPath,
    description: input.description !== undefined ? input.description : (folder.description ?? null),
  });

  if (nextFolderPath !== oldFolderPath) {
    await cascadeUpdateDescendantFolderPaths(ctx, folder.id, oldFolderPath, nextFolderPath);
  }

  await ctx.recordAudit(
    actor,
    'folder.update',
    'file_folder',
    String(saved.id),
    {
      name: folder.name,
      parentId: folder.parentId ?? null,
      folderPath: oldFolderPath,
    },
    {
      name: saved.name,
      parentId: saved.parentId ?? null,
      folderPath: saved.folderPath,
    },
  );

  return ctx.mapper.toFolderResponse(saved);
}

/** Xóa thư mục khi thư mục trống (chặn xóa nếu còn thư mục con hoặc còn file — Mục 6.2) */
export async function deleteFileFolder(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<{ deleted: true; id: number }> {
  const folder = await ctx.foldersRepo.findById(id);
  if (!folder) {
    throw new NotFoundAppException('files.error.folderNotFound');
  }

  await assertCanAccessFolder(ctx, folder, actor);

  const [childFolders, filesCount] = await Promise.all([
    ctx.foldersRepo.countChildFolders(id),
    ctx.filesRepo.countFilesInFolder(id),
  ]);

  if (childFolders > 0 || filesCount > 0) {
    throw new ConflictAppException('files.error.folderNotEmpty');
  }

  await ctx.foldersRepo.softDeleteById(id);
  await ctx.recordAudit(
    actor,
    'folder.delete',
    'file_folder',
    String(id),
    { name: folder.name },
    null,
  );

  return { deleted: true, id };
}
