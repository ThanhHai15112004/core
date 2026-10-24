import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  Upload,
  Check,
  Search,
  X,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Table,
  File as FileIcon,
  Lock,
  Globe,
  Clock,
  Share2,
  LayoutGrid,
  List,
  Plus,
  Link2,
  Maximize2,
  Play,
  MoreVertical,
  CloudUpload,
} from 'lucide-react';
import { FOLDER_COLORS } from '../enum/files.enum';
import { filesApi } from '../services/files.api';
import type { FileFolderItem, FileRecordItem } from '../types/files.types';

export interface FilePickerModalProps {
  /** Điều khiển đóng/mở hộp thoại chọn file dùng chung */
  isOpen: boolean;
  /** Đóng hộp thoại */
  onClose: () => void;
  /** Callback trả về danh sách các file được chọn từ thư viện hoặc vừa tải lên */
  onSelect: (selectedFiles: FileRecordItem[]) => void;
  /** Cho phép chọn nhiều file cùng lúc (mặc định: false = chọn 1 file) */
  multiple?: boolean;
  /** Giới hạn lọc theo phân loại mặc định (1=IMAGE, 2=VIDEO, 3=AUDIO, 4=DOCUMENT, 5=SPREADSHEET, 6=ARCHIVE) */
  defaultCategory?: number;
  /** Tiêu đề hiển thị trên modal */
  title?: string;
}

