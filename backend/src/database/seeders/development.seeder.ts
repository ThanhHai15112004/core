import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SeederContext, SeederContract } from '@packages/database/index.js';

const DEV_SAMPLE_SETTINGS = [
  {
    key: 'dev.seed.initialized',
    value: 'true',
    description: 'Indicates development seed data has been loaded',
  },
  {
    key: 'dev.sandbox.enabled',
    value: 'true',
    description: 'Enable local sandbox testing utilities in development',
  },
];

/**
 * Seeder dữ liệu mẫu chỉ dành cho môi trường Development / Test.
 * Bị chặn tự động bởi `DatabaseSeederService` và chốt kiểm tra nội bộ khi `environment === 'production'`.
 */
export class DevelopmentDataSeeder implements SeederContract {
  public readonly name = 'DevelopmentSampleDataSeeder';
  public readonly scope = 'development' as const;
  public readonly order = 20;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    if (ctx.environment === 'production') {
      throw new Error('DevelopmentDataSeeder is strictly forbidden in production environment');
    }

    const isPostgres = ctx.driver === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS core_master_settings (
        id ${pkDef},
        setting_key VARCHAR(128) NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description VARCHAR(255) NOT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    let affected = 0;

    for (const item of DEV_SAMPLE_SETTINGS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
          [item.key, item.value, item.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [item.key, item.value, item.description],
        );
      }
      affected++;
    }

    // Seed dữ liệu mẫu cho Module Quản lý File & Media (Phase 6.1)
    affected += await this.seedSampleFilesAndUsages(ctx, isPostgres);

