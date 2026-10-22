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
  type CreateFileFolderRequest,
  type ListFilesQuery,
  type UpdateFileFolderRequest,
  type UpdateFileMetadataRequest,
  type UploadBatchFilesRequest,
  type UploadSingleFileRequest,
  attachFileUsageSchema,
  createFileFolderSchema,
  listFilesQuerySchema,
  updateFileFolderSchema,
  updateFileMetadataSchema,
  uploadBatchFilesSchema,
  uploadSingleFileSchema,
} from '../requests/files.requests.js';
import {
  type FileFolderResponse,
  type FileRecordResponse,
  type FileStatsResponse,
  type FileUsageItemResponse,
  fileFolderResponseSchema,
  fileRecordResponseSchema,
  fileStatsResponseSchema,
  fileUsageItemResponseSchema,
} from '../responses/files.response.js';

const listFoldersQuerySchema = z.object({
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
});

@ApiGroup(
  'File Management',
  'Quản lý file dùng chung, thư mục, thùng rác & liên kết sử dụng (Mục 6.1)',
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
    summary: 'Lấy danh sách cây thư mục ảo trong File Manager',
    response: z.array(fileFolderResponseSchema),
  })
  public async listFolders(
    @ValidatedQuery(listFoldersQuerySchema) query: { organizationUnitId?: number | undefined },
  ): Promise<FileFolderResponse[]> {
    return this.filesService.listFolders(query.organizationUnitId);
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
    summary: 'Đổi tên hoặc di chuyển thư mục trong File Manager',
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
    summary: 'Tải một file lên hệ thống (kiểm tra định dạng, chữ ký Magic Bytes và dung lượng)',
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

  /** Xem thông tin chi tiết của file (Tên, loại, dung lượng, người tải, thời gian, liên kết sử dụng) */
  @Get(FILES_ROUTES.BY_ID)
  @RequirePermissions('files.read')
  @ApiDoc({
    summary: 'Xem thông tin chi tiết file kèm người tải và các chức năng đang sử dụng',
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
      'Đổi tên hiển thị file hoặc chuyển thư mục (không làm thay đổi file gốc trong storage)',
    response: fileRecordResponseSchema,
  })
  public async updateMetadata(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateFileMetadataSchema) body: UpdateFileMetadataRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FileRecordResponse> {
    return this.filesService.updateMetadata(id, body, actor);
  }

  /** Tải file xuống (Kiểm tra quyền trước khi cho tải, trả về tên hiển thị mới) */
  @Get(FILES_ROUTES.DOWNLOAD)
  @RequirePermissions('files.download')
  @ApiDoc({
    summary: 'Tải file xuống sau khi kiểm tra quyền truy cập',
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
