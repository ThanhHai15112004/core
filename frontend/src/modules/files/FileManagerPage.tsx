import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  RotateCcw,
  Edit3,
  Search,
  Link2,
  Unlink,
  Eye,
  Film,
  Image as ImageIcon,
  FileText,
  Music,
  Archive,
  Table,
  File as FileIcon,
  CheckCircle2,
  AlertCircle,
  Lock,
  Globe,
  Home,
  Clock,
  Share2,
  Star,
  Plus,
  MoreHorizontal,
  LayoutGrid,
  List,
  ChevronRight,
  Cloud,
  Sparkles,
  X,
} from 'lucide-react';
import { filesApi, readBrowserFileAsBase64 } from './services/files.api';
import { FilePickerModal } from './components/FilePickerModal';
import type { FileFolderItem, FileRecordItem } from './types/files.types';

const FOLDER_CARD_PALETTE = [
  { main: '#3b82f6', tab: '#93c5fd', bg: '#eff6ff' },
  { main: '#f59e0b', tab: '#fcd34d', bg: '#fffbeb' },
  { main: '#8b5cf6', tab: '#c4b5fd', bg: '#f5f3ff' },
  { main: '#10b981', tab: '#6ee7b7', bg: '#ecfdf5' },
  { main: '#ec4899', tab: '#f9a8d4', bg: '#fdf2f8' },
  { main: '#06b6d4', tab: '#67e8f9', bg: '#ecfeff' },
];

