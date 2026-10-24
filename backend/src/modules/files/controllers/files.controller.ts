import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HTTP_STATUS_CODE, type PaginatedResult } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  Public,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  optionalQueryParam,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { FILES_ROUTES } from '../routes/files.routes.js';
import { FilesService } from '../services/files.service.js';
import {
  type AttachFileUsageRequest,
  type CleanupUnusedFilesRequest,
  type CompleteChunkedUploadRequest,
  type CreateFileFolderRequest,
  type CreateTemporaryDownloadLinkRequest,
  type GrantFilePermissionRequest,
  type InitChunkedUploadRequest,
  type ListFilesQuery,
  type QuarantineFileRequest,
  type UpdateFileFolderRequest,
  type UpdateFileMetadataRequest,
  type UploadBatchFilesRequest,
  type UploadChunkPartRequest,
  type UploadSingleFileRequest,
  attachFileUsageSchema,
  cleanupUnusedFilesSchema,
  completeChunkedUploadSchema,
  createFileFolderSchema,
  createTemporaryDownloadLinkSchema,
  grantFilePermissionSchema,
  initChunkedUploadSchema,
  listFilesQuerySchema,
  quarantineFileSchema,
  updateFileFolderSchema,
  updateFileMetadataSchema,
  uploadBatchFilesSchema,
  uploadChunkPartSchema,
  uploadSingleFileSchema,
} from '../requests/files.requests.js';
import {
  type ChunkedUploadInitResponse,
  type ChunkedUploadPartResponse,
  type CleanupUnusedFilesResponse,
  type FileFolderResponse,
  type FileIntegrityVerificationResponse,
  type FilePermissionItemResponse,
  type FileRecordResponse,
  type FileStatsResponse,
  type FileUsageItemResponse,
  type TemporaryDownloadLinkResponse,
  chunkedUploadInitResponseSchema,
  chunkedUploadPartResponseSchema,
  cleanupUnusedFilesResponseSchema,
  fileFolderResponseSchema,
  fileIntegrityVerificationResponseSchema,
  filePermissionItemResponseSchema,
  fileRecordResponseSchema,
  fileStatsResponseSchema,
  fileUsageItemResponseSchema,
  temporaryDownloadLinkResponseSchema,
} from '../responses/files.response.js';

const listFoldersQuerySchema = z.object({
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
});

const tempDownloadTokenParamSchema = z.string().trim().min(10).max(2048);
const uploadSessionIdParamSchema = z.string().trim().min(8).max(128);

