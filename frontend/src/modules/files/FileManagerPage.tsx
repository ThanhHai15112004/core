import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { FileFolderGrid } from './components/FileFolderGrid';
import { FileInspectorPanel } from './components/FileInspectorPanel';
import { FileManagerSidebar } from './components/FileManagerSidebar';
import { FileManagerToolbar } from './components/FileManagerToolbar';
import { FilePickerModal } from './components/FilePickerModal';
import { FileRecordTable } from './components/FileRecordTable';
import { useFileManager } from './hooks/useFileManager';
import { filesApi } from './services/files.api';

export const FileManagerPage: React.FC = () => {
  const {
    folders,
    files,
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
    uploadProgressPercent,
    uploadProgressText,
    uploadEncrypt,
    setUploadEncrypt,
    uploadStageForScan,
    setUploadStageForScan,
    uploadOptimizeImage,
    setUploadOptimizeImage,
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
  } = useFileManager();

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
        <FileManagerSidebar
          navSection={navSection}
          selectedFolderId={selectedFolderId}
          viewMode={viewMode}
          folders={folders}
          totalFiles={totalFiles}
          stats={stats}
          showNewFolderInput={showNewFolderInput}
          newFolderName={newFolderName}
          creatingFolder={creatingFolder}
          onSelectNavSection={(sec) => {
            setNavSection(sec);
            setSelectedFolderId(null);
            setPage(1);
          }}
          onSelectFolder={(folderId) => {
            setNavSection('my_files');
            setSelectedFolderId(folderId);
            setPage(1);
          }}
          onToggleNewFolderInput={() => setShowNewFolderInput((prev) => !prev)}
          onChangeNewFolderName={setNewFolderName}
          onCreateFolder={(e) => void handleCreateFolder(e)}
          countFolderItems={countFolderItems}
          onOpenPicker={() => setPickerOpen(true)}
        />

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
          <FileManagerToolbar
            searchQuery={searchQuery}
            uploadModuleName={uploadModuleName}
            uploadStageForScan={uploadStageForScan}
            uploadOptimizeImage={uploadOptimizeImage}
            uploadEncrypt={uploadEncrypt}
            pickedFromModal={pickedFromModal}
            viewMode={viewMode}
            activeFolderObj={activeFolderObj}
            foldersCount={folders.length}
            totalFiles={totalFiles}
            uploading={uploading}
            uploadProgressPercent={uploadProgressPercent}
            uploadProgressText={uploadProgressText}
            cleaningUnused={cleaningUnused}
            stats={stats}
            selectedFile={selectedFile}
            categoryFilter={categoryFilter}
            sortBy={sortBy}
            layoutMode={layoutMode}
            onChangeSearchQuery={(val) => {
              setSearchQuery(val);
              setPage(1);
            }}
            onChangeUploadModuleName={setUploadModuleName}
            onChangeUploadStageForScan={setUploadStageForScan}
            onChangeUploadOptimizeAndThumb={(checked) => {
              setUploadOptimizeImage(checked);
              setUploadGenerateThumbnail(checked);
            }}
            onChangeUploadEncrypt={setUploadEncrypt}
            onClearPickedFromModal={() => setPickedFromModal([])}
            onResetRootFolder={() => {
              setNavSection('my_files');
              setSelectedFolderId(null);
            }}
            onTriggerUploadClick={() => uploadInputRef.current?.click()}
            onOpenNewFolderInput={() => setShowNewFolderInput(true)}
            onOpenPicker={() => setPickerOpen(true)}
            onCleanupUnusedFiles={() => void handleCleanupUnusedFiles()}
            onChangeCategoryFilter={(cat) => {
              setCategoryFilter(cat);
              setPage(1);
            }}
            onChangeSortBy={setSortBy}
            onChangeLayoutMode={setLayoutMode}
            onShowError={(msg) => showNotice('error', msg)}
          />

          <FileFolderGrid
            viewMode={viewMode}
            folders={folders}
            selectedFolderId={selectedFolderId}
            editingFolder={editingFolder}
            editFolderName={editFolderName}
            editFolderParentId={editFolderParentId}
            countFolderItems={countFolderItems}
            onSelectFolder={setSelectedFolderId}
            onOpenEditFolder={handleOpenEditFolder}
            onChangeEditFolderName={setEditFolderName}
            onChangeEditFolderParentId={setEditFolderParentId}
            onUpdateFolder={(e) => void handleUpdateFolder(e)}
            onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
            onCloseEditFolder={() => setEditingFolder(null)}
          />

          <FileRecordTable
            files={files}
            selectedFileId={selectedFile?.id ?? null}
            loading={loading}
            viewMode={viewMode}
            page={page}
            totalPages={totalPages}
            onSelectFileDetail={(id) => void handleSelectFileDetail(id)}
            onMoveToTrash={(f) => void handleMoveToTrash(f)}
            onRestoreFromTrash={(f) => void handleRestoreFromTrash(f)}
            onPurgeFile={(f) => void handlePurgeFile(f)}
            onPurgeExpiredTrash={() => {
              void (async () => {
                const res = await filesApi.purgeExpiredTrash();
                showNotice('success', `Đã dọn ${res.purgedCount} tệp quá hạn trong thùng rác`);
                await loadFoldersAndFiles();
              })();
            }}
            onChangePage={setPage}
            onShowError={(msg) => showNotice('error', msg)}
          />
        </section>

        {/* ================= CỘT 3: PANEL THÔNG TIN CHI TIẾT BÊN PHẢI ================= */}
        <FileInspectorPanel
          selectedFile={selectedFile}
          folders={folders}
          stats={stats}
          showRenameBox={showRenameBox}
          renameValue={renameValue}
          moveFolderValue={moveFolderValue}
          verifyingIntegrity={verifyingIntegrity}
          integrityResult={integrityResult}
          showAddUsageForm={showAddUsageForm}
          usageModule={usageModule}
          usageEntityType={usageEntityType}
          usageEntityId={usageEntityId}
          usageNote={usageNote}
          showAddPermissionForm={showAddPermissionForm}
          permSubjectType={permSubjectType}
          permSubjectId={permSubjectId}
          permCanDownload={permCanDownload}
          tempLinkUrl={tempLinkUrl}
          tempLinkExpiresAt={tempLinkExpiresAt}
          onCloseInspector={() => setSelectedFile(null)}
          onToggleRenameBox={() => setShowRenameBox((prev) => !prev)}
          onChangeRenameValue={setRenameValue}
          onChangeMoveFolderValue={setMoveFolderValue}
          onSubmitRenameOrMove={(e) => void handleRenameOrMoveFile(e)}
          onVerifyIntegrity={(id) => void handleVerifyIntegrity(id)}
          onPublishStagedFile={(id) => void handlePublishStagedFile(id)}
          onQuarantineFile={(id) => void handleQuarantineFile(id)}
          onToggleAddUsageForm={() => setShowAddUsageForm((prev) => !prev)}
          onChangeUsageModule={setUsageModule}
          onChangeUsageEntityType={setUsageEntityType}
          onChangeUsageEntityId={setUsageEntityId}
          onChangeUsageNote={setUsageNote}
          onSubmitAttachUsage={(e) => void handleAttachUsage(e)}
          onDetachUsage={(fileId, usageId, mod, ent, eid) =>
            void handleDetachUsage(fileId, usageId, mod, ent, eid)
          }
          onCreateTempDownloadLink={(id) => void handleCreateTempDownloadLink(id)}
          onToggleAddPermissionForm={() => setShowAddPermissionForm((prev) => !prev)}
          onChangePermSubjectType={setPermSubjectType}
          onChangePermSubjectId={setPermSubjectId}
          onChangePermCanDownload={setPermCanDownload}
          onSubmitGrantPermission={(e) => void handleGrantPermission(e)}
          onRevokePermission={(fileId, permId) => void handleRevokePermission(fileId, permId)}
          onMoveToTrash={(f) => void handleMoveToTrash(f)}
          onRestoreFromTrash={(f) => void handleRestoreFromTrash(f)}
          onPurgeFile={(f) => void handlePurgeFile(f)}
          onShowError={(msg) => showNotice('error', msg)}
        />
      </div>

      {/* HỘP THOẠI POPUP CHỌN TỆP ĐÍNH KÈM (MỞ SONG SONG ĐÈ LÊN TRÌNH DUYỆT) */}
      <FilePickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple={true}
        onSelect={(picked) => {
          setPickedFromModal(picked);
          showNotice('success', `Đã chọn ${picked.length} tệp từ Popup "Chọn tệp đính kèm"!`);
          void loadFoldersAndFiles();
        }}
      />
    </main>
  );
};