export const FileManagerPage: React.FC = () => {
  const [folders, setFolders] = useState<FileFolderItem[]>([]);
  const [files, setFiles] = useState<FileRecordItem[]>([]);
  const [allActiveFiles, setAllActiveFiles] = useState<FileRecordItem[]>([]);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  // Điều hướng & Bộ lọc (Mục 6.1.7)
  const [navSection, setNavSection] = useState<
    'overview' | 'my_files' | 'recent' | 'shared' | 'starred' | 'missing' | 'trash'
  >('my_files');
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

  // Tạo thư mục ảo mới
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);

  // Tải file lên (Mục 6.1.1)
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadEncrypt, setUploadEncrypt] = useState<boolean>(false);

  // Gắn liên kết sử dụng file (Mục 6.1.8)
  const [showAddUsageForm, setShowAddUsageForm] = useState<boolean>(false);
  const [usageModule, setUsageModule] = useState<string>('lms_courses');
  const [usageEntityType, setUsageEntityType] = useState<string>('course_banner');
  const [usageEntityId, setUsageEntityId] = useState<string>('101');
  const [usageNote, setUsageNote] = useState<string>('Banner trang chủ khóa học');

  // Mở Popup <FilePickerModal /> đè lên trình duyệt
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pickedFromModal, setPickedFromModal] = useState<FileRecordItem[]>([]);

  // Thông báo trạng thái
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotice = (type: 'success' | 'error', message: string) => {
    setBanner({ type, message });
  };

  const viewMode = navSection === 'trash' ? 'trash' : 'active';

  const loadFoldersAndFiles = useCallback(async () => {
    setLoading(true);
    try {
      const [folderList, fileRes, allRes] = await Promise.all([
        filesApi.listFolders(false),
        filesApi.listFiles({
          page,
          limit: 20,
          ...(viewMode === 'trash'
            ? { status: 2 }
            : navSection === 'missing'
              ? { status: 4 }
              : {}),
          ...(selectedFolderId !== null && viewMode === 'active'
            ? { folderId: selectedFolderId }
            : {}),
          ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
          ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
          ...(navSection === 'shared' ? { onlyReferenced: true } : {}),
        }),
        filesApi.listFiles({ page: 1, limit: 100, status: 1 }),
      ]);
      setFolders(folderList);
      setAllActiveFiles(allRes.data);

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
  }, [page, viewMode, selectedFolderId, searchQuery, categoryFilter, navSection, sortBy]);

  useEffect(() => {
    void loadFoldersAndFiles();
  }, [loadFoldersAndFiles]);

  const handleSelectFileDetail = async (id: number) => {
    try {
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
          encryptAtRest: uploadEncrypt,
        });
        showNotice('success', `Đã tải lên hàng loạt ${batch.uploadedCount} tệp thành công`);
        await loadFoldersAndFiles();
      }
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Tải file lên thất bại');
    } finally {
      setUploading(false);
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
    moduleName: string,
    entityType: string,
    entityId: string,
    fieldName: string | null,
  ) => {
    try {
      await filesApi.detachUsage(fileId, {
        moduleName,
        entityType,
        entityId,
        fieldName,
      });
      showNotice('success', `Đã gỡ liên kết [${moduleName}.${entityType}#${entityId}]`);
      await loadFoldersAndFiles();
      await handleSelectFileDetail(fileId);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Gỡ liên kết thất bại');
    }
  };

  const renderFileTypeIconBox = (item: FileRecordItem, size: 'sm' | 'md' = 'sm') => {
    const dim = size === 'md' ? '38px' : '34px';
    const ext = item.extension.replace('.', '').toUpperCase();
    switch (item.category) {
      case 1:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
              color: '#1d4ed8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ImageIcon size={18} />
          </div>
        );
      case 2:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
              color: '#6d28d9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Film size={18} />
          </div>
        );
      case 3:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: '#fae8ff',
              color: '#a21caf',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Music size={18} />
          </div>
        );
      case 4:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: ext === 'PDF' ? '#fee2e2' : '#dbeafe',
              color: ext === 'PDF' ? '#dc2626' : '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '0.7rem',
              flexShrink: 0,
            }}
          >
            {ext === 'PDF' ? 'PDF' : <FileText size={18} />}
          </div>
        );
      case 5:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: '#d1fae5',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '0.72rem',
              flexShrink: 0,
            }}
          >
            <Table size={18} />
          </div>
        );
      case 6:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: '#fef3c7',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Archive size={18} />
          </div>
        );
      default:
        return (
          <div
            style={{
              width: dim,
              height: dim,
              borderRadius: '9px',
              background: '#f1f5f9',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileIcon size={18} />
          </div>
        );
    }
  };

  const countFolderItems = (folderId: number) =>
    allActiveFiles.filter((f) => f.folderId === folderId).length;

  const activeFolderObj = folders.find((f) => f.id === selectedFolderId) ?? null;

  return (
    <main
      style={{
        maxWidth: '1540px',
        margin: '0 auto',
        padding: '1rem 1.25rem 2.5rem',
      }}
    >
      {/* Hidden input cho nút Tải lên */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          void handleDirectUploadFiles(list);
          e.currentTarget.value = '';
        }}
      />

      {/* Banner thông báo thao tác */}
      {banner && (
        <div
          style={{
            padding: '0.75rem 1.1rem',
            borderRadius: '12px',
            marginBottom: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: banner.type === 'success' ? '#ecfdf5' : '#fef2f2',
            border: banner.type === 'success' ? '1px solid #a7f3d0' : '1px solid #fecaca',
            color: banner.type === 'success' ? '#065f46' : '#991b1b',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {banner.type === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* KHUNG ỨNG DỤNG CLOUDBOX FILE MANAGER (3 CỘT CHUẨN ENTERPRISE) */}
      <div
        style={{
          background: '#f8fafc',
          color: '#0f172a',
          borderRadius: '20px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.18)',
          display: 'grid',
          gridTemplateColumns: '245px 1fr 355px',
          minHeight: '820px',
          overflow: 'hidden',
        }}
      >
        {/* ================= CỘT 1: SIDEBAR TRÁI (CLOUDBOX) ================= */}
        <aside
          style={{
            background: '#ffffff',
            borderRight: '1px solid #e2e8f0',
            padding: '1.25rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            {/* Logo CloudBox */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0 0.4rem 1.15rem',
              }}
            >
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 10px rgba(37, 99, 235, 0.28)',
                }}
              >
                <Cloud size={19} />
              </div>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  CloudBox
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                  Shared Media & Storage
                </div>
              </div>
            </div>

            {/* Menu điều hướng chính */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {[
                { id: 'overview', label: 'Tổng quan', icon: <Home size={16} /> },
                { id: 'my_files', label: 'Tệp của tôi', icon: <Folder size={16} /> },
                { id: 'recent', label: 'Gần đây', icon: <Clock size={16} /> },
                { id: 'shared', label: 'Đã chia sẻ / Liên kết', icon: <Share2 size={16} /> },
                { id: 'starred', label: 'Yêu thích', icon: <Star size={16} /> },
                { id: 'missing', label: 'Mất file vật lý', icon: <AlertCircle size={16} /> },
                { id: 'trash', label: 'Thùng rác', icon: <Trash2 size={16} /> },
              ].map((nav) => {
                const active = navSection === nav.id && selectedFolderId === null;
                return (
                  <button
                    key={nav.id}
                    type="button"
                    onClick={() => {
                      setNavSection(
                        nav.id as
                          | 'overview'
                          | 'my_files'
                          | 'recent'
                          | 'shared'
                          | 'starred'
                          | 'missing'
                          | 'trash',
                      );
                      setSelectedFolderId(null);
                      setPage(1);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: active ? '#eff6ff' : 'transparent',
                      color: active ? '#2563eb' : '#475569',
                      fontWeight: active ? 700 : 500,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {nav.icon}
                    <span>{nav.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Danh sách Thư mục ảo */}
            <div
              style={{
                marginTop: '1.25rem',
                paddingTop: '1rem',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 0.5rem',
                  marginBottom: '0.5rem',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  color: '#64748b',
                }}
              >
                <span>Thư mục</span>
                <button
                  type="button"
                  onClick={() => setShowNewFolderInput((prev) => !prev)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#475569',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                  title="Tạo thư mục mới"
                >
                  <Plus size={15} />
                </button>
              </div>

              {showNewFolderInput && (
                <form
                  onSubmit={(e) => void handleCreateFolder(e)}
                  style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.55rem' }}
                >
                  <input
                    type="text"
                    placeholder="Tên thư mục mới..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.38rem 0.55rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={creatingFolder}
                    style={{
                      padding: '0.38rem 0.6rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#2563eb',
                      color: '#ffffff',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Tạo
                  </button>
                </form>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {folders.map((folder, index) => {
                  const palette =
                    FOLDER_CARD_PALETTE[index % FOLDER_CARD_PALETTE.length] ??
                    FOLDER_CARD_PALETTE[0]!;
                  const active = selectedFolderId === folder.id && viewMode === 'active';
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        setNavSection('my_files');
                        setSelectedFolderId(folder.id);
                        setPage(1);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '0.48rem 0.65rem',
                        borderRadius: '9px',
                        border: 'none',
                        background: active ? '#eff6ff' : 'transparent',
                        color: active ? '#2563eb' : '#334155',
                        fontWeight: active ? 600 : 500,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.55rem',
                          overflow: 'hidden',
                        }}
                      >
                        <Folder
                          size={16}
                          fill={palette.main}
                          color={palette.main}
                          style={{ flexShrink: 0 }}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {folder.name}
                        </span>
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                        {countFolderItems(folder.id)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Khối Dung lượng lưu trữ & Hoạt động gần đây ở đáy Sidebar trái */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
            <div
              style={{
                padding: '0.9rem',
                borderRadius: '14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>
                Dung lượng lưu trữ
              </div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '999px',
                  background: '#e2e8f0',
                  margin: '0.55rem 0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '26%',
                    height: '100%',
                    borderRadius: '999px',
                    background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.73rem',
                  color: '#64748b',
                  marginBottom: '0.65rem',
                }}
              >
                <span>
                  <strong style={{ color: '#2563eb' }}>12.6 GB</strong> / 50 GB
                </span>
                <span>25%</span>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{
                  width: '100%',
                  padding: '0.48rem 0.65rem',
                  borderRadius: '9px',
                  border: '1px solid #bfdbfe',
                  background: '#eff6ff',
                  color: '#2563eb',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  cursor: 'pointer',
                }}
              >
                <Sparkles size={14} />
                <span>Mở Popup Chọn File</span>
              </button>
            </div>

            {/* Hoạt động gần đây */}
            <div>
              <div
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: '0.55rem',
                  padding: '0 0.25rem',
                }}
              >
                Hoạt động gần đây
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '999px',
                      background: '#eff6ff',
                      color: '#2563eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Upload size={13} />
                  </div>
                  <div style={{ fontSize: '0.72rem', lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>Đã đồng bộ {totalFiles} tệp</div>
                    <div style={{ color: '#94a3b8' }}>Vừa xong</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '999px',
                      background: '#fef3c7',
                      color: '#d97706',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Link2 size={13} />
                  </div>
                  <div style={{ fontSize: '0.72rem', lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>
                      4 liên kết bảo vệ chống xóa
                    </div>
                    <div style={{ color: '#94a3b8' }}>Đang hoạt động</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ================= CỘT 2: KHU VỰC TRUNG TÂM ================= */}
        <section
          style={{
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.2rem',
            background: '#f8fafc',
            overflowY: 'auto',
          }}
        >
          {/* Thanh Tìm kiếm trên cùng + User Info */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '0.55rem 0.9rem',
                flex: 1,
                maxWidth: '520px',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
              }}
            >
              <Search size={16} color="#94a3b8" />
              <input
                type="text"
                placeholder="Tìm kiếm tệp, thư mục, nội dung..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                style={{
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                  background: 'transparent',
                  color: '#0f172a',
                  fontSize: '0.85rem',
                }}
              />
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: '5px',
                  background: '#f1f5f9',
                  color: '#64748b',
                  fontWeight: 600,
                }}
              >
                ⌘K
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.76rem',
                  color: '#475569',
                  background: '#ffffff',
                  padding: '0.4rem 0.7rem',
                  borderRadius: '9px',
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                }}
                title="Tùy chọn mã hóa AES-256-GCM khi tải lên"
              >
                <input
                  type="checkbox"
                  checked={uploadEncrypt}
                  onChange={(e) => setUploadEncrypt(e.target.checked)}
                />
                <span>Mã hóa AES-256 khi tải lên</span>
              </label>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  background: '#ffffff',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '999px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '999px',
                    background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                    color: '#ffffff',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  QT
                </div>
                <div style={{ fontSize: '0.76rem', lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>Quản trị viên</div>
                  <div style={{ color: '#64748b', fontSize: '0.68rem' }}>admin@core.local</div>
                </div>
              </div>
            </div>
          </div>

          {/* Thông báo kết quả chọn từ Popup FilePickerModal */}
          {pickedFromModal.length > 0 && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.83rem',
                color: '#1e40af',
              }}
            >
              <div>
                <strong>Đã chọn từ Popup &lt;FilePickerModal /&gt;:</strong>{' '}
                {pickedFromModal.map((f) => `${f.displayName} (${f.sizeFormatted})`).join(', ')}
              </div>
              <button
                type="button"
                onClick={() => setPickedFromModal([])}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#1e40af',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Breadcrumb + Tiêu đề Thư mục hiện tại */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.78rem',
                color: '#64748b',
                marginBottom: '0.55rem',
              }}
            >
              <Home size={14} />
              <ChevronRight size={13} />
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setNavSection('my_files');
                  setSelectedFolderId(null);
                }}
              >
                Tệp của tôi
              </span>
              <ChevronRight size={13} />
              <span style={{ color: '#0f172a', fontWeight: 700 }}>
                {viewMode === 'trash'
                  ? 'Thùng rác (Chờ xóa vĩnh viễn)'
                  : activeFolderObj
                  ? activeFolderObj.name
                  : 'Kho Tài Nguyên Dự Án'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: '#dbeafe',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Folder size={24} fill="#3b82f6" color="#2563eb" />
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                    {viewMode === 'trash'
                      ? 'Thùng rác hệ thống'
                      : activeFolderObj
                      ? activeFolderObj.name
                      : 'Website & Học liệu số'}
                  </h1>
                  <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {folders.length} thư mục • {totalFiles} tệp tin
                  </div>
                </div>
              </div>

              {/* Nhóm Avatar cộng tác viên */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {['NM', 'TT', 'LH'].map((initials, i) => (
                  <div
                    key={initials}
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '999px',
                      background: i === 0 ? '#2563eb' : i === 1 ? '#059669' : '#d97706',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid #f8fafc',
                      marginLeft: i === 0 ? 0 : '-8px',
                    }}
                  >
                    {initials}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Thanh Công Cụ Hành Động (Tải lên, Tạo thư mục, Chọn đính kèm, Bộ lọc) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={uploading}
                onClick={() => uploadInputRef.current?.click()}
                style={{
                  padding: '0.55rem 1rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.83rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                }}
              >
                <Upload size={15} />
                <span>{uploading ? 'Đang tải lên...' : 'Tải lên'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowNewFolderInput(true)}
                style={{
                  padding: '0.55rem 0.9rem',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  cursor: 'pointer',
                }}
              >
                <FolderPlus size={15} />
                <span>Tạo thư mục</span>
              </button>

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{
                  padding: '0.55rem 0.9rem',
                  borderRadius: '10px',
                  border: '1px solid #bfdbfe',
                  background: '#eff6ff',
                  color: '#2563eb',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  cursor: 'pointer',
                }}
              >
                <Share2 size={15} />
                <span>Chọn tệp đính kèm (Popup)</span>
              </button>

              {selectedFile && selectedFile.status === 1 && (
                <button
                  type="button"
                  onClick={() =>
                    void filesApi
                      .downloadFileWithAuth(selectedFile)
                      .catch((err: unknown) =>
                        showNotice('error', err instanceof Error ? err.message : 'Lỗi tải xuống'),
                      )
                  }
                  style={{
                    padding: '0.55rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    color: '#334155',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={15} />
                  <span>Tải xuống</span>
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select
                value={categoryFilter ?? ''}
                onChange={(e) => {
                  setCategoryFilter(e.target.value ? Number(e.target.value) : undefined);
                  setPage(1);
                }}
                style={{
                  padding: '0.45rem 0.7rem',
                  borderRadius: '9px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#334155',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                }}
              >
                <option value="">Tất cả loại</option>
                <option value="1">Hình ảnh</option>
                <option value="2">Video</option>
                <option value="4">Tài liệu</option>
                <option value="5">Bảng tính</option>
                <option value="6">Tệp nén</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'size')}
                style={{
                  padding: '0.45rem 0.7rem',
                  borderRadius: '9px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#334155',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                }}
              >
                <option value="newest">Sắp xếp: Mới nhất</option>
                <option value="name">Sắp xếp: Tên A-Z</option>
                <option value="size">Sắp xếp: Kích thước</option>
              </select>

              <div
                style={{
                  display: 'inline-flex',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '9px',
                  padding: '2px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setLayoutMode('grid')}
                  style={{
                    padding: '0.32rem 0.45rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: layoutMode === 'grid' ? '#eff6ff' : 'transparent',
                    color: layoutMode === 'grid' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('list')}
                  style={{
                    padding: '0.32rem 0.45rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: layoutMode === 'list' ? '#eff6ff' : 'transparent',
                    color: layoutMode === 'list' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <List size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* KHU VỰC THẺ THƯ MỤC (FOLDER CARDS GIỐNG HỆT ẢNH CLOUDBOX) */}
          {viewMode === 'active' && folders.length > 0 && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.65rem',
                }}
              >
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                  Thư mục
                </span>
                {selectedFolderId !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#2563eb',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Xem tất cả thư mục →
                  </button>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                {folders.map((folder, idx) => {
                  const palette =
                    FOLDER_CARD_PALETTE[idx % FOLDER_CARD_PALETTE.length] ??
                    FOLDER_CARD_PALETTE[0]!;
                  const isCurrent = selectedFolderId === folder.id;
                  const count = countFolderItems(folder.id);
                  return (
                    <div
                      key={folder.id}
                      onClick={() =>
                        setSelectedFolderId((prev) => (prev === folder.id ? null : folder.id))
                      }
                      style={{
                        background: '#ffffff',
                        borderRadius: '14px',
                        padding: '0.9rem 1rem',
                        border: isCurrent ? `2px solid ${palette.main}` : '1px solid #e2e8f0',
                        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.55rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div
                          style={{
                            width: '48px',
                            height: '38px',
                            borderRadius: '10px',
                            background: palette.bg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Folder size={28} fill={palette.main} color={palette.main} />
                        </div>
                        <MoreHorizontal size={16} color="#94a3b8" />
                      </div>

                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={folder.name}
                        >
                          {folder.name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                          {count} mục • {folder.folderPath}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KHU VỰC DANH SÁCH TỆP TIN */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.65rem',
              }}
            >
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                Tệp ({files.length})
              </span>
              {viewMode === 'trash' && (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await filesApi.purgeExpiredTrash();
                    showNotice('success', `Đã dọn ${res.purgedCount} tệp quá hạn trong thùng rác`);
                    await loadFoldersAndFiles();
                  }}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Dọn các file hết hạn chờ
                </button>
              )}
            </div>

            <div
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
              }}
            >
              {loading ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                  Đang tải danh sách tệp...
                </div>
              ) : files.length === 0 ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                  Chưa có tệp nào trong danh mục này. Nhấn nút <strong>Tải lên</strong> để thêm tệp mới.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        color: '#64748b',
                        fontSize: '0.76rem',
                        textAlign: 'left',
                      }}
                    >
                      <th style={{ padding: '0.7rem 0.85rem', width: '32px' }}>
                        <input type="checkbox" readOnly checked={false} />
                      </th>
                      <th style={{ padding: '0.7rem 0.5rem' }}>Tên</th>
                      <th style={{ padding: '0.7rem 0.5rem' }}>Chủ sở hữu</th>
                      <th style={{ padding: '0.7rem 0.5rem' }}>Cập nhật gần nhất ↓</th>
                      <th style={{ padding: '0.7rem 0.5rem' }}>Kích thước</th>
                      <th style={{ padding: '0.7rem 0.85rem', textAlign: 'right' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((item) => {
                      const isSelected = selectedFile?.id === item.id;
                      const ownerName =
                        item.uploadedByUser?.fullName ??
                        item.uploadedByUser?.username ??
                        'Nguyễn Văn Minh';
                      return (
                        <tr
                          key={item.id}
                          onClick={() => void handleSelectFileDetail(item.id)}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: isSelected ? '#eff6ff' : '#ffffff',
                            cursor: 'pointer',
                            transition: 'background 0.12s ease',
                          }}
                        >
                          <td style={{ padding: '0.68rem 0.85rem' }}>
                            <input type="checkbox" readOnly checked={isSelected} />
                          </td>
                          <td style={{ padding: '0.68rem 0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                              {renderFileTypeIconBox(item, 'sm')}
                              <div>
                                <div style={{ fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                  <span>{item.displayName}</span>
                                  {item.status === 4 && (
                                    <span
                                      style={{
                                        padding: '2px 7px',
                                        borderRadius: '999px',
                                        background: '#fef2f2',
                                        border: '1px solid #fecaca',
                                        color: '#dc2626',
                                        fontSize: '0.67rem',
                                        fontWeight: 700,
                                      }}
                                    >
                                      ⚠️ Mất file vật lý
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                                  {item.code} • {item.folderName ?? 'Thư mục gốc'}
                                  {item.usageCount > 0 ? ` • 🔒 ${item.usageCount} liên kết` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '0.68rem 0.5rem' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                              <div
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '999px',
                                  background: '#dbeafe',
                                  color: '#1d4ed8',
                                  fontSize: '0.66rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {ownerName.slice(0, 2).toUpperCase()}
                              </div>
                              <span style={{ color: '#334155', fontWeight: 500 }}>{ownerName}</span>
                            </div>
                          </td>
                          <td style={{ padding: '0.68rem 0.5rem', color: '#64748b' }}>
                            {new Date(item.updatedAt).toLocaleString('vi-VN')}
                          </td>
                          <td style={{ padding: '0.68rem 0.5rem', color: '#334155', fontWeight: 600 }}>
                            {item.sizeFormatted}
                          </td>
                          <td
                            style={{ padding: '0.68rem 0.85rem', textAlign: 'right' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                              {item.status === 1 ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void filesApi
                                        .downloadFileWithAuth(item)
                                        .catch((err: unknown) =>
                                          showNotice(
                                            'error',
                                            err instanceof Error ? err.message : 'Lỗi tải file',
                                          ),
                                        )
                                    }
                                    style={{
                                      padding: '0.32rem 0.5rem',
                                      borderRadius: '7px',
                                      border: '1px solid #e2e8f0',
                                      background: '#ffffff',
                                      color: '#475569',
                                      cursor: 'pointer',
                                    }}
                                    title="Tải xuống"
                                  >
                                    <Download size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleMoveToTrash(item)}
                                    style={{
                                      padding: '0.32rem 0.5rem',
                                      borderRadius: '7px',
                                      border: '1px solid #e2e8f0',
                                      background: '#ffffff',
                                      color: item.usageCount > 0 ? '#94a3b8' : '#dc2626',
                                      cursor: 'pointer',
                                    }}
                                    title={
                                      item.usageCount > 0
                                        ? 'Đang có liên kết dữ liệu — bấm để kiểm tra chặn xóa'
                                        : 'Đưa vào thùng rác'
                                    }
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleRestoreFromTrash(item)}
                                    style={{
                                      padding: '0.32rem 0.55rem',
                                      borderRadius: '7px',
                                      border: '1px solid #bfdbfe',
                                      background: '#eff6ff',
                                      color: '#2563eb',
                                      cursor: 'pointer',
                                      fontSize: '0.74rem',
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                    }}
                                  >
                                    <RotateCcw size={13} />
                                    <span>Khôi phục</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handlePurgeFile(item)}
                                    style={{
                                      padding: '0.32rem 0.55rem',
                                      borderRadius: '7px',
                                      border: '1px solid #fecaca',
                                      background: '#fef2f2',
                                      color: '#dc2626',
                                      cursor: 'pointer',
                                      fontSize: '0.74rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Xóa hẳn
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                  marginTop: '0.75rem',
                }}
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{
                    padding: '0.38rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Trước
                </button>
                <span style={{ alignSelf: 'center', fontSize: '0.8rem', color: '#475569' }}>
                  Trang {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{
                    padding: '0.38rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Sau
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ================= CỘT 3: PANEL THÔNG TIN CHI TIẾT BÊN PHẢI ================= */}
        <aside
          style={{
            background: '#ffffff',
            borderLeft: '1px solid #e2e8f0',
            padding: '1.25rem 1.15rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.1rem',
          }}
        >
          {!selectedFile ? (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
              Chọn một tệp ở danh sách giữa để xem trước nội dung, đổi tên (bất biến đường dẫn lưu trữ) và kiểm tra liên kết sử dụng.
            </div>
          ) : (
            <>
              {/* Header File đang chọn */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.6rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', overflow: 'hidden' }}>
                  {renderFileTypeIconBox(selectedFile, 'md')}
                  <div style={{ overflow: 'hidden' }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: '0.96rem',
                        color: '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={selectedFile.displayName}
                    >
                      {selectedFile.displayName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {selectedFile.categoryName} • {selectedFile.sizeFormatted}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                >
                  <X size={17} />
                </button>
              </div>

              {/* Hộp Preview trực quan (Video Player HTTP 206 hoặc Banner Preview) */}
              {selectedFile.status === 1 && selectedFile.category === 2 ? (
                <div
                  style={{
                    borderRadius: '14px',
                    overflow: 'hidden',
                    background: '#0f172a',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <video
                    controls
                    preload="metadata"
                    src={filesApi.getStreamUrl(selectedFile.id)}
                    style={{ width: '100%', maxHeight: '185px', display: 'block' }}
                  />
                  <div
                    style={{
                      padding: '0.4rem 0.7rem',
                      fontSize: '0.7rem',
                      color: '#bae6fd',
                      background: '#020617',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>🎬 Phát & Tua trực tiếp (HTTP 206 Partial Content)</span>
                    <span>Byte-Range</span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: '165px',
                    borderRadius: '14px',
                    background:
                      'linear-gradient(135deg, #dbeafe 0%, #eff6ff 45%, #e0e7ff 100%)',
                    border: '1px solid #bfdbfe',
                    padding: '1.1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '999px',
                        background: '#ffffff',
                        color: '#2563eb',
                      }}
                    >
                      {selectedFile.code}
                    </span>
                    <div
                      style={{
                        fontSize: '1.02rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        marginTop: '0.55rem',
                        lineHeight: 1.3,
                      }}
                    >
                      Kết nối ý tưởng
                      <br />
                      Kiến tạo tương lai
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.25rem' }}>
                      {selectedFile.originalName}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        background: '#2563eb',
                        color: '#ffffff',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                      }}
                    >
                      Magic Bytes Verified
                    </span>
                  </div>
                </div>
              )}

              {selectedFile.status === 4 && (
                <div
                  style={{
                    padding: '0.65rem 0.8rem',
                    borderRadius: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    lineHeight: 1.4,
                  }}
                >
                  ⚠️ File vật lý trên đĩa không còn tồn tại ({selectedFile.storageKey}). Hệ thống đã tự động đánh dấu trạng thái <strong>MISSING (Mất file vật lý)</strong> trong Database.
                </div>
              )}

              {/* Hàng Nút Thao Tác Nhanh: Mở | Tải xuống | Đổi tên */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem' }}>
                <a
                  href={filesApi.getStreamUrl(selectedFile.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: '0.5rem 0.65rem',
                    borderRadius: '9px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#2563eb',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <Eye size={14} />
                  <span>Mở</span>
                </a>

                <button
                  type="button"
                  onClick={() =>
                    void filesApi
                      .downloadFileWithAuth(selectedFile)
                      .catch((err: unknown) =>
                        showNotice('error', err instanceof Error ? err.message : 'Lỗi tải file'),
                      )
                  }
                  style={{
                    padding: '0.5rem 0.65rem',
                    borderRadius: '9px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={14} />
                  <span>Tải xuống</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowRenameBox((prev) => !prev)}
                  style={{
                    padding: '0.5rem 0.65rem',
                    borderRadius: '9px',
                    border: '1px solid #e2e8f0',
                    background: showRenameBox ? '#eff6ff' : '#f8fafc',
                    color: '#334155',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                  title="Đổi tên hiển thị & Di chuyển thư mục (Không đổi Storage Key gốc)"
                >
                  <Edit3 size={14} />
                </button>
              </div>

              {/* Hộp Đổi tên & Chuyển thư mục ảo (Mục 6.1.4) */}
              {showRenameBox && (
                <form
                  onSubmit={(e) => void handleRenameOrMoveFile(e)}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '12px',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#0f172a' }}>
                    Đổi tên hiển thị (Giữ nguyên Storage Key vật lý)
                  </div>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                    }}
                  />
                  <select
                    value={moveFolderValue ?? ''}
                    onChange={(e) =>
                      setMoveFolderValue(e.target.value ? Number(e.target.value) : null)
                    }
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                    }}
                  >
                    <option value="">Thư mục gốc (Root)</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    style={{
                      padding: '0.45rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#2563eb',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                  >
                    Lưu thay đổi
                  </button>
                </form>
              )}

              {/* Thông tin chi tiết (Mục 6.1.2) */}
              <div>
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    marginBottom: '0.65rem',
                  }}
                >
                  Thông tin chi tiết
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '98px 1fr',
                    rowGap: '0.55rem',
                    columnGap: '0.5rem',
                    fontSize: '0.78rem',
                  }}
                >
                  <span style={{ color: '#64748b' }}>Tên tệp</span>
                  <strong style={{ color: '#0f172a', wordBreak: 'break-word' }}>
                    {selectedFile.displayName}
                  </strong>

                  <span style={{ color: '#64748b' }}>Loại tệp</span>
                  <span style={{ color: '#0f172a', fontWeight: 500 }}>
                    {selectedFile.categoryName} ({selectedFile.extension.toUpperCase()})
                  </span>

                  <span style={{ color: '#64748b' }}>Kích thước</span>
                  <span style={{ color: '#0f172a' }}>
                    {selectedFile.sizeFormatted} ({selectedFile.sizeBytes.toLocaleString()} bytes)
                  </span>

                  <span style={{ color: '#64748b' }}>Vị trí</span>
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>
                    Tệp của tôi / {selectedFile.folderName ?? 'Kho chung'}
                  </span>

                  <span style={{ color: '#64748b' }}>Storage Key</span>
                  <code
                    style={{
                      fontSize: '0.7rem',
                      color: '#0284c7',
                      background: '#f0f9ff',
                      padding: '2px 5px',
                      borderRadius: '5px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {selectedFile.storageKey}
                  </code>

                  <span style={{ color: '#64748b' }}>Chủ sở hữu</span>
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>
                    {selectedFile.uploadedByUser?.fullName ?? 'Nguyễn Văn Minh'}
                  </span>

                  <span style={{ color: '#64748b' }}>Đã sửa đổi</span>
                  <span style={{ color: '#334155' }}>
                    {new Date(selectedFile.updatedAt).toLocaleString('vi-VN')}
                  </span>

                  <span style={{ color: '#64748b' }}>Đã tạo</span>
                  <span style={{ color: '#334155' }}>
                    {new Date(selectedFile.createdAt).toLocaleString('vi-VN')}
                  </span>
                </div>
              </div>

              {/* Thẻ & Liên kết sử dụng dữ liệu (Mục 6.1.8) */}
              <div
                style={{
                  paddingTop: '0.85rem',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.55rem',
                  }}
                >
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                    Thẻ & Liên kết sử dụng ({selectedFile.usageCount})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddUsageForm((prev) => !prev)}
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '999px',
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      color: '#334155',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Thêm liên kết
                  </button>
                </div>

                {/* Các thẻ màu (Pills) + Danh sách liên kết đang khóa xóa */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: '#dbeafe',
                      color: '#1d4ed8',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                    }}
                  >
                    {selectedFile.categoryName.toLowerCase()}
                  </span>
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: '#f3e8ff',
                      color: '#7c3aed',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                    }}
                  >
                    {selectedFile.visibility === 2 ? 'dùng-chung' : 'nội-bộ'}
                  </span>
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: selectedFile.usageCount > 0 ? '#dcfce7' : '#f1f5f9',
                      color: selectedFile.usageCount > 0 ? '#15803d' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                    }}
                  >
                    {selectedFile.usageCount > 0 ? '🔒 đang-khóa-xóa' : 'có-thể-xóa'}
                  </span>
                </div>

                {selectedFile.usages && selectedFile.usages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {selectedFile.usages.map((u) => (
                      <div
                        key={u.id}
                        style={{
                          padding: '0.45rem 0.6rem',
                          borderRadius: '8px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          fontSize: '0.74rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <strong style={{ color: '#0f172a' }}>
                            {u.moduleName}.{u.entityType} #{u.entityId}
                          </strong>
                          {u.note && <div style={{ color: '#64748b', fontSize: '0.69rem' }}>{u.note}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDetachUsage(
                              selectedFile.id,
                              u.moduleName,
                              u.entityType,
                              u.entityId,
                              u.fieldName,
                            )
                          }
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#dc2626',
                            cursor: 'pointer',
                          }}
                          title="Gỡ liên kết này"
                        >
                          <Unlink size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddUsageForm && (
                  <form
                    onSubmit={(e) => void handleAttachUsage(e)}
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.6rem',
                      borderRadius: '10px',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.4rem',
                    }}
                  >
                    <input
                      type="text"
                      value={usageModule}
                      onChange={(e) => setUsageModule(e.target.value)}
                      placeholder="Module"
                      style={{
                        padding: '0.35rem 0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                      }}
                    />
                    <input
                      type="text"
                      value={usageEntityType}
                      onChange={(e) => setUsageEntityType(e.target.value)}
                      placeholder="Entity"
                      style={{
                        padding: '0.35rem 0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                      }}
                    />
                    <input
                      type="text"
                      value={usageEntityId}
                      onChange={(e) => setUsageEntityId(e.target.value)}
                      placeholder="ID"
                      style={{
                        padding: '0.35rem 0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                      }}
                    />
                    <input
                      type="text"
                      value={usageNote}
                      onChange={(e) => setUsageNote(e.target.value)}
                      placeholder="Ghi chú"
                      style={{
                        padding: '0.35rem 0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        gridColumn: 'span 2',
                        padding: '0.4rem',
                        borderRadius: '7px',
                        border: 'none',
                        background: '#2563eb',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Gắn liên kết bảo vệ file
                    </button>
                  </form>
                )}
              </div>

              {/* Quyền truy cập ở đáy Cột 3 */}
              <div
                style={{
                  paddingTop: '0.85rem',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                    Quyền truy cập
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: '#2563eb',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    {selectedFile.visibility === 2 ? <Globe size={13} /> : <Lock size={13} />}
                    {selectedFile.visibilityName}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ display: 'flex' }}>
                    {['NM', 'TT', 'LH'].map((init, idx) => (
                      <div
                        key={init}
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '999px',
                          background: idx === 0 ? '#2563eb' : idx === 1 ? '#059669' : '#7c3aed',
                          color: '#ffffff',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '2px solid #ffffff',
                          marginLeft: idx === 0 ? 0 : '-6px',
                        }}
                      >
                        {init}
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Được chia sẻ trong tổ chức
                  </span>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* HỘP THOẠI POPUP CHỌN TỆP ĐÍNH KÈM (MỞ SONG SONG ĐÈ LÊN TRÌNH DUYỆT) */}
      <FilePickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple={true}
        onSelect={(picked) => {
          setPickedFromModal(picked);
          showNotice(
            'success',
            `Đã chọn ${picked.length} tệp từ Popup "Chọn tệp đính kèm"!`,
          );
          void loadFoldersAndFiles();
        }}
      />
    </main>
  );
};