    return {
      affected,
      details: `${affected} development record(s) (settings, folders, files & usages) seeded`,
    };
  }

  private async seedSampleFilesAndUsages(ctx: SeederContext, isPostgres: boolean): Promise<number> {
    let count = 0;

    // 1. Seed 3 thư mục ảo mẫu
    const folders = [
      {
        id: 1,
        code: 'FLD-POLICY-2026',
        name: 'Tài liệu Nội quy & Hợp đồng',
        slug: 'tai-lieu-noi-quy-hop-dong',
        parentId: null,
        folderPath: '/tai-lieu-noi-quy-hop-dong',
        description: 'Kho lưu trữ quy chế, hợp đồng và biểu mẫu chuẩn',
      },
      {
        id: 2,
        code: 'FLD-BRAND-MEDIA',
        name: 'Thư viện Hình ảnh & Thương hiệu',
        slug: 'thu-vien-hinh-anh-thuong-hieu',
        parentId: null,
        folderPath: '/thu-vien-hinh-anh-thuong-hieu',
        description: 'Logo, ảnh đại diện, banner truyền thông dùng chung',
      },
      {
        id: 3,
        code: 'FLD-VIDEO-COURSES',
        name: 'Kho Video Bài giảng & Media',
        slug: 'kho-video-bai-giang-media',
        parentId: null,
        folderPath: '/kho-video-bai-giang-media',
        description: 'Video đào tạo hỗ trợ phát & tua qua HTTP Range 206',
      },
    ];

    for (const f of folders) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO file_folders (id, code, name, slug, parent_id, folder_path, organization_unit_id, created_by_user_id, description)
           VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
          [f.id, f.code, f.name, f.slug, f.parentId, f.folderPath, f.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO file_folders (id, code, name, slug, parent_id, folder_path, organization_unit_id, created_by_user_id, description)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
          [f.id, f.code, f.name, f.slug, f.parentId, f.folderPath, f.description],
        );
      }
      count++;
    }

    // 2. Tạo file vật lý mẫu trong thư mục uploads local để có thể tải xuống / xem trước / stream
    const storageRoot = path.resolve(process.cwd(), 'uploads');
    const sampleDir = path.join(storageRoot, 'files', '2026', '10', '22');
    await mkdir(sampleDir, { recursive: true }).catch(() => undefined);

    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const pdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% Quy che bao mat Core Enterprise 2026',
      'utf-8',
    );
    const mp4Buffer = Buffer.from(
      '0000ftypisom00000200isomiso2mp41-Core-Enterprise-Video-Stream-Range-206',
      'utf-8',
    );
    const csvBuffer = Buffer.from(
      'code,fullName,department,email\nEMP001,Nguyen Van An,Ban Cong Nghe,an.nv@core.local\n',
      'utf-8',
    );
    const trashedBuffer = Buffer.from('Ban nhap tai lieu cu da dua vao thung rac', 'utf-8');

    const sampleFiles = [
      {
        id: 1,
        code: 'FILE-2026-000001',
        folderId: 1,
        displayName: 'Quy-che-bao-mat-he-thong-2026.pdf',
        originalName: 'Quy-che-bao-mat-he-thong-2026.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        category: 4, // DOCUMENT
        sizeBytes: pdfBuffer.length,
        storageKey: 'files/2026/10/22/10000000-0000-4000-8000-000000000001.pdf',
        checksumSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        visibility: 1, // PRIVATE
        status: 1,
        usageCount: 2,
        metadataJson: JSON.stringify({
          description: 'Tài liệu quy chế bảo mật toàn hệ thống (Đang gắn với 2 chức năng)',
          encryptedAtRest: false,
        }),
        buffer: pdfBuffer,
        trashedAt: null,
        purgeAfterAt: null,
      },
      {
        id: 2,
        code: 'FILE-2026-000002',
        folderId: 2,
        displayName: 'Logo-Thuong-Hieu-Core-Enterprise.png',
        originalName: 'logo-core-original.png',
        extension: 'png',
        mimeType: 'image/png',
        category: 1, // IMAGE
        sizeBytes: pngBuffer.length,
        storageKey: 'files/2026/10/22/10000000-0000-4000-8000-000000000002.png',
        checksumSha256: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
        visibility: 3, // PUBLIC
        status: 1,
        usageCount: 1,
        metadataJson: JSON.stringify({
          description:
            'Logo thương hiệu dùng chung (Đã đổi tên hiển thị nhưng giữ nguyên storageKey)',
          encryptedAtRest: false,
        }),
        buffer: pngBuffer,
        trashedAt: null,
        purgeAfterAt: null,
      },
      {
        id: 3,
        code: 'FILE-2026-000003',
        folderId: 3,
        displayName: 'Bai-giang-Kien-truc-Modular-Monolith.mp4',
        originalName: 'Bai-giang-Kien-truc-Modular-Monolith.mp4',
        extension: 'mp4',
        mimeType: 'video/mp4',
        category: 2, // VIDEO
        sizeBytes: mp4Buffer.length,
        storageKey: 'files/2026/10/22/10000000-0000-4000-8000-000000000003.mp4',
        checksumSha256: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
        visibility: 3, // PUBLIC
        status: 1,
        usageCount: 1,
        metadataJson: JSON.stringify({
          description: 'Video đào tạo kỹ thuật phát trực tiếp qua HTTP 206 Byte-Range',
          encryptedAtRest: false,
        }),
        buffer: mp4Buffer,
        trashedAt: null,
        purgeAfterAt: null,
      },
      {
        id: 4,
        code: 'FILE-2026-000004',
        folderId: 1,
        displayName: 'Danh-sach-nhan-su-mau-2026.csv',
        originalName: 'Danh-sach-nhan-su-mau-2026.csv',
        extension: 'csv',
        mimeType: 'text/csv',
        category: 5, // SPREADSHEET
        sizeBytes: csvBuffer.length,
        storageKey: 'files/2026/10/22/10000000-0000-4000-8000-000000000004.csv',
        checksumSha256: 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3',
        visibility: 1, // PRIVATE
        status: 1,
        usageCount: 0,
        metadataJson: JSON.stringify({
          description:
            'Biểu mẫu danh sách nhân sự CSV (Chưa có liên kết, cho phép đưa vào thùng rác)',
          encryptedAtRest: false,
        }),
        buffer: csvBuffer,
        trashedAt: null,
        purgeAfterAt: null,
      },
      {
        id: 5,
        code: 'FILE-2026-000005',
        folderId: null,
        displayName: 'Ban-nhap-tai-lieu-cu-da-xoa.txt',
        originalName: 'Ban-nhap-tai-lieu-cu-da-xoa.txt',
        extension: 'txt',
        mimeType: 'text/plain',
        category: 4, // DOCUMENT
        sizeBytes: trashedBuffer.length,
        storageKey: 'files/2026/10/22/10000000-0000-4000-8000-000000000005.txt',
        checksumSha256: 'e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
        visibility: 1,
        status: 2, // TRASHED
        usageCount: 0,
        metadataJson: JSON.stringify({
          description: 'File đang nằm trong thùng rác chờ khôi phục hoặc xóa vĩnh viễn',
          encryptedAtRest: false,
        }),
        buffer: trashedBuffer,
        trashedAt: new Date(),
        purgeAfterAt: new Date(Date.now() + 30 * 86_400_000),
      },
    ];

    for (const file of sampleFiles) {
      const diskPath = path.join(storageRoot, file.storageKey);
      await writeFile(diskPath, file.buffer).catch(() => undefined);

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO files (
            id, code, folder_id, display_name, original_name, storage_driver, storage_key,
            mime_type, extension, category, size_bytes, checksum_sha256, visibility, status,
            uploaded_by_user_id, organization_unit_id, usage_count, trashed_at, purge_after_at, metadata_json
          ) VALUES ($1, $2, $3, $4, $5, 'local', $6, $7, $8, $9, $10, $11, $12, $13, 1, 1, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            category = EXCLUDED.category,
            visibility = EXCLUDED.visibility,
            usage_count = EXCLUDED.usage_count,
            status = EXCLUDED.status`,
          [
            file.id,
            file.code,
            file.folderId,
            file.displayName,
            file.originalName,
            file.storageKey,
            file.mimeType,
            file.extension,
            file.category,
            file.sizeBytes,
            file.checksumSha256,
            file.visibility,
            file.status,
            file.usageCount,
            file.trashedAt,
            file.purgeAfterAt,
            file.metadataJson,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO files (
            id, code, folder_id, display_name, original_name, storage_driver, storage_key,
            mime_type, extension, category, size_bytes, checksum_sha256, visibility, status,
            uploaded_by_user_id, organization_unit_id, usage_count, trashed_at, purge_after_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            category = VALUES(category),
            visibility = VALUES(visibility),
            usage_count = VALUES(usage_count),
            status = VALUES(status)`,
          [
            file.id,
            file.code,
            file.folderId,
            file.displayName,
            file.originalName,
            file.storageKey,
            file.mimeType,
            file.extension,
            file.category,
            file.sizeBytes,
            file.checksumSha256,
            file.visibility,
            file.status,
            file.usageCount,
            file.trashedAt,
            file.purgeAfterAt,
            file.metadataJson,
          ],
        );
      }
      count++;
    }

    // 3. Seed các bản ghi theo dõi chức năng sử dụng file (file_usages)
    const usages = [
      {
        id: 1,
        fileId: 1,
        moduleName: 'organizations',
        entityType: 'organization_policy',
        entityId: '1',
        fieldName: 'securityPolicyFileId',
        note: 'Quy chế bảo mật gắn tại Đơn vị Hội sở chính (#1)',
      },
      {
        id: 2,
        fileId: 1,
        moduleName: 'settings',
        entityType: 'compliance_document',
        entityId: '2026',
        fieldName: 'attachmentFileId',
        note: 'Hồ sơ tuân thủ an toàn thông tin năm 2026',
      },
      {
        id: 3,
        fileId: 2,
        moduleName: 'users',
        entityType: 'user_profile',
        entityId: '1',
        fieldName: 'avatarFileId',
        note: 'Ảnh đại diện Super Admin (#1)',
      },
      {
        id: 4,
        fileId: 3,
        moduleName: 'lms_courses',
        entityType: 'course_lesson',
        entityId: '101',
        fieldName: 'videoFileId',
        note: 'Video bài giảng Chương 1 — Kiến trúc Modular Monolith',
      },
    ];

    for (const u of usages) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO file_usages (id, file_id, module_name, entity_type, entity_id, field_name, note, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
           ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note`,
          [u.id, u.fileId, u.moduleName, u.entityType, u.entityId, u.fieldName, u.note],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO file_usages (id, file_id, module_name, entity_type, entity_id, field_name, note, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE note = VALUES(note)`,
          [u.id, u.fileId, u.moduleName, u.entityType, u.entityId, u.fieldName, u.note],
        );
      }
      count++;
    }

    return count;
  }
}
