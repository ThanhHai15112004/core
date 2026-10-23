import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileManagerNavSection } from '../enum/files.enum';
import { filesApi, readBrowserFileAsBase64 } from '../services/files.api';
import type {
  FileFolderItem,
  FileIntegrityVerificationItem,
  FileRecordItem,
  FileStatsItem,
} from '../types/files.types';

export function useFileManager() {
  const [folders, setFolders] = useState<FileFolderItem[]>([]);
  const [files, setFiles] = useState<FileRecordItem[]>([]);
  const [allActiveFiles, setAllActiveFiles] = useState<FileRecordItem[]>([]);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  // Điều hướng & Bộ lọc (Mục 6.1.7 & 6.3)
  const [navSection, setNavSection] = useState<FileManagerNavSection>('my_files');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'size'>('newest');
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>('list');

  // File đang chọn xem ở cột phải (Inspector)
  const [selectedFile, setSelectedFile] = useState<FileRecordItem | null>(null);
  const [showRenameBox, setShowRenameBox] = useState<boolean>(false);
  const [renameValue, setRenameValue] = useState<string>('');
  const [moveFolderValue, setMoveFolderValue] = useState<number | null>(null);

  // Tạo thư mục ảo mới & Sửa/Di chuyển thư mục (Mục 6.2)
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);
  const [editingFolder, setEditingFolder] = useState<FileFolderItem | null>(null);
  const [editFolderName, setEditFolderName] = useState<string>('');
  const [editFolderParentId, setEditFolderParentId] = useState<number | null>(null);
  const [stats, setStats] = useState<FileStatsItem | null>(null);

  // Tải file lên (Mục 6.1.1 & 6.3)
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadEncrypt, setUploadEncrypt] = useState<boolean>(false);
  const [uploadStageForScan, setUploadStageForScan] = useState<boolean>(false);
  const [uploadOptimizeImage, setUploadOptimizeImage] = useState<boolean>(true);
  const [uploadGenerateThumbnail, setUploadGenerateThumbnail] = useState<boolean>(true);
  const [uploadModuleName, setUploadModuleName] = useState<string>('');
  const [integrityResult, setIntegrityResult] = useState<FileIntegrityVerificationItem | null>(
    null,
  );
  const [verifyingIntegrity, setVerifyingIntegrity] = useState<boolean>(false);
  const [cleaningUnused, setCleaningUnused] = useState<boolean>(false);

  // Gắn liên kết sử dụng file (Mục 6.1.8)
  const [showAddUsageForm, setShowAddUsageForm] = useState<boolean>(false);
  const [usageModule, setUsageModule] = useState<string>('lms_courses');
  const [usageEntityType, setUsageEntityType] = useState<string>('course_banner');
  const [usageEntityId, setUsageEntityId] = useState<string>('101');
  const [usageNote, setUsageNote] = useState<string>('Banner trang chủ khóa học');

  // Phân quyền xem/tải & Link tải tạm thời (Mục 6.2)
  const [showAddPermissionForm, setShowAddPermissionForm] = useState<boolean>(false);
  const [permSubjectType, setPermSubjectType] = useState<'USER' | 'ROLE' | 'ORG_UNIT'>('ROLE');
  const [permSubjectId, setPermSubjectId] = useState<string>('teacher');
  const [permCanDownload, setPermCanDownload] = useState<boolean>(false);
  const [tempLinkUrl, setTempLinkUrl] = useState<string | null>(null);
  const [tempLinkExpiresAt, setTempLinkExpiresAt] = useState<string | null>(null);

  // Mở Popup <FilePickerModal /> đè lên trình duyệt
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pickedFromModal, setPickedFromModal] = useState<FileRecordItem[]>([]);

  // Thông báo trạng thái
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotice = useCallback((type: 'success' | 'error', message: string) => {
    setBanner({ type, message });
  }, []);

  const viewMode: 'active' | 'trash' = navSection === 'trash' ? 'trash' : 'active';

  const loadFoldersAndFiles = useCallback(async () => {
    setLoading(true);
    try {
      const [folderList, fileRes, allRes, statsRes] = await Promise.all([
        filesApi.listFolders(false),
        filesApi.listFiles({
          page,
          limit: 20,
          ...(viewMode === 'trash'
            ? { status: 2 }
            : navSection === 'missing'
              ? { status: 4 }
              : navSection === 'pending_scan'
                ? { status: 5 }
                : navSection === 'quarantined'
                  ? { status: 6 }
                  : {}),
          ...(selectedFolderId !== null && viewMode === 'active'
            ? { folderId: selectedFolderId }
            : {}),
          ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
          ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
          ...(navSection === 'shared' ? { onlyReferenced: true } : {}),
        }),
        filesApi.listFiles({ page: 1, limit: 100, status: 1 }),
        filesApi.getStats().catch(() => null),
      ]);
      setFolders(folderList);
      setAllActiveFiles(allRes.data);
      if (statsRes) {
        setStats(statsRes);
      }

      const sorted = [...fileRes.data].sort((a, b) => {
        if (sortBy === 'name') return a.displayName.localeCompare(b.displayName);
        if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setFiles(sorted);
      setTotalFiles(fileRes.meta?.total ?? sorted.length);
      setTotalPages(fileRes.meta?.totalPages ?? 1);

      if (sorted[0]) {
        const firstDetail = await filesApi.getFileById(sorted[0].id).catch(() => sorted[0] ?? null);
        if (firstDetail) {
          setSelectedFile((prev) => {
            if (prev && sorted.some((f) => f.id === prev.id)) return prev;
            setRenameValue(firstDetail.displayName);
            setMoveFolderValue(firstDetail.folderId);
            return firstDetail;
          });
        }
      } else {
        setSelectedFile(null);
      }
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể tải danh sách file');
    } finally {
      setLoading(false);
    }
  }, [page, viewMode, selectedFolderId, searchQuery, categoryFilter, navSection, sortBy, showNotice]);

  useEffect(() => {
    void loadFoldersAndFiles();
  }, [loadFoldersAndFiles]);

  const handleSelectFileDetail = async (id: number) => {
    try {
      setIntegrityResult(null);
      const detail = await filesApi.getFileById(id);
      setSelectedFile(detail);
      setRenameValue(detail.displayName);
      setMoveFolderValue(detail.folderId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể tải chi tiết file');
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      await filesApi.createFolder({
        name: newFolderName.trim(),
        parentId: selectedFolderId,
      });
      setNewFolderName('');
      setShowNewFolderInput(false);
      showNotice('success', 'Đã tạo thư mục ảo mới thành công');
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể tạo thư mục');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleOpenEditFolder = (folder: FileFolderItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderParentId(folder.parentId);
  };

  const handleUpdateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder || !editFolderName.trim()) return;
    try {
      const updated = await filesApi.updateFolder(editingFolder.id, {
        name: editFolderName.trim(),
        parentId: editFolderParentId,
      });
      setEditingFolder(null);
      showNotice(
        'success',
        `Đã cập nhật thư mục "${updated.name}" (Đường dẫn mới: ${updated.folderPath})`,
      );
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể cập nhật thư mục');
    }
  };

  const handleDeleteFolder = async (folder: FileFolderItem) => {
    try {
      await filesApi.deleteFolder(folder.id);
      if (selectedFolderId === folder.id) {
        setSelectedFolderId(null);
      }
      setEditingFolder(null);
      showNotice('success', `Đã xóa thư mục trống "${folder.name}"`);
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể xóa thư mục');
    }
  };

  const handleDirectUploadFiles = async (browserList: File[]) => {
    if (browserList.length === 0) return;
    setUploading(true);
    try {
      const items = await Promise.all(
        browserList.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || undefined,
          contentBase64: await readBrowserFileAsBase64(file),
          folderId: selectedFolderId,
          visibility: 2,
          moduleName: uploadModuleName.trim() || undefined,
          stageForScan: uploadStageForScan,
          optimizeImage: uploadOptimizeImage,
          generateThumbnail: uploadGenerateThumbnail,
          encryptAtRest: uploadEncrypt,
        })),
      );

      if (items.length === 1 && items[0]) {
        const created = await filesApi.uploadSingle(items[0]);
        showNotice('success', `Đã tải lên "${created.displayName}" (${created.sizeFormatted})`);
        await loadFoldersAndFiles();
        await handleSelectFileDetail(created.id);
      } else {
        const batch = await filesApi.uploadBatch({
          files: items,
          folderId: selectedFolderId,
          visibility: 2,
          moduleName: uploadModuleName.trim() || undefined,
          stageForScan: uploadStageForScan,
          optimizeImage: uploadOptimizeImage,
          generateThumbnail: uploadGenerateThumbnail,
          encryptAtRest: uploadEncrypt,
        });
        const uploadedTotal = batch.count ?? batch.uploadedCount ?? batch.items.length;
        showNotice('success', `Đã tải lên hàng loạt ${uploadedTotal} tệp thành công`);
        await loadFoldersAndFiles();
      }
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Tải file lên thất bại');
    } finally {
      setUploading(false);
    }
  };

  const handlePublishStagedFile = async (fileId: number) => {
    try {
      const published = await filesApi.publishFile(fileId);
      showNotice(
        'success',
        `Đã quét mã độc & công bố "${published.displayName}" sang trạng thái ACTIVE`,
      );
      await loadFoldersAndFiles();
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể công bố file');
    }
  };

  const handleQuarantineFile = async (fileId: number) => {
    try {
      const quarantined = await filesApi.quarantineFile(
        fileId,
        'Cách ly thủ công bởi Quản trị viên từ File Manager',
      );
      showNotice(
        'success',
        `Đã chuyển "${quarantined.displayName}" vào khu vực cách ly (QUARANTINED)`,
      );
      await loadFoldersAndFiles();
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể cách ly file');
    }
  };

  const handleVerifyIntegrity = async (fileId: number) => {
    setVerifyingIntegrity(true);
    try {
      const res = await filesApi.verifyIntegrity(fileId);
      setIntegrityResult(res);
      if (res.intact) {
        showNotice(
          'success',
          `Checksum SHA-256 nguyên vẹn! (${res.duplicateFileIds.length} bản trùng lặp)`,
        );
      } else {
        showNotice(
          'error',
          `CẢNH BÁO: File vật lý đã bị thay đổi hoặc mất! Hệ thống đã cập nhật trạng thái ${res.statusName}.`,
        );
      }
      await loadFoldersAndFiles();
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể kiểm tra toàn vẹn file');
    } finally {
      setVerifyingIntegrity(false);
    }
  };

  const handleCleanupUnusedFiles = async () => {
    setCleaningUnused(true);
    try {
      const res = await filesApi.cleanupUnusedFiles({ action: 'trash' });
      showNotice(
        'success',
        `Đã dọn ${res.cleanedCount} file không còn sử dụng (quá ${res.retentionDays} ngày an toàn) vào thùng rác`,
      );
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Không thể dọn file không sử dụng',
      );
    } finally {
      setCleaningUnused(false);
    }
  };

  const handleRenameOrMoveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    try {
      const updated = await filesApi.updateFile(selectedFile.id, {
        displayName: renameValue.trim() || selectedFile.displayName,
        folderId: moveFolderValue,
      });
      setShowRenameBox(false);
      showNotice(
        'success',
        `Đã đổi tên hiển thị thành "${updated.displayName}" (Storage Key vật lý "${updated.storageKey}" giữ nguyên)`,
      );
      await loadFoldersAndFiles();
      await handleSelectFileDetail(updated.id);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Đổi tên file thất bại');
    }
  };

  const handleMoveToTrash = async (file: FileRecordItem) => {
    try {
      const trashed = await filesApi.moveToTrash(file.id);
      showNotice('success', `Đã đưa "${trashed.displayName}" vào thùng rác`);
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể chuyển vào thùng rác');
    }
  };

  const handleRestoreFromTrash = async (file: FileRecordItem) => {
    try {
      const restored = await filesApi.restoreFromTrash(file.id);
      showNotice('success', `Đã khôi phục "${restored.displayName}"`);
      await loadFoldersAndFiles();
      await handleSelectFileDetail(file.id);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể khôi phục file');
    }
  };

  const handlePurgeFile = async (file: FileRecordItem) => {
    try {
      const res = await filesApi.purgeFile(file.id);
      showNotice('success', `Đã xóa vĩnh viễn tệp #${res.id} khỏi hệ thống lưu trữ`);
      await loadFoldersAndFiles();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể xóa vĩnh viễn file');
    }
  };

  const handleAttachUsage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    try {
      await filesApi.attachUsage(selectedFile.id, {
        moduleName: usageModule.trim(),
        entityType: usageEntityType.trim(),
        entityId: usageEntityId.trim(),
        fieldName: 'attachmentFileId',
        note: usageNote.trim() || null,
      });
      setShowAddUsageForm(false);
      showNotice(
        'success',
        `Đã gắn liên kết [${usageModule}.${usageEntityType}#${usageEntityId}] — File đã được khóa bảo vệ chống xóa!`,
      );
      await loadFoldersAndFiles();
      await handleSelectFileDetail(selectedFile.id);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Gắn liên kết thất bại');
    }
  };

  const handleDetachUsage = async (
    fileId: number,
    usageId: number,
    moduleName: string,
    entityType: string,
    entityId: string,
  ) => {
    try {
      await filesApi.removeUsage(fileId, usageId);
      showNotice('success', `Đã gỡ liên kết [${moduleName}.${entityType}#${entityId}]`);
      await loadFoldersAndFiles();
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Gỡ liên kết thất bại');
    }
  };

  const handleGrantPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !permSubjectId.trim()) return;
    try {
      await filesApi.grantPermission(selectedFile.id, {
        subjectType: permSubjectType,
        subjectId: permSubjectId.trim(),
        canView: true,
        canDownload: permCanDownload,
      });
      setShowAddPermissionForm(false);
      showNotice(
        'success',
        `Đã cấp quyền ${permCanDownload ? 'Xem & Tải' : 'Chỉ xem'} cho [${permSubjectType}:${permSubjectId}]`,
      );
      await handleSelectFileDetail(selectedFile.id);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Cấp quyền thất bại');
    }
  };

  const handleRevokePermission = async (fileId: number, permissionId: number) => {
    try {
      await filesApi.revokePermission(fileId, permissionId);
      showNotice('success', 'Đã thu hồi quyền truy cập tệp tin');
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Thu hồi quyền thất bại');
    }
  };

  const handleCreateTempDownloadLink = async (fileId: number) => {
    try {
      const link = await filesApi.createTemporaryLink(fileId, { expiresInSeconds: 3600 });
      setTempLinkUrl(link.downloadUrl);
      setTempLinkExpiresAt(link.expiresAt);
      showNotice('success', 'Đã tạo đường dẫn tải tạm thời (tự hết hạn sau 1 giờ)');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Không thể tạo đường dẫn tải tạm thời');
    }
  };

  const countFolderItems = (folderId: number): number =>
    allActiveFiles.filter((f) => f.folderId === folderId).length;

  const activeFolderObj = folders.find((f) => f.id === selectedFolderId) ?? null;

  return {
    folders,
    files,
    allActiveFiles,
    totalFiles,
    page,
    setPage,
    totalPages,
    loading,
    navSection,
    setNavSection,
    selectedFolderId,
    setSelectedFolderId,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,
    layoutMode,
    setLayoutMode,
    selectedFile,
    setSelectedFile,
    showRenameBox,
    setShowRenameBox,
    renameValue,
    setRenameValue,
    moveFolderValue,
    setMoveFolderValue,
    showNewFolderInput,
    setShowNewFolderInput,
    newFolderName,
    setNewFolderName,
    creatingFolder,
    editingFolder,
    setEditingFolder,
    editFolderName,
    setEditFolderName,
    editFolderParentId,
    setEditFolderParentId,
    stats,
    uploadInputRef,
    uploading,
    uploadEncrypt,
    setUploadEncrypt,
    uploadStageForScan,
    setUploadStageForScan,
    uploadOptimizeImage,
    setUploadOptimizeImage,
    uploadGenerateThumbnail,
    setUploadGenerateThumbnail,
    uploadModuleName,
    setUploadModuleName,
    integrityResult,
    verifyingIntegrity,
    cleaningUnused,
    showAddUsageForm,
    setShowAddUsageForm,
    usageModule,
    setUsageModule,
    usageEntityType,
    setUsageEntityType,
    usageEntityId,
    setUsageEntityId,
    usageNote,
    setUsageNote,
    showAddPermissionForm,
    setShowAddPermissionForm,
    permSubjectType,
    setPermSubjectType,
    permSubjectId,
    setPermSubjectId,
    permCanDownload,
    setPermCanDownload,
    tempLinkUrl,
    tempLinkExpiresAt,
    pickerOpen,
    setPickerOpen,
    pickedFromModal,
    setPickedFromModal,
    banner,
    setBanner,
    showNotice,
    viewMode,
    loadFoldersAndFiles,
    handleSelectFileDetail,
    handleCreateFolder,
    handleOpenEditFolder,
    handleUpdateFolder,
    handleDeleteFolder,
    handleDirectUploadFiles,
    handlePublishStagedFile,
    handleQuarantineFile,
    handleVerifyIntegrity,
    handleCleanupUnusedFiles,
    handleRenameOrMoveFile,
    handleMoveToTrash,
    handleRestoreFromTrash,
    handlePurgeFile,
    handleAttachUsage,
    handleDetachUsage,
    handleGrantPermission,
    handleRevokePermission,
    handleCreateTempDownloadLink,
    countFolderItems,
    activeFolderObj,
  };
}