@ApiGroup(
  'File Management',
  'Quản lý file dùng chung, thư mục, phân quyền truy cập, link tải tạm thời, kiểm tra & xử lý file, thùng rác & liên kết sử dụng (Mục 6.1, 6.2 & 6.3)',
)
@Controller(FILES_ROUTES.PREFIX)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /** Thống kê dung lượng, phân loại file và cấu hình tải lên hiện hành */
  @Get(FILES_ROUTES.STATS)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Thống kê dung lượng lưu trữ, số lượng theo phân loại và cấu hình File Manager',
    response: fileStatsResponseSchema,
  })
  public async getStats(@CurrentUser() actor?: UserIdentity): Promise<FileStatsResponse> {
    return this.filesService.getStats(actor);
  }

  /** Lấy danh sách thư mục ảo trong File Manager */
  @Get(FILES_ROUTES.FOLDERS)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Lấy danh sách cây thư mục ảo trong File Manager (lọc theo quyền & đơn vị)',
    response: z.array(fileFolderResponseSchema),
  })
  public async listFolders(
    @ValidatedQuery(listFoldersQuerySchema) query: { organizationUnitId?: number | undefined },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileFolderResponse[]> {
    return this.filesService.listFolders(query.organizationUnitId, actor);
  }

  /** Tạo thư mục mới trong File Manager */
  @Post(FILES_ROUTES.FOLDERS)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Tạo thư mục mới trong File Manager (không thay đổi đường dẫn vật lý)',
    status: HTTP_STATUS_CODE.CREATED,
    response: fileFolderResponseSchema,
  })
  public async createFolder(
    @ValidatedBody(createFileFolderSchema) body: CreateFileFolderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    return this.filesService.createFolder(body, actor);
  }

  /** Đổi tên hoặc di chuyển thư mục */
  @Patch(FILES_ROUTES.FOLDER_BY_ID)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary:
      'Đổi tên hoặc di chuyển thư mục (kiểm tra quyền, chống vòng lặp & cập nhật đường dẫn con)',
    response: fileFolderResponseSchema,
  })
  public async updateFolder(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateFileFolderSchema) body: UpdateFileFolderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileFolderResponse> {
    return this.filesService.updateFolder(id, body, actor);
  }

  /** Xóa thư mục trống */
  @Delete(FILES_ROUTES.FOLDER_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Xóa thư mục trống (chặn xóa khi còn thư mục con hoặc tệp tin)',
    response: z.object({ deleted: z.literal(true), id: z.number().int().positive() }),
  })
  public async deleteFolder(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.filesService.deleteFolder(id, actor);
  }

  /** Tìm kiếm và lọc file theo tên, loại, người tải, thời gian và trạng thái (Mục 6.1) */
  @Get()
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Tìm kiếm và lọc file theo tên, loại, người tải, thời gian, thư mục và trạng thái',
    response: fileRecordResponseSchema,
    pagination: 'offset',
  })
  public async listFiles(
    @ValidatedQuery(listFilesQuerySchema) query: ListFilesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<FileRecordResponse>> {
    return this.filesService.listPaginated(query, actor);
  }

  /** Tải một file lên hệ thống (kiểm tra chữ ký Magic Bytes & dung lượng trước khi lưu) */
  @Post(FILES_ROUTES.UPLOAD)
  @RequirePermissions('files.upload')
  @ApiDoc({
    summary:
      'Tải một file lên hệ thống (kiểm tra định dạng, chữ ký Magic Bytes và hạn mức dung lượng)',
    status: HTTP_STATUS_CODE.CREATED,
    response: fileRecordResponseSchema,
  })
  public async uploadSingle(
    @ValidatedBody(uploadSingleFileSchema) body: UploadSingleFileRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.uploadSingle(body, actor);
  }

  /** Tải nhiều file lên hệ thống cùng lúc */
  @Post(FILES_ROUTES.UPLOAD_BATCH)
  @RequirePermissions('files.upload')
  @ApiDoc({
    summary: 'Tải nhiều file lên hệ thống cùng lúc (Batch Upload)',
    status: HTTP_STATUS_CODE.CREATED,
    response: z.object({
      items: z.array(fileRecordResponseSchema),
      count: z.number().int().min(1),
    }),
  })
  public async uploadBatch(
    @ValidatedBody(uploadBatchFilesSchema) body: UploadBatchFilesRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ items: FileRecordResponse[]; count: number }> {
    return this.filesService.uploadBatch(body, actor);
  }

  /** Khởi tạo phiên tải lên theo mảnh (Chunked Upload Init — Hỗ trợ file dung lượng lớn 2GB+) */
  @Post(FILES_ROUTES.UPLOAD_CHUNKED_INIT)
  @RequirePermissions('files.upload')
  @ApiDoc({
    summary: 'Khởi tạo phiên tải lên theo mảnh (Chunked Upload Init) cho tệp dung lượng lớn (2GB+)',
    status: HTTP_STATUS_CODE.CREATED,
    response: chunkedUploadInitResponseSchema,
  })
  public async initChunkedUpload(
    @ValidatedBody(initChunkedUploadSchema) body: InitChunkedUploadRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ChunkedUploadInitResponse> {
    return this.filesService.initChunkedUpload(body, actor);
  }

  /** Tải lên một mảnh dữ liệu (4MB Chunk) của phiên Chunked Upload */
  @Post(FILES_ROUTES.UPLOAD_CHUNKED_PART)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.upload')
  @ApiDoc({
    summary: 'Gửi tiếp một mảnh dữ liệu (chunk) vào tệp tạm và cập nhật mã băm SHA-256 streaming',
    response: chunkedUploadPartResponseSchema,
  })
  public async uploadChunkPart(
    @ValidatedParams(uploadSessionIdParamSchema, 'uploadId') uploadId: string,
    @ValidatedBody(uploadChunkPartSchema) body: UploadChunkPartRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ChunkedUploadPartResponse> {
    return this.filesService.uploadChunkPart(uploadId, body, actor);
  }

  /** Hoàn tất phiên tải lên theo mảnh và tạo bản ghi tệp tin hoàn chỉnh */
  @Post(FILES_ROUTES.UPLOAD_CHUNKED_COMPLETE)
  @RequirePermissions('files.upload')
  @ApiDoc({
    summary:
      'Hoàn tất phiên tải lên theo mảnh (Chunked Upload Complete), chốt SHA-256 và lưu bản ghi',
    status: HTTP_STATUS_CODE.CREATED,
    response: fileRecordResponseSchema,
  })
  public async completeChunkedUpload(
    @ValidatedParams(uploadSessionIdParamSchema, 'uploadId') uploadId: string,
    @ValidatedBody(completeChunkedUploadSchema) body: CompleteChunkedUploadRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.completeChunkedUpload(uploadId, body, actor);
  }

  /** Dọn dẹp các file trong thùng rác đã hết thời gian chờ */
  @Post(FILES_ROUTES.TRASH_PURGE_EXPIRED)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.delete')
  @ApiDoc({
    summary: 'Dọn dẹp vĩnh viễn các file trong thùng rác đã hết thời gian chờ',
    response: z.object({
      purgedCount: z.number().int().min(0),
      purgedIds: z.array(z.number().int().positive()),
    }),
  })
  public async purgeExpiredTrash(@CurrentUser() actor?: UserIdentity) {
    return this.filesService.purgeExpiredTrash(actor);
  }

  /** Dọn file không còn sử dụng (`usageCount = 0`) sau thời gian an toàn (Mục 6.3) */
  @Post(FILES_ROUTES.CLEANUP_UNUSED)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.delete')
  @ApiDoc({
    summary:
      'Dọn các file không có liên kết sử dụng (usageCount = 0) đã vượt quá thời gian lưu giữ an toàn (Mục 6.3)',
    response: cleanupUnusedFilesResponseSchema,
  })
  public async cleanupUnusedFiles(
    @ValidatedBody(cleanupUnusedFilesSchema) body: CleanupUnusedFilesRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<CleanupUnusedFilesResponse> {
    return this.filesService.cleanupUnusedFiles(body, actor);
  }

  /** Tải file qua đường dẫn tạm thời tự hết hạn (Signed Temporary Download Link — Mục 6.2) */
  @Get(FILES_ROUTES.TEMPORARY_DOWNLOAD)
  @Public()
  @ApiDoc({
    summary: 'Tải file thông qua đường dẫn tạm thời có chữ ký và thời hạn tự hết hạn (Mục 6.2)',
  })
  public async downloadByTemporaryLink(
    @ValidatedParams(tempDownloadTokenParamSchema, 'token') token: string,
    @Res() reply: FastifyReply,
  ) {
    const { stream, file, downloadFileName, disposition } =
      await this.filesService.prepareTemporaryDownload(token);
    const encodedName = encodeURIComponent(downloadFileName);
    void reply
      .header('content-type', file.mimeType || 'application/octet-stream')
      .header(
        'content-disposition',
        `${disposition}; filename="${downloadFileName.replace(/"/g, '_')}"; filename*=UTF-8''${encodedName}`,
      )
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff');
    if (stream.size !== null) {
      void reply.header('content-length', String(stream.size));
    }
    return reply.send(stream.body);
  }

  /** Xem thông tin chi tiết của file (Tên, loại, dung lượng, người tải, thời gian, liên kết sử dụng, phân quyền) */
  @Get(FILES_ROUTES.BY_ID)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Xem thông tin chi tiết file kèm người tải, các chức năng đang sử dụng và phân quyền',
    response: fileRecordResponseSchema,
  })
  public async getById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.getById(id, actor);
  }

  /** Đổi tên hiển thị file hoặc di chuyển thư mục (Không làm thay đổi file gốc trong Storage) */
  @Patch(FILES_ROUTES.BY_ID)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary:
      'Đổi tên hiển thị file hoặc chuyển thư mục (giữ nguyên liên kết sử dụng và không làm thay đổi file gốc)',
    response: fileRecordResponseSchema,
  })
  public async updateMetadata(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateFileMetadataSchema) body: UpdateFileMetadataRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.updateMetadata(id, body, actor);
  }

  /** Tạo đường dẫn tải file tạm thời tự hết hạn (Mục 6.2) */
  @Post(FILES_ROUTES.TEMPORARY_LINK)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.download')
  @ApiDoc({
    summary:
      'Tạo đường dẫn tải file tạm thời tự hết hạn (Signed Temporary Download Link — Mục 6.2)',
    response: temporaryDownloadLinkResponseSchema,
  })
  public async createTemporaryDownloadLink(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(createTemporaryDownloadLinkSchema) body: CreateTemporaryDownloadLinkRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemporaryDownloadLinkResponse> {
    return this.filesService.createTemporaryDownloadLink(id, body, actor);
  }

  /** Xem danh sách phân quyền truy cập chi tiết (User / Role / Đơn vị) của file (Mục 6.2) */
  @Get(FILES_ROUTES.PERMISSIONS)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary:
      'Xem danh sách phân quyền xem/tải của file theo người dùng, vai trò hoặc đơn vị (Mục 6.2)',
    response: z.array(filePermissionItemResponseSchema),
  })
  public async listPermissions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse[]> {
    return this.filesService.listPermissions(id, actor);
  }

  /** Cấp hoặc cập nhật quyền xem / tải file cho người dùng, vai trò hoặc đơn vị (Mục 6.2) */
  @Post(FILES_ROUTES.PERMISSIONS)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary:
      'Cấp hoặc cập nhật quyền xem (canView) và tải (canDownload) file theo người dùng, vai trò hoặc đơn vị',
    status: HTTP_STATUS_CODE.CREATED,
    response: filePermissionItemResponseSchema,
  })
  public async grantPermission(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(grantFilePermissionSchema) body: GrantFilePermissionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FilePermissionItemResponse> {
    return this.filesService.grantPermission(id, body, actor);
  }

  /** Thu hồi một bản ghi phân quyền truy cập file (Mục 6.2) */
  @Delete(FILES_ROUTES.PERMISSION_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Thu hồi quyền truy cập file đã cấp cho người dùng, vai trò hoặc đơn vị',
    response: z.object({
      revoked: z.literal(true),
      permissionId: z.number().int().positive(),
    }),
  })
  public async revokePermission(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedParams(positiveIntParamSchema, 'permissionId') permissionId: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.filesService.revokePermission(id, permissionId, actor);
  }

  /** Tải file xuống (Kiểm tra quyền tải trước khi cho tải, trả về tên hiển thị mới) */
  @Get(FILES_ROUTES.DOWNLOAD)
  @RequirePermissions('files.download')
  @ApiDoc({
    summary: 'Tải file xuống sau khi kiểm tra quyền tải (có thể khác quyền xem thông tin)',
  })
  public async downloadFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor: UserIdentity | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { stream, file, downloadFileName } = await this.filesService.prepareDownload(id, actor);
    const encodedName = encodeURIComponent(downloadFileName);
    void reply
      .header('content-type', file.mimeType || 'application/octet-stream')
      .header(
        'content-disposition',
        `attachment; filename="${downloadFileName.replace(/"/g, '_')}"; filename*=UTF-8''${encodedName}`,
      )
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff');
    if (stream.size !== null) {
      void reply.header('content-length', String(stream.size));
    }
    return reply.send(stream.body);
  }

  /** Phát luồng Media/Video trực tiếp hỗ trợ tua nhanh Byte-Range (`206 Partial Content`) */
  @Get(FILES_ROUTES.STREAM)
  @RequirePermissions('files.download')
  @ApiDoc({
    summary: 'Phát luồng Video/Audio/Preview hỗ trợ HTTP Byte-Range (206 Partial Content)',
  })
  public async streamFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() actor?: UserIdentity,
  ) {
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const { stream, file, byteRange } = await this.filesService.prepareStream(
      id,
      rangeHeader,
      actor,
    );

    void reply
      .header('content-type', file.mimeType || 'application/octet-stream')
      .header('accept-ranges', 'bytes')
      .header('x-content-type-options', 'nosniff');

    if (byteRange) {
      void reply
        .status(HttpStatus.PARTIAL_CONTENT)
        .header('content-range', `bytes ${byteRange.start}-${byteRange.end}/${byteRange.totalSize}`)
        .header('content-length', String(byteRange.contentLength));
      return reply.send(stream.body);
    }

    if (stream.size !== null) {
      void reply.header('content-length', String(stream.size));
    }
    return reply.send(stream.body);
  }

  /** Truy cập file công khai hoặc điều hướng qua CDN (Chỉ áp dụng cho file PUBLIC — Mục 6.4.7) */
  @Get(FILES_ROUTES.PUBLIC_ACCESS)
  @Public()
  @ApiDoc({
    summary:
      'Truy cập trực tiếp hoặc điều hướng CDN cho tệp tin công khai (chỉ áp dụng khi visibility = PUBLIC — Mục 6.4.7)',
  })
  public async accessPublicFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Res() reply: FastifyReply,
  ) {
    const { redirectUrl, stream, file, downloadFileName } =
      await this.filesService.preparePublicAccess(id);
    if (redirectUrl) {
      return reply.status(HttpStatus.FOUND).redirect(redirectUrl);
    }
    const encodedName = encodeURIComponent(downloadFileName);
    void reply
      .header('content-type', file.mimeType || 'application/octet-stream')
      .header(
        'content-disposition',
        `inline; filename="${downloadFileName.replace(/"/g, '_')}"; filename*=UTF-8''${encodedName}`,
      )
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff');
    if (stream?.size !== null && stream?.size !== undefined) {
      void reply.header('content-length', String(stream.size));
    }
    return reply.send(stream?.body);
  }

  /** Xem/tải ảnh thu nhỏ (Thumbnail) hiển thị nhanh (Mục 6.3) */
  @Get(FILES_ROUTES.THUMBNAIL)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Lấy ảnh nhỏ (thumbnail) để hiển thị nhanh trên giao diện (Mục 6.3)',
  })
  public async streamThumbnail(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Res() reply: FastifyReply,
    @CurrentUser() actor?: UserIdentity,
  ) {
    const { stream, mimeType } = await this.filesService.prepareThumbnail(id, actor);
    void reply
      .header('content-type', mimeType || 'image/png')
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff');
    if (stream.size !== null) {
      void reply.header('content-length', String(stream.size));
    }
    return reply.send(stream.body);
  }

  /** Duyệt công bố file từ khu vực chờ kiểm duyệt sang trạng thái ACTIVE (Mục 6.3) */
  @Post(FILES_ROUTES.PUBLISH)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary:
      'Quét lại mã độc & công bố file từ khu vực chờ (PENDING_SCAN) sang trạng thái hoạt động (ACTIVE) (Mục 6.3)',
    response: fileRecordResponseSchema,
  })
  public async publishStagedFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.publishStagedFile(id, actor);
  }

  /** Đưa file nghi ngờ hoặc nhiễm mã độc vào khu vực cách ly (QUARANTINED) (Mục 6.3) */
  @Post(FILES_ROUTES.QUARANTINE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Cách ly file nghi ngờ hoặc chứa mã độc vào khu vực QUARANTINED (Mục 6.3)',
    response: fileRecordResponseSchema,
  })
  public async quarantineFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(quarantineFileSchema) body: QuarantineFileRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.quarantineFile(id, body.reason, actor);
  }

  /** Kiểm tra tính toàn vẹn file vật lý theo Checksum SHA-256 & phát hiện bản trùng (Mục 6.3) */
  @Post(FILES_ROUTES.VERIFY_INTEGRITY)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary:
      'Đối chiếu Checksum SHA-256 của file vật lý trên Storage để phát hiện file bị thay đổi hoặc trùng lặp (Mục 6.3)',
    response: fileIntegrityVerificationResponseSchema,
  })
  public async verifyFileIntegrity(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileIntegrityVerificationResponse> {
    return this.filesService.verifyFileIntegrity(id, actor);
  }

  /** Đưa file vào thùng rác (Có thời gian chờ trước khi xóa vĩnh viễn; chặn nếu còn liên kết) */
  @Post(FILES_ROUTES.TRASH)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Đưa file vào thùng rác (chặn nếu file đang được chức năng khác sử dụng)',
    response: fileRecordResponseSchema,
  })
  public async moveToTrash(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.moveToTrash(id, actor);
  }

  /** Khôi phục file đã xóa trong thùng rác (Chỉ khi file chưa bị xóa vĩnh viễn) */
  @Post(FILES_ROUTES.RESTORE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Khôi phục file từ thùng rác (chỉ khi file chưa bị xóa vĩnh viễn)',
    response: fileRecordResponseSchema,
  })
  public async restoreFromTrash(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.restoreFromTrash(id, actor);
  }

  /** Xóa vĩnh viễn file khỏi hệ thống và Storage (Chặn nếu còn liên kết dữ liệu) */
  @Delete(FILES_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.delete')
  @ApiDoc({
    summary: 'Xóa vĩnh viễn file khỏi hệ thống lưu trữ (chặn nếu còn liên kết dữ liệu)',
    response: z.object({
      purged: z.literal(true),
      id: z.number().int().positive(),
      storageKey: z.string(),
    }),
  })
  public async purgeFile(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.filesService.purgeFile(id, actor);
  }

  /** Xem danh sách các chức năng/bản ghi đang sử dụng file */
  @Get(FILES_ROUTES.USAGES)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Xem danh sách các chức năng và bản ghi đang sử dụng file',
    response: z.array(fileUsageItemResponseSchema),
  })
  public async listUsages(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileUsageItemResponse[]> {
    return this.filesService.listUsages(id, actor);
  }

  /** Đăng ký liên kết một chức năng/bản ghi đang sử dụng file */
  @Post(FILES_ROUTES.USAGES)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Đăng ký liên kết một chức năng/bản ghi đang sử dụng file',
    status: HTTP_STATUS_CODE.CREATED,
    response: fileUsageItemResponseSchema,
  })
  public async attachUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(attachFileUsageSchema) body: AttachFileUsageRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileUsageItemResponse> {
    return this.filesService.attachUsageFromRequest(id, body, actor);
  }

  /** Gỡ liên kết sử dụng file theo ID liên kết */
  @Delete(FILES_ROUTES.USAGE_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('files.manage')
  @ApiDoc({
    summary: 'Gỡ liên kết sử dụng file khỏi một chức năng/bản ghi',
    response: z.object({
      removed: z.literal(true),
      usageId: z.number().int().positive(),
      usageCount: z.number().int().min(0),
    }),
  })
  public async removeUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedParams(positiveIntParamSchema, 'usageId') usageId: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.filesService.removeUsageById(id, usageId, actor);
  }
}