export const FilePickerModal: React.FC<FilePickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  multiple = false,
  defaultCategory,
  title = 'Chọn tệp đính kèm',
}) => {
  const [topTab, setTopTab] = useState<'upload_and_pick' | 'my_library' | 'recent' | 'shared'>(
    'upload_and_pick',
  );
  const [folders, setFolders] = useState<FileFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(defaultCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'size'>('newest');
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>('grid');

  const [files, setFiles] = useState<FileRecordItem[]>([]);
  const [allActiveFiles, setAllActiveFiles] = useState<FileRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  // Map các file được tick chọn & file đang hiển thị ở cột Inspector bên phải
  const [selectedMap, setSelectedMap] = useState<Record<number, FileRecordItem>>({});
  const [focusedFile, setFocusedFile] = useState<FileRecordItem | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'info' | 'activity'>('info');

  // Upload trạng thái ngay trên cùng (Drag & Drop hoặc chọn từ máy)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);

  const loadLibrary = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [folderList, filteredRes, allRes] = await Promise.all([
        filesApi.listFolders(false),
        filesApi.listFiles({
          page: 1,
          limit: 60,
          status: 1,
          ...(selectedFolderId !== null ? { folderId: selectedFolderId } : {}),
          ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
          ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
          ...(topTab === 'shared' ? { onlyReferenced: true } : {}),
        }),
        filesApi.listFiles({ page: 1, limit: 100, status: 1 }),
      ]);
      setFolders(folderList);
      setAllActiveFiles(allRes.data);

      const sorted = [...filteredRes.data].sort((a, b) => {
        if (sortBy === 'name') return a.displayName.localeCompare(b.displayName);
        if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setFiles(sorted);

      if (sorted[0]) {
        setFocusedFile((prev) => {
          if (prev && sorted.some((item) => item.id === prev.id)) return prev;
          return sorted[0] ?? null;
        });
        setSelectedMap((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          return sorted[0] ? { [sorted[0].id]: sorted[0] } : {};
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tải danh sách thư viện file');
    } finally {
      setLoading(false);
    }
  }, [isOpen, selectedFolderId, categoryFilter, searchQuery, sortBy, topTab]);

  const [focusedPreviewUrl, setFocusedPreviewUrl] = useState<string | null>(null);
  const [thumbUrlsById, setThumbUrlsById] = useState<Record<number, string>>({});
  const focusedId = focusedFile?.id;
  const focusedStatus = focusedFile?.status;
  const focusedCategory = focusedFile?.category;

  useEffect(() => {
    let cancelled = false;
    setFocusedPreviewUrl(null);
    if (!focusedId || focusedStatus !== 1 || focusedCategory !== 2) {
      return;
    }
    void filesApi.fetchAuthenticatedMediaUrl(focusedId, 'stream').then((url) => {
      if (!cancelled) setFocusedPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [focusedId, focusedStatus, focusedCategory]);

  useEffect(() => {
    let cancelled = false;
    const imageFiles = files.filter((f) => f.category === 1 && f.status === 1);
    for (const imgFile of imageFiles) {
      if (thumbUrlsById[imgFile.id]) continue;
      void filesApi.fetchAuthenticatedMediaUrl(imgFile.id, 'thumbnail').then((url) => {
        if (!cancelled && url) {
          setThumbUrlsById((prev) => (prev[imgFile.id] ? prev : { ...prev, [imgFile.id]: url }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [files, thumbUrlsById]);

  useEffect(() => {
    if (isOpen) {
      setCategoryFilter(defaultCategory);
      void loadLibrary();
    }
  }, [isOpen, defaultCategory, loadLibrary]);

  if (!isOpen) return null;

  const handleCardClick = (item: FileRecordItem) => {
    setFocusedFile(item);
    if (!multiple) {
      setSelectedMap({ [item.id]: item });
      return;
    }
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = item;
      }
      return next;
    });
  };

  const handleConfirmSelection = () => {
    const picked = Object.values(selectedMap);
    if (picked.length > 0) {
      onSelect(picked);
      onClose();
      return;
    }
    if (focusedFile) {
      onSelect([focusedFile]);
      onClose();
    }
  };

  const handleInstantUploadFiles = async (browserFileList: File[]) => {
    if (browserFileList.length === 0) return;
    setUploading(true);
    setUploadProgressPercent(0);
    setErrorMsg(null);
    try {
      const uploadedItems: FileRecordItem[] = [];
      for (const f of browserFileList) {
        const created = await filesApi.uploadBrowserFile(
          f,
          {
            folderId: selectedFolderId,
            visibility: 2,
            encryptAtRest: false,
          },
          (prog) => {
            setUploadProgressPercent(prog.percent);
          },
        );
        uploadedItems.push(created);
      }

      await loadLibrary();

      if (uploadedItems[0]) {
        setFocusedFile(uploadedItems[0]);
        const nextSelected: Record<number, FileRecordItem> = {};
        const itemsToPick = multiple ? uploadedItems : uploadedItems.slice(0, 1);
        for (const item of itemsToPick) {
          nextSelected[item.id] = item;
        }
        setSelectedMap(nextSelected);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tải file lên thất bại');
    } finally {
      setUploading(false);
      setUploadProgressPercent(0);
    }
  };

  // Đếm số lượng theo từng danh mục từ tập file hoạt động
  const countByCategory = (cat?: number) => {
    if (cat === undefined) return allActiveFiles.length;
    return allActiveFiles.filter((f) => f.category === cat).length;
  };

  const countByFolder = (folderId: number) =>
    allActiveFiles.filter((f) => f.folderId === folderId).length;

  const totalUsedBytes = allActiveFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
  const quotaBytes = 10 * 1024 * 1024 * 1024; // 10 GB
  const usedPercent = Math.min(100, Math.max(6, Math.round((totalUsedBytes / quotaBytes) * 100)));

  const getFileBadgeStyle = (category: number, ext: string) => {
    const cleanExt = ext.replace('.', '').toUpperCase() || 'FILE';
    switch (category) {
      case 1:
        return { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', label: cleanExt || 'IMG' };
      case 2:
        return { bg: '#eef2ff', color: '#4f46e5', border: '#c7d2fe', label: cleanExt || 'MP4' };
      case 3:
        return { bg: '#fdf4ff', color: '#c026d3', border: '#f5d0fe', label: cleanExt || 'MP3' };
      case 4:
        if (cleanExt === 'PDF') {
          return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'PDF' };
        }
        if (cleanExt === 'PPT' || cleanExt === 'PPTX') {
          return { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa', label: 'PPT' };
        }
        return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', label: cleanExt || 'DOC' };
      case 5:
        return { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', label: cleanExt || 'XLS' };
      case 6:
        return { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: cleanExt || 'ZIP' };
      default:
        return { bg: '#f8fafc', color: '#475569', border: '#e2e8f0', label: cleanExt };
    }
  };

  const renderCardThumbnail = (item: FileRecordItem) => {
    const badge = getFileBadgeStyle(item.category, item.extension);
    if (item.category === 1) {
      const thumbSrc = thumbUrlsById[item.id];
      return (
        <div
          style={{
            width: '100%',
            height: '108px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 50%, #f3e8ff 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {thumbSrc && (
            <img
              src={thumbSrc}
              alt={item.displayName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(124,58,237,0.18))',
              color: '#1e40af',
            }}
          >
            <ImageIcon size={28} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, marginTop: '0.25rem' }}>
              {item.displayName.slice(0, 18)}
            </span>
          </div>
        </div>
      );
    }

    if (item.category === 2) {
      return (
        <div
          style={{
            width: '100%',
            height: '108px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.22)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Play size={18} fill="#ffffff" />
          </div>
          <span
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '8px',
              padding: '2px 6px',
              borderRadius: '5px',
              background: 'rgba(0, 0, 0, 0.72)',
              fontSize: '0.68rem',
              fontWeight: 600,
            }}
          >
            HTTP 206
          </span>
        </div>
      );
    }

    return (
      <div
        style={{
          width: '100%',
          height: '108px',
          borderRadius: '10px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.6rem',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: '84%',
            height: '82px',
            background: '#ffffff',
            borderRadius: '6px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 6px rgba(15, 23, 42, 0.05)',
            padding: '0.5rem 0.65rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 800,
                padding: '1px 5px',
                borderRadius: '4px',
                background: badge.bg,
                color: badge.color,
              }}
            >
              {badge.label}
            </span>
            <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>{item.code}</span>
          </div>
          <div>
            <div
              style={{
                height: '5px',
                width: '85%',
                background: '#e2e8f0',
                borderRadius: '3px',
                marginBottom: '4px',
              }}
            />
            <div
              style={{
                height: '5px',
                width: '65%',
                background: '#f1f5f9',
                borderRadius: '3px',
                marginBottom: '4px',
              }}
            />
            <div
              style={{
                height: '5px',
                width: '75%',
                background: '#f1f5f9',
                borderRadius: '3px',
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const selectedCount = Object.keys(selectedMap).length;
  const currentFolderObj = folders.find((f) => f.id === focusedFile?.folderId) ?? null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
    >
      {/* Hidden input cho nút Tải lên & Kéo thả */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          void handleInstantUploadFiles(list);
          e.currentTarget.value = '';
        }}
      />

      <div
        style={{
          width: '100%',
          maxWidth: '1160px',
          height: '86vh',
          maxHeight: '820px',
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '18px',
          boxShadow: '0 25px 65px -12px rgba(15, 23, 42, 0.38)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 1. HEADER MODAL */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '11px',
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CloudUpload size={21} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                {title}
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Tải lên hoặc chọn file từ thư viện lưu trữ tập trung của bạn
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* 2. THANH ĐIỀU HƯỚNG TABS + Ô TÌM KIẾM */}
        <div
          style={{
            padding: '0.65rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            background: '#fafaf9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {[
              { id: 'upload_and_pick', label: 'Tải lên & Chọn file', icon: <Upload size={15} /> },
              { id: 'my_library', label: 'Thư viện của tôi', icon: <Folder size={15} /> },
              { id: 'recent', label: 'File gần đây', icon: <Clock size={15} /> },
              { id: 'shared', label: 'File đang liên kết', icon: <Share2 size={15} /> },
            ].map((t) => {
              const active = topTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setTopTab(t.id as 'upload_and_pick' | 'my_library' | 'recent' | 'shared')
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.48rem 0.9rem',
                    borderRadius: '9px',
                    border: active ? '1px solid #bfdbfe' : '1px solid transparent',
                    background: active ? '#eff6ff' : 'transparent',
                    color: active ? '#2563eb' : '#475569',
                    fontWeight: active ? 600 : 500,
                    fontSize: '0.83rem',
                    cursor: 'pointer',
                  }}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '0.42rem 0.75rem',
              width: '275px',
            }}
          >
            <Search size={15} color="#94a3b8" />
            <input
              type="text"
              placeholder="Tìm kiếm file, thư mục..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: 'none',
                outline: 'none',
                width: '100%',
                fontSize: '0.82rem',
                color: '#0f172a',
                background: 'transparent',
              }}
            />
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              margin: '0.6rem 1.5rem 0',
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              fontSize: '0.82rem',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 3. BỐ CỤC 3 CỘT BÊN TRONG MODAL */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '220px 1fr 310px',
            overflow: 'hidden',
          }}
        >
          {/* CỘT TRÁI: NÚT TẢI LÊN + DANH MỤC LOẠI FILE + THƯ MỤC CỦA TÔI */}
          <div
            style={{
              borderRight: '1px solid #e2e8f0',
              padding: '1rem 0.9rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflowY: 'auto',
              background: '#ffffff',
            }}
          >
            <div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.9rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                  marginBottom: '1rem',
                }}
              >
                <CloudUpload size={17} />
                <span>
                  {uploading ? `Đang tải lên (${uploadProgressPercent}%)...` : 'Tải lên file'}
                </span>
              </button>

              {/* Danh mục loại file kèm badge đếm */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {[
                  { cat: undefined, label: 'Tất cả file', icon: <FileIcon size={15} /> },
                  { cat: 4, label: 'Tài liệu', icon: <FileText size={15} /> },
                  { cat: 1, label: 'Hình ảnh', icon: <ImageIcon size={15} /> },
                  { cat: 2, label: 'Video', icon: <Film size={15} /> },
                  { cat: 3, label: 'Âm thanh', icon: <Music size={15} /> },
                  { cat: 5, label: 'Bảng tính', icon: <Table size={15} /> },
                  { cat: 6, label: 'Khác / Nén', icon: <Archive size={15} /> },
                ].map((item) => {
                  const active =
                    categoryFilter === item.cat && selectedFolderId === null;
                  const count = countByCategory(item.cat);
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setSelectedFolderId(null);
                        setCategoryFilter(item.cat);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '0.48rem 0.65rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: active ? '#eff6ff' : 'transparent',
                        color: active ? '#2563eb' : '#334155',
                        fontWeight: active ? 600 : 500,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: active ? '#dbeafe' : '#f1f5f9',
                          color: active ? '#1d4ed8' : '#64748b',
                          fontWeight: 600,
                        }}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Thư mục của tôi */}
              <div
                style={{
                  marginTop: '1.1rem',
                  paddingTop: '0.9rem',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.45rem',
                    padding: '0 0.35rem',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    color: '#64748b',
                  }}
                >
                  <span>Thư mục của tôi</span>
                  <Plus size={14} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {folders.map((f, idx) => {
                    const active = selectedFolderId === f.id;
                    const color = FOLDER_COLORS[idx % FOLDER_COLORS.length] ?? '#f59e0b';
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelectedFolderId(f.id);
                          setCategoryFilter(undefined);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          padding: '0.45rem 0.6rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: active ? '#eff6ff' : 'transparent',
                          color: active ? '#2563eb' : '#334155',
                          fontWeight: active ? 600 : 500,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            overflow: 'hidden',
                          }}
                        >
                          <Folder size={15} fill={color} color={color} style={{ flexShrink: 0 }} />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {f.name}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '1px 6px',
                            borderRadius: '999px',
                            background: '#f1f5f9',
                            color: '#64748b',
                          }}
                        >
                          {countByFolder(f.id)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Thanh dung lượng ở đáy cột trái */}
            <div
              style={{
                marginTop: '1rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #f1f5f9',
                fontSize: '0.75rem',
                color: '#64748b',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span>Đã sử dụng 1.2 GB / 10 GB</span>
                <strong>{usedPercent}%</strong>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '999px',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(12, usedPercent)}%`,
                    height: '100%',
                    borderRadius: '999px',
                    background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* CỘT GIỮA: VÙNG KÉO THẢ TẢI LÊN + LƯỚI THẺ FILE TRỰC QUAN */}
          <div
            style={{
              padding: '1rem 1.25rem',
              overflowY: 'auto',
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {/* Vùng Kéo Thả File (Drag & Drop Zone) giống hệt ảnh thiết kế */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                void handleInstantUploadFiles(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '1.1rem 1rem',
                borderRadius: '12px',
                border: isDragging ? '2px dashed #2563eb' : '1.5px dashed #93c5fd',
                background: isDragging ? '#eff6ff' : '#f0f7ff',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  color: '#1e293b',
                }}
              >
                <CloudUpload size={20} color="#2563eb" />
                <span>
                  Kéo thả file vào đây hoặc{' '}
                  <span style={{ color: '#2563eb', textDecoration: 'underline' }}>
                    nhấn để tải lên
                  </span>
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.3rem' }}>
                Hỗ trợ: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, JPG, PNG, MP4, ZIP (Tối đa 50MB/file)
              </div>
            </div>

            {/* Tiêu đề danh sách & Bộ sắp xếp / Chuyển Grid-List */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                {selectedFolderId !== null
                  ? folders.find((f) => f.id === selectedFolderId)?.name ?? 'Thư mục'
                  : 'Tất cả file'}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'size')}
                  style={{
                    padding: '0.36rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    color: '#334155',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                  }}
                >
                  <option value="newest">Mới nhất</option>
                  <option value="name">Theo tên A-Z</option>
                  <option value="size">Dung lượng lớn nhất</option>
                </select>

                <div
                  style={{
                    display: 'inline-flex',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: '#ffffff',
                    padding: '2px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDisplayMode('grid')}
                    style={{
                      padding: '0.3rem 0.45rem',
                      borderRadius: '6px',
                      border: 'none',
                      background: displayMode === 'grid' ? '#2563eb' : 'transparent',
                      color: displayMode === 'grid' ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Dạng lưới"
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayMode('list')}
                    style={{
                      padding: '0.3rem 0.45rem',
                      borderRadius: '6px',
                      border: 'none',
                      background: displayMode === 'list' ? '#2563eb' : 'transparent',
                      color: displayMode === 'list' ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Dạng danh sách"
                  >
                    <List size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Lưới 3 cột Card File */}
            {loading ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                Đang tải danh sách file...
              </div>
            ) : files.length === 0 ? (
              <div
                style={{
                  padding: '2.5rem',
                  textAlign: 'center',
                  color: '#64748b',
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                }}
              >
                Chưa có tệp nào trong mục này. Nhấn vào khung tải lên phía trên để thêm file mới.
              </div>
            ) : displayMode === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '0.85rem',
                }}
              >
                {files.map((item) => {
                  const isSelected = Boolean(selectedMap[item.id]);
                  const isFocused = focusedFile?.id === item.id;
                  const badge = getFileBadgeStyle(item.category, item.extension);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleCardClick(item)}
                      style={{
                        background: '#ffffff',
                        borderRadius: '12px',
                        padding: '0.6rem',
                        border:
                          isSelected || isFocused
                            ? '2px solid #2563eb'
                            : '1px solid #e2e8f0',
                        boxShadow:
                          isSelected || isFocused
                            ? '0 4px 14px rgba(37, 99, 235, 0.14)'
                            : '0 1px 3px rgba(15, 23, 42, 0.04)',
                        cursor: 'pointer',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.55rem',
                      }}
                    >
                      {/* Checkbox góc trên trái */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '12px',
                          left: '12px',
                          zIndex: 2,
                          width: '20px',
                          height: '20px',
                          borderRadius: '5px',
                          background: isSelected ? '#2563eb' : 'rgba(255, 255, 255, 0.92)',
                          border: isSelected ? '1.5px solid #2563eb' : '1.5px solid #cbd5e1',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isSelected && <Check size={13} strokeWidth={3} />}
                      </div>

                      {renderCardThumbnail(item)}

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.4rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '6px',
                              background: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {badge.label.slice(0, 3)}
                          </span>
                          <div style={{ overflow: 'hidden' }}>
                            <div
                              style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: '#0f172a',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={item.displayName}
                            >
                              {item.displayName}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                              {item.sizeFormatted} •{' '}
                              {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                            </div>
                          </div>
                        </div>
                        <MoreVertical size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  overflow: 'hidden',
                }}
              >
                {files.map((item) => {
                  const isSelected = Boolean(selectedMap[item.id]);
                  const badge = getFileBadgeStyle(item.category, item.extension);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleCardClick(item)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.65rem 0.9rem',
                        borderBottom: '1px solid #f1f5f9',
                        background: isSelected ? '#eff6ff' : '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <input type="checkbox" checked={isSelected} readOnly />
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: '5px',
                            background: badge.bg,
                            color: badge.color,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                          }}
                        >
                          {badge.label}
                        </span>
                        <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0f172a' }}>
                          {item.displayName}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {item.sizeFormatted} • {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CỘT PHẢI: XEM TRƯỚC CHI TIẾT FILE ĐANG CHỌN & NÚT "CHỌN FILE NÀY" */}
          <div
            style={{
              borderLeft: '1px solid #e2e8f0',
              padding: '1rem 1.1rem',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflowY: 'auto',
            }}
          >
            {!focusedFile ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.84rem' }}>
                Chọn một tệp ở danh sách bên trái để xem thông tin chi tiết và xác nhận đính kèm.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {/* Hộp Preview lớn */}
                  <div
                    style={{
                      width: '100%',
                      height: '165px',
                      borderRadius: '12px',
                      background:
                        focusedFile.category === 2
                          ? '#0f172a'
                          : 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 55%, #fae8ff 100%)',
                      border: '1px solid #e2e8f0',
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      padding: focusedFile.category === 2 ? '0' : '1rem',
                    }}
                  >
                    {focusedFile.category === 2 && focusedPreviewUrl ? (
                      <video
                        controls
                        preload="metadata"
                        src={focusedPreviewUrl}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <>
                        <div
                          style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            width: '28px',
                            height: '28px',
                            borderRadius: '7px',
                            background: 'rgba(15, 23, 42, 0.45)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Maximize2 size={14} />
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563eb' }}>
                          {focusedFile.code}
                        </div>
                        <div
                          style={{
                            fontSize: '1rem',
                            fontWeight: 800,
                            color: '#0f172a',
                            marginTop: '0.25rem',
                            lineHeight: 1.3,
                          }}
                        >
                          {focusedFile.displayName}
                        </div>
                        <div style={{ fontSize: '0.73rem', color: '#475569', marginTop: '0.35rem' }}>
                          {focusedFile.categoryName} • {focusedFile.sizeFormatted}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Tiêu đề file */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                    {(() => {
                      const b = getFileBadgeStyle(focusedFile.category, focusedFile.extension);
                      return (
                        <span
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            background: b.bg,
                            color: b.color,
                            border: `1px solid ${b.border}`,
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {b.label.slice(0, 3)}
                        </span>
                      );
                    })()}
                    <div style={{ overflow: 'hidden' }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          color: '#0f172a',
                          wordBreak: 'break-word',
                        }}
                      >
                        {focusedFile.displayName}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.15rem' }}>
                        {focusedFile.sizeFormatted} • Cập nhật{' '}
                        {new Date(focusedFile.updatedAt).toLocaleString('vi-VN')}
                      </div>
                    </div>
                  </div>

                  {/* Sub-tabs: Thông tin | Hoạt động */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      background: '#f1f5f9',
                      padding: '3px',
                      borderRadius: '9px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setInspectorTab('info')}
                      style={{
                        padding: '0.38rem',
                        borderRadius: '7px',
                        border: 'none',
                        background: inspectorTab === 'info' ? '#ffffff' : 'transparent',
                        color: inspectorTab === 'info' ? '#2563eb' : '#64748b',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      Thông tin
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorTab('activity')}
                      style={{
                        padding: '0.38rem',
                        borderRadius: '7px',
                        border: 'none',
                        background: inspectorTab === 'activity' ? '#ffffff' : 'transparent',
                        color: inspectorTab === 'activity' ? '#2563eb' : '#64748b',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      Hoạt động ({focusedFile.usageCount})
                    </button>
                  </div>

                  {inspectorTab === 'info' ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.55rem',
                        fontSize: '0.78rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Loại file</span>
                        <strong style={{ color: '#0f172a' }}>
                          {focusedFile.categoryName} ({focusedFile.extension.toUpperCase()})
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Kích thước</span>
                        <strong style={{ color: '#0f172a' }}>{focusedFile.sizeFormatted}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Thời gian tạo</span>
                        <span style={{ color: '#0f172a' }}>
                          {new Date(focusedFile.createdAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Cập nhật lần cuối</span>
                        <span style={{ color: '#0f172a' }}>
                          {new Date(focusedFile.updatedAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Chủ sở hữu</span>
                        <strong style={{ color: '#0f172a' }}>
                          {focusedFile.uploadedByUser?.fullName ?? ' Quản trị viên (Bạn)'}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Thư mục</span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            color: '#0f172a',
                            fontWeight: 600,
                          }}
                        >
                          <Folder size={13} fill="#f59e0b" color="#f59e0b" />
                          {currentFolderObj?.name ?? focusedFile.folderName ?? 'Thư mục gốc'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Đường dẫn ảo</span>
                        <span style={{ color: '#475569' }}>
                          {currentFolderObj?.folderPath ?? `/${focusedFile.folderName ?? 'Root'}/`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Quyền hiển thị</span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            color: '#0f172a',
                          }}
                        >
                          {focusedFile.visibility === 2 ? <Globe size={12} /> : <Lock size={12} />}
                          {focusedFile.visibilityName}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: '#0f172a' }}>
                        Đang được sử dụng tại {focusedFile.usageCount} chức năng:
                      </div>
                      <div
                        style={{
                          padding: '0.6rem',
                          borderRadius: '8px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div>• Storage Key gốc: {focusedFile.storageKey}</div>
                        <div style={{ marginTop: '0.3rem' }}>
                          • Trạng thái bảo vệ:{' '}
                          {focusedFile.usageCount > 0
                            ? '🔒 Đang khóa xóa do có liên kết dữ liệu'
                            : 'Sẵn sàng sử dụng'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Nút CTA "Chọn file này" + Sao chép liên kết giống hệt ảnh thiết kế */}
                <div
                  style={{
                    marginTop: '1rem',
                    paddingTop: '0.85rem',
                    borderTop: '1px solid #f1f5f9',
                    display: 'flex',
                    gap: '0.5rem',
                  }}
                >
                  <button
                    type="button"
                    onClick={handleConfirmSelection}
                    style={{
                      flex: 1,
                      padding: '0.7rem 1rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                    }}
                  >
                    {selectedCount > 1
                      ? `Chọn ${selectedCount} file này`
                      : 'Chọn file này'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          const link = await filesApi.createTemporaryLink(focusedFile.id, {
                            disposition: 'inline',
                            expiresInSeconds: 3600,
                          });
                          const targetUrl = link?.downloadUrl
                            ? filesApi.resolveBackendUrl(link.downloadUrl)
                            : filesApi.getStreamUrl(focusedFile.id);
                          await navigator.clipboard?.writeText(targetUrl);
                        } catch {
                          await navigator.clipboard?.writeText(
                            filesApi.getStreamUrl(focusedFile.id),
                          );
                        }
                        setCopiedNotice(true);
                        setTimeout(() => setCopiedNotice(false), 1800);
                      })();
                    }}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      background: copiedNotice ? '#dcfce7' : '#f8fafc',
                      color: copiedNotice ? '#16a34a' : '#2563eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                    title="Sao chép đường dẫn file"
                  >
                    <Link2 size={17} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
