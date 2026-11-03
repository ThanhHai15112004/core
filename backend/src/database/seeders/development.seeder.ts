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

    // Seed dữ liệu mẫu cho Module Thông báo trong hệ thống (Phase 7.1)
    affected += await this.seedSampleNotifications(ctx, isPostgres);

    // Seed dữ liệu mẫu cho Module Quy trình xử lý & Phê duyệt (Phase 9 - Mục 9.3 & 9.4)
    affected += await this.seedSampleWorkflows(ctx, isPostgres);

    // Seed dữ liệu mẫu cho Module Lịch & Sự kiện (Phase 9 - Mục 9.7)
    affected += await this.seedSampleCalendarEvents(ctx, isPostgres);

    // Seed dữ liệu mẫu cho Module Trường tùy chỉnh & Metadata (Phase 9 - Mục 9.8)
    affected += await this.seedSampleCustomFields(ctx, isPostgres);

    return {
      affected,
      details: `${affected} development record(s) (settings, folders, files, usages, notifications, workflows, calendar events & custom fields) seeded`,
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

  private async seedSampleNotifications(ctx: SeederContext, isPostgres: boolean): Promise<number> {
    let count = 0;

    const sampleNotifications = [
      {
        id: 1,
        code: 'NTF-2026-000001',
        title: 'Khởi tạo thành công Trung tâm Thông báo Hệ thống (Phase 7.1)',
        content:
          'Hệ thống thông báo In-App đã sẵn sàng hoạt động, hỗ trợ gửi theo cá nhân, nhóm, vai trò và đơn vị tổ chức.',
        category: 1, // SYSTEM
        priority: 2, // NORMAL
        targetType: 1, // SINGLE_USER
        targetIdsJson: JSON.stringify({ userIds: [1] }),
        channelsJson: JSON.stringify(['IN_APP']),
        actionUrl: '/notifications',
        referenceModule: 'system',
        totalTargeted: 1,
        totalDelivered: 1,
        totalSkippedByPref: 0,
      },
      {
        id: 2,
        code: 'NTF-2026-000002',
        title: 'Cảnh báo bảo mật: Đăng nhập quản trị viên từ phiên làm việc mới',
        content:
          'Phát hiện phiên đăng nhập quản trị viên mới. Vui lòng kiểm tra lịch sử phiên đăng nhập nếu không phải là bạn.',
        category: 3, // SECURITY
        priority: 4, // URGENT
        targetType: 3, // ROLE
        targetIdsJson: JSON.stringify({ roleIds: [1], roleCodes: ['SUPER_ADMIN'] }),
        channelsJson: JSON.stringify(['IN_APP', 'EMAIL']),
        actionUrl: '/auth',
        referenceModule: 'auth',
        totalTargeted: 1,
        totalDelivered: 1,
        totalSkippedByPref: 0,
      },
      {
        id: 3,
        code: 'NTF-2026-000003',
        title: 'Công việc mới: Rà soát phân quyền tệp tin & hạn mức lưu trữ quý IV',
        content:
          'Đề nghị các quản lý đơn vị kiểm tra danh sách tệp chia sẻ và hạn mức dung lượng lưu trữ của phòng ban.',
        category: 2, // WORK
        priority: 3, // HIGH
        targetType: 4, // ORG_UNIT
        targetIdsJson: JSON.stringify({ organizationUnitIds: [1], includeSubUnits: true }),
        channelsJson: JSON.stringify(['IN_APP']),
        actionUrl: '/files',
        referenceModule: 'files',
        totalTargeted: 2,
        totalDelivered: 2,
        totalSkippedByPref: 0,
      },
      {
        id: 4,
        code: 'NTF-2026-000004',
        title: 'Bản tin nội bộ: Cập nhật lịch bảo trì định kỳ hệ thống cuối tuần',
        content:
          'Hệ thống sẽ thực hiện tối ưu hóa chỉ mục cơ sở dữ liệu vào 02:00 Chủ nhật tuần này (không gián đoạn dịch vụ).',
        category: 4, // ANNOUNCEMENT
        priority: 1, // LOW
        targetType: 2, // USER_GROUP
        targetIdsJson: JSON.stringify({ userIds: [1, 2] }),
        channelsJson: JSON.stringify(['IN_APP']),
        actionUrl: '/settings',
        referenceModule: 'settings',
        totalTargeted: 2,
        totalDelivered: 2,
        totalSkippedByPref: 0,
      },
    ];

    for (const n of sampleNotifications) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO notifications (
             id, code, title, content, category, priority, target_type, target_ids_json,
             channels_json, action_url, reference_module, sender_user_id, organization_unit_id,
             total_targeted, total_delivered, total_skipped_by_pref, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 1, $12, $13, $14, 1)
           ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content`,
          [
            n.id,
            n.code,
            n.title,
            n.content,
            n.category,
            n.priority,
            n.targetType,
            n.targetIdsJson,
            n.channelsJson,
            n.actionUrl,
            n.referenceModule,
            n.totalTargeted,
            n.totalDelivered,
            n.totalSkippedByPref,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO notifications (
             id, code, title, content, category, priority, target_type, target_ids_json,
             channels_json, action_url, reference_module, sender_user_id, organization_unit_id,
             total_targeted, total_delivered, total_skipped_by_pref, status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content)`,
          [
            n.id,
            n.code,
            n.title,
            n.content,
            n.category,
            n.priority,
            n.targetType,
            n.targetIdsJson,
            n.channelsJson,
            n.actionUrl,
            n.referenceModule,
            n.totalTargeted,
            n.totalDelivered,
            n.totalSkippedByPref,
          ],
        );
      }
      count++;
    }

    if (isPostgres) {
      await ctx.manager
        .query(
          `SELECT setval(pg_get_serial_sequence('notifications', 'id'), COALESCE((SELECT MAX(id) FROM notifications), 1), true)`,
        )
        .catch(() => undefined);
    }

    const sampleRecipients = [
      { id: 1, notificationId: 1, recipientUserId: 1, channel: 1, isRead: false, inboxStatus: 1 },
      { id: 2, notificationId: 2, recipientUserId: 1, channel: 1, isRead: false, inboxStatus: 1 },
      { id: 3, notificationId: 3, recipientUserId: 1, channel: 1, isRead: true, inboxStatus: 1 },
      { id: 4, notificationId: 4, recipientUserId: 1, channel: 1, isRead: true, inboxStatus: 2 },
      { id: 5, notificationId: 3, recipientUserId: 2, channel: 1, isRead: false, inboxStatus: 1 },
      { id: 6, notificationId: 4, recipientUserId: 2, channel: 1, isRead: false, inboxStatus: 1 },
    ];

    for (const r of sampleRecipients) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO notification_recipients (
             id, notification_id, recipient_user_id, organization_unit_id, channel, is_read, inbox_status
           )
           VALUES ($1, $2, $3, 1, $4, $5, $6)
           ON CONFLICT (notification_id, recipient_user_id, channel)
           DO NOTHING`,
          [r.id, r.notificationId, r.recipientUserId, r.channel, r.isRead, r.inboxStatus],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO notification_recipients (
             id, notification_id, recipient_user_id, organization_unit_id, channel, is_read, inbox_status
           )
           VALUES (?, ?, ?, 1, ?, ?, ?)
           ON DUPLICATE KEY UPDATE channel = VALUES(channel)`,
          [r.id, r.notificationId, r.recipientUserId, r.channel, r.isRead, r.inboxStatus],
        );
      }
      count++;
    }

    if (isPostgres) {
      await ctx.manager
        .query(
          `SELECT setval(pg_get_serial_sequence('notification_recipients', 'id'), COALESCE((SELECT MAX(id) FROM notification_recipients), 1), true)`,
        )
        .catch(() => undefined);
    }

    return count;
  }

  private async seedSampleWorkflows(ctx: SeederContext, isPostgres: boolean): Promise<number> {
    let count = 0;

    const defs = [
      {
        id: 1,
        code: 'LEAVE_APPROVAL',
        version: 1,
        name: 'Quy trình Xin nghỉ phép & Công tác',
        description:
          'Quy trình xử lý đơn nghỉ phép và đi công tác kèm phê duyệt theo cấp quản lý và cảnh báo SLA',
        targetEntityType: 'leave_request',
        defaultSlaHours: 24,
        warningBeforeMinutes: 120,
      },
      {
        id: 2,
        code: 'EXPENSE_REIMBURSEMENT',
        version: 1,
        name: 'Quy trình Duyệt Chi phí & Tạm ứng',
        description:
          'Quy trình kiểm tra chứng từ, điều kiện hạn mức ngân sách và phê duyệt thanh toán',
        targetEntityType: 'expense_claim',
        defaultSlaHours: 48,
        warningBeforeMinutes: 180,
      },
    ];

    for (const d of defs) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO workflow_definitions (
             id, code, version, name, description, target_entity_type,
             default_sla_hours, warning_before_minutes, is_system, status, created_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 1, 1)
           ON CONFLICT (code, version) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
          [
            d.id,
            d.code,
            d.version,
            d.name,
            d.description,
            d.targetEntityType,
            d.defaultSlaHours,
            d.warningBeforeMinutes,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO workflow_definitions (
             id, code, version, name, description, target_entity_type,
             default_sla_hours, warning_before_minutes, is_system, status, created_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, 1, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
          [
            d.id,
            d.code,
            d.version,
            d.name,
            d.description,
            d.targetEntityType,
            d.defaultSlaHours,
            d.warningBeforeMinutes,
          ],
        );
      }
      count++;
    }

    const states = [
      {
        id: 1,
        defId: 1,
        code: 'DRAFT',
        name: 'Bản nháp (Draft)',
        type: 'INITIAL',
        tone: 'neutral',
        sla: 24,
        approval: null,
        order: 1,
      },
      {
        id: 2,
        defId: 1,
        code: 'PENDING',
        name: 'Chờ phê duyệt (Pending)',
        type: 'INTERMEDIATE',
        tone: 'warning',
        sla: 24,
        approval: JSON.stringify({
          enabled: true,
          mode: 'SINGLE',
          useManagerChain: true,
          maxChainLevels: 2,
          autoTransitionOnApprove: 'APPROVE',
          autoTransitionOnReject: 'REJECT',
          autoTransitionOnReturn: 'RETURN',
        }),
        order: 2,
      },
      {
        id: 3,
        defId: 1,
        code: 'APPROVED',
        name: 'Đã phê duyệt (Approved)',
        type: 'FINAL_APPROVED',
        tone: 'success',
        sla: null,
        approval: null,
        order: 3,
      },
      {
        id: 4,
        defId: 1,
        code: 'REJECTED',
        name: 'Đã từ chối (Rejected)',
        type: 'FINAL_REJECTED',
        tone: 'danger',
        sla: null,
        approval: null,
        order: 4,
      },
      {
        id: 5,
        defId: 2,
        code: 'DRAFT',
        name: 'Khởi tạo chứng từ (Draft)',
        type: 'INITIAL',
        tone: 'neutral',
        sla: 24,
        approval: null,
        order: 1,
      },
      {
        id: 6,
        defId: 2,
        code: 'PENDING',
        name: 'Chờ duyệt ngân sách (Pending)',
        type: 'INTERMEDIATE',
        tone: 'warning',
        sla: 48,
        approval: JSON.stringify({
          enabled: true,
          mode: 'SINGLE',
          useManagerChain: true,
          maxChainLevels: 2,
          autoTransitionOnApprove: 'APPROVE',
          autoTransitionOnReject: 'REJECT',
          autoTransitionOnReturn: 'RETURN',
        }),
        order: 2,
      },
      {
        id: 7,
        defId: 2,
        code: 'APPROVED',
        name: 'Đã duyệt chi (Approved)',
        type: 'FINAL_APPROVED',
        tone: 'success',
        sla: null,
        approval: null,
        order: 3,
      },
      {
        id: 8,
        defId: 2,
        code: 'REJECTED',
        name: 'Từ chối chi (Rejected)',
        type: 'FINAL_REJECTED',
        tone: 'danger',
        sla: null,
        approval: null,
        order: 4,
      },
    ];

    for (const s of states) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO workflow_states (
             id, workflow_definition_id, code, name, state_type, badge_tone, sla_hours, approval_config_json, sort_order
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (workflow_definition_id, code) DO UPDATE SET name = EXCLUDED.name`,
          [s.id, s.defId, s.code, s.name, s.type, s.tone, s.sla, s.approval, s.order],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO workflow_states (
             id, workflow_definition_id, code, name, state_type, badge_tone, sla_hours, approval_config_json, sort_order
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [s.id, s.defId, s.code, s.name, s.type, s.tone, s.sla, s.approval, s.order],
        );
      }
      count++;
    }

    const transitions = [
      {
        id: 1,
        defId: 1,
        code: 'SUBMIT',
        name: 'Gửi đơn xin nghỉ (Submit)',
        from: 'DRAFT',
        to: 'PENDING',
        conditions: JSON.stringify({
          requireReason: false,
          fieldRules: [{ field: 'days', operator: 'gte', value: 1 }],
        }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['NEXT_APPROVERS', 'INITIATOR'] },
        ]),
        order: 1,
      },
      {
        id: 2,
        defId: 1,
        code: 'APPROVE',
        name: 'Phê duyệt đơn nghỉ (Approve)',
        from: 'PENDING',
        to: 'APPROVED',
        conditions: JSON.stringify({ requireReason: false }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['INITIATOR'] },
          { type: 'DISPATCH_JOB', jobTopic: 'workflows.leave.approved' },
        ]),
        order: 2,
      },
      {
        id: 3,
        defId: 1,
        code: 'REJECT',
        name: 'Từ chối đơn nghỉ (Reject)',
        from: 'PENDING',
        to: 'REJECTED',
        conditions: JSON.stringify({ requireReason: true }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['INITIATOR'] },
        ]),
        order: 3,
      },
      {
        id: 4,
        defId: 2,
        code: 'SUBMIT',
        name: 'Trình duyệt chi phí (Submit)',
        from: 'DRAFT',
        to: 'PENDING',
        conditions: JSON.stringify({
          requireReason: false,
          fieldRules: [{ field: 'amount', operator: 'gt', value: 0 }],
        }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['NEXT_APPROVERS'] },
        ]),
        order: 1,
      },
      {
        id: 5,
        defId: 2,
        code: 'APPROVE',
        name: 'Phê duyệt thanh toán (Approve)',
        from: 'PENDING',
        to: 'APPROVED',
        conditions: JSON.stringify({ requireReason: false }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['INITIATOR'] },
          { type: 'DISPATCH_JOB', jobTopic: 'workflows.expense.approved' },
        ]),
        order: 2,
      },
      {
        id: 6,
        defId: 2,
        code: 'REJECT',
        name: 'Từ chối thanh toán (Reject)',
        from: 'PENDING',
        to: 'REJECTED',
        conditions: JSON.stringify({ requireReason: true }),
        actions: JSON.stringify([
          { type: 'RECORD_HISTORY' },
          { type: 'NOTIFY', notifyTargets: ['INITIATOR'] },
        ]),
        order: 3,
      },
    ];

    for (const t of transitions) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO workflow_transitions (
             id, workflow_definition_id, code, name, from_state_code, to_state_code, conditions_json, actions_json, sort_order
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [t.id, t.defId, t.code, t.name, t.from, t.to, t.conditions, t.actions, t.order],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO workflow_transitions (
             id, workflow_definition_id, code, name, from_state_code, to_state_code, conditions_json, actions_json, sort_order
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [t.id, t.defId, t.code, t.name, t.from, t.to, t.conditions, t.actions, t.order],
        );
      }
      count++;
    }

    if (isPostgres) {
      for (const tbl of ['workflow_definitions', 'workflow_states', 'workflow_transitions']) {
        await ctx.manager
          .query(
            `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), true)`,
          )
          .catch(() => undefined);
      }
    }

    return count;
  }

  private async seedSampleCalendarEvents(ctx: SeederContext, isPostgres: boolean): Promise<number> {
    let count = 0;

    const events = [
      {
        id: 1,
        code: 'EVT-202611-000001',
        title: 'Họp giao ban Công nghệ & Vận hành Hàng tuần',
        description: 'Rà soát tiến độ các dự án Core Platform, SLA hạ tầng và kế hoạch phát hành.',
        eventType: 'MEETING',
        status: 1,
        visibility: 'PUBLIC',
        startAt: '2026-11-09 09:00:00',
        endAt: '2026-11-09 10:30:00',
        location: 'Phòng họp A1 - Tầng 12 Trụ sở TP.HCM',
        resourceCode: 'ROOM_HCM_A1',
        resourceName: 'Phòng họp Lớn A1 (Sức chứa 30 người)',
        ownerUserId: 10,
        organizationUnitId: 3,
        recurrenceRuleJson: JSON.stringify({
          frequency: 'WEEKLY',
          interval: 1,
          byWeekDays: [1],
          count: 12,
        }),
        remindersJson: JSON.stringify([
          { minutesBefore: 30, channels: ['IN_APP', 'EMAIL'] },
          { minutesBefore: 10, channels: ['IN_APP'] },
        ]),
        externalBindingsJson: JSON.stringify({
          GOOGLE: {
            provider: 'GOOGLE',
            calendarId: 'primary',
            externalEventId: 'gcal_evt_202611_000001',
            etag: '"gcal-etag-seed001"',
            externalUrl: 'https://calendar.google.com/calendar/event?eid=gcal_evt_202611_000001',
            conferenceUrl: 'https://meet.google.com/hcm-eng-sync',
            lastSyncedAt: '2026-11-03T08:00:00.000Z',
            syncStatus: 'SYNCED',
          },
        }),
      },
      {
        id: 2,
        code: 'EVT-202611-000002',
        title: 'Đào tạo An toàn Thông tin & Bảo mật Dữ liệu Quý 4',
        description:
          'Buổi huấn luyện bắt buộc về chính sách MFA, phân quyền RBAC và bảo vệ dữ liệu.',
        eventType: 'TRAINING',
        status: 1,
        visibility: 'INTERNAL',
        startAt: '2026-11-12 14:00:00',
        endAt: '2026-11-12 16:30:00',
        location: 'Hội trường Đa năng B2 - Chi nhánh TP.HCM',
        resourceCode: 'HALL_HCM_B2',
        resourceName: 'Hội trường Đào tạo B2',
        ownerUserId: 3,
        organizationUnitId: 5,
        recurrenceRuleJson: null,
        remindersJson: JSON.stringify([{ minutesBefore: 60, channels: ['IN_APP', 'EMAIL'] }]),
        externalBindingsJson: JSON.stringify({
          MICROSOFT: {
            provider: 'MICROSOFT',
            calendarId: 'primary',
            externalEventId: 'msgraph_evt_202611_000002',
            etag: 'W/"ms-change-seed002"',
            externalUrl: 'https://outlook.office.com/calendar/item/msgraph_evt_202611_000002',
            conferenceUrl: 'https://teams.microsoft.com/l/meetup-join/secops-q4',
            lastSyncedAt: '2026-11-03T08:15:00.000Z',
            syncStatus: 'SYNCED',
          },
        }),
      },
    ];

    for (const ev of events) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO calendar_events (
             id, code, title, description, event_type, status, visibility,
             start_at, end_at, timezone, is_all_day, location, resource_code, resource_name,
             owner_user_id, organization_unit_id, recurrence_rule_json, reminders_json, external_bindings_json
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Asia/Ho_Chi_Minh', FALSE, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description`,
          [
            ev.id,
            ev.code,
            ev.title,
            ev.description,
            ev.eventType,
            ev.status,
            ev.visibility,
            ev.startAt,
            ev.endAt,
            ev.location,
            ev.resourceCode,
            ev.resourceName,
            ev.ownerUserId,
            ev.organizationUnitId,
            ev.recurrenceRuleJson,
            ev.remindersJson,
            ev.externalBindingsJson,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO calendar_events (
             id, code, title, description, event_type, status, visibility,
             start_at, end_at, timezone, is_all_day, location, resource_code, resource_name,
             owner_user_id, organization_unit_id, recurrence_rule_json, reminders_json, external_bindings_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Ho_Chi_Minh', FALSE, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
          [
            ev.id,
            ev.code,
            ev.title,
            ev.description,
            ev.eventType,
            ev.status,
            ev.visibility,
            ev.startAt,
            ev.endAt,
            ev.location,
            ev.resourceCode,
            ev.resourceName,
            ev.ownerUserId,
            ev.organizationUnitId,
            ev.recurrenceRuleJson,
            ev.remindersJson,
            ev.externalBindingsJson,
          ],
        );
      }
      count++;
    }

    const participants = [
      {
        id: 1,
        eventId: 1,
        type: 'USER',
        userId: 6,
        orgId: null,
        role: 'REQUIRED',
        canEdit: true,
        rsvp: 'ACCEPTED',
      },
      {
        id: 2,
        eventId: 1,
        type: 'ORGANIZATION_UNIT',
        userId: null,
        orgId: 3,
        role: 'ATTENDEE',
        canEdit: false,
        rsvp: 'ACCEPTED',
      },
      {
        id: 3,
        eventId: 2,
        type: 'ORGANIZATION_UNIT',
        userId: null,
        orgId: 2,
        role: 'REQUIRED',
        canEdit: false,
        rsvp: 'PENDING',
      },
    ];

    for (const p of participants) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO calendar_event_participants (
             id, calendar_event_id, participant_type, user_id, organization_unit_id,
             participant_role, can_edit, rsvp_status, added_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
           ON CONFLICT (id) DO UPDATE SET rsvp_status = EXCLUDED.rsvp_status`,
          [p.id, p.eventId, p.type, p.userId, p.orgId, p.role, p.canEdit, p.rsvp],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO calendar_event_participants (
             id, calendar_event_id, participant_type, user_id, organization_unit_id,
             participant_role, can_edit, rsvp_status, added_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE rsvp_status = VALUES(rsvp_status)`,
          [p.id, p.eventId, p.type, p.userId, p.orgId, p.role, p.canEdit, p.rsvp],
        );
      }
      count++;
    }

    const histories = [
      {
        id: 1,
        eventId: 1,
        actionType: 'CREATED',
        changeSource: 'SYSTEM',
        actorUserId: 10,
        reason: 'Khởi tạo lịch họp giao ban hàng tuần từ Seeder',
      },
      {
        id: 2,
        eventId: 2,
        actionType: 'CREATED',
        changeSource: 'SYSTEM',
        actorUserId: 3,
        reason: 'Khởi tạo lịch đào tạo An toàn thông tin Quý 4',
      },
    ];

    for (const h of histories) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO calendar_event_histories (
             id, calendar_event_id, action_type, change_source, actor_user_id, reason
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason`,
          [h.id, h.eventId, h.actionType, h.changeSource, h.actorUserId, h.reason],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO calendar_event_histories (
             id, calendar_event_id, action_type, change_source, actor_user_id, reason
           )
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
          [h.id, h.eventId, h.actionType, h.changeSource, h.actorUserId, h.reason],
        );
      }
      count++;
    }

    if (isPostgres) {
      for (const tbl of [
        'calendar_events',
        'calendar_event_participants',
        'calendar_event_histories',
      ]) {
        await ctx.manager
          .query(
            `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), true)`,
          )
          .catch(() => undefined);
      }
    }

    return count;
  }

  private async seedSampleCustomFields(ctx: SeederContext, isPostgres: boolean): Promise<number> {
    let count = 0;

    const definitions = [
      {
        id: 1,
        entityCode: 'users.user',
        moduleCode: 'users',
        fieldKey: 'employee_level',
        name: 'Cấp bậc nhân sự (Employee Level)',
        labelsJson: JSON.stringify({
          vi: 'Cấp bậc nhân sự',
          en: 'Employee Level',
        }),
        description: 'Cấp bậc chuyên môn của nhân sự trong tổ chức (L1..L5)',
        dataType: 'SELECT',
        isRequired: false,
        defaultValueJson: JSON.stringify('L2'),
        validationRulesJson: JSON.stringify({}),
        viewPermission: 'users.read',
        editPermission: 'users.update',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 1,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 2,
        entityCode: 'users.user',
        moduleCode: 'users',
        fieldKey: 'onboarding_date',
        name: 'Ngày nhận việc chính thức',
        labelsJson: JSON.stringify({
          vi: 'Ngày nhận việc chính thức',
          en: 'Onboarding Date',
        }),
        description: 'Ngày bắt đầu làm việc chính thức tại doanh nghiệp',
        dataType: 'DATE',
        isRequired: false,
        defaultValueJson: null,
        validationRulesJson: JSON.stringify({
          minDate: '2010-01-01',
          maxDate: '2035-12-31',
        }),
        viewPermission: 'users.read',
        editPermission: 'users.update',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 2,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 3,
        entityCode: 'users.user',
        moduleCode: 'users',
        fieldKey: 'remote_eligible',
        name: 'Đủ điều kiện làm việc từ xa (Remote Eligible)',
        labelsJson: JSON.stringify({
          vi: 'Đủ điều kiện làm việc từ xa',
          en: 'Remote Eligible',
        }),
        description: 'Cho phép nhân sự đăng ký làm việc Hybrid/Remote',
        dataType: 'BOOLEAN',
        isRequired: false,
        defaultValueJson: JSON.stringify(true),
        validationRulesJson: JSON.stringify({}),
        viewPermission: 'users.read',
        editPermission: 'users.update',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 3,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 4,
        entityCode: 'users.user',
        moduleCode: 'users',
        fieldKey: 'tax_id_number',
        name: 'Mã số thuế cá nhân',
        labelsJson: JSON.stringify({
          vi: 'Mã số thuế cá nhân',
          en: 'Personal Tax ID',
        }),
        description: 'Mã số thuế cá nhân (10-13 chữ số, trường nhạy cảm)',
        dataType: 'TEXT',
        isRequired: false,
        defaultValueJson: null,
        validationRulesJson: JSON.stringify({
          minLength: 10,
          maxLength: 14,
          pattern: '^[0-9-]+$',
        }),
        viewPermission: 'custom-fields.sensitive.read',
        editPermission: 'custom-fields.sensitive.write',
        allowedViewRolesJson: JSON.stringify(['super_admin', 'admin', 'admin_hr', 'admin_finance']),
        allowedEditRolesJson: JSON.stringify(['super_admin', 'admin', 'admin_hr']),
        isSensitive: true,
        showInApi: true,
        showInList: false,
        showInDetail: true,
        isIndexed: false,
        sortOrder: 4,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 5,
        entityCode: 'users.user',
        moduleCode: 'users',
        fieldKey: 'annual_bonus_target',
        name: 'Mục tiêu thưởng năm (%)',
        labelsJson: JSON.stringify({
          vi: 'Mục tiêu thưởng năm (%)',
          en: 'Annual Bonus Target (%)',
        }),
        description: 'Tỷ lệ phần trăm thưởng hiệu suất mục tiêu hàng năm (0..200%)',
        dataType: 'NUMBER',
        isRequired: false,
        defaultValueJson: JSON.stringify(15),
        validationRulesJson: JSON.stringify({
          min: 0,
          max: 200,
        }),
        viewPermission: 'custom-fields.sensitive.read',
        editPermission: 'custom-fields.sensitive.write',
        allowedViewRolesJson: JSON.stringify(['super_admin', 'admin', 'admin_hr']),
        allowedEditRolesJson: JSON.stringify(['super_admin', 'admin', 'admin_hr']),
        isSensitive: true,
        showInApi: true,
        showInList: false,
        showInDetail: true,
        isIndexed: false,
        sortOrder: 5,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 6,
        entityCode: 'organizations.organization_unit',
        moduleCode: 'organizations',
        fieldKey: 'cost_center_code',
        name: 'Mã trung tâm chi phí (Cost Center)',
        labelsJson: JSON.stringify({
          vi: 'Mã trung tâm chi phí (Cost Center)',
          en: 'Cost Center Code',
        }),
        description: 'Mã hạch toán trung tâm chi phí ERP của đơn vị/phòng ban',
        dataType: 'TEXT',
        isRequired: false,
        defaultValueJson: null,
        validationRulesJson: JSON.stringify({
          minLength: 3,
          maxLength: 32,
          pattern: '^[A-Z0-9_-]+$',
        }),
        viewPermission: 'organizations.read',
        editPermission: 'organizations.manage',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 1,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 7,
        entityCode: 'organizations.organization_unit',
        moduleCode: 'organizations',
        fieldKey: 'headcount_quota',
        name: 'Định biên nhân sự (Headcount Quota)',
        labelsJson: JSON.stringify({
          vi: 'Định biên nhân sự',
          en: 'Headcount Quota',
        }),
        description: 'Số lượng định biên nhân sự tối đa được phê duyệt cho đơn vị',
        dataType: 'NUMBER',
        isRequired: false,
        defaultValueJson: JSON.stringify(25),
        validationRulesJson: JSON.stringify({
          min: 1,
          max: 10000,
          integerOnly: true,
        }),
        viewPermission: 'organizations.read',
        editPermission: 'organizations.manage',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 2,
        status: 1,
        isSystem: true,
        version: 1,
      },
      {
        id: 8,
        entityCode: 'organizations.organization_unit',
        moduleCode: 'organizations',
        fieldKey: 'region_tier',
        name: 'Phân hạng vùng hoạt động (Region Tier)',
        labelsJson: JSON.stringify({
          vi: 'Phân hạng vùng hoạt động',
          en: 'Operating Region Tier',
        }),
        description: 'Phân cấp chiến lược của đơn vị theo quy mô vận hành',
        dataType: 'SELECT',
        isRequired: false,
        defaultValueJson: JSON.stringify('TIER_1'),
        validationRulesJson: JSON.stringify({}),
        viewPermission: 'organizations.read',
        editPermission: 'organizations.manage',
        allowedViewRolesJson: null,
        allowedEditRolesJson: null,
        isSensitive: false,
        showInApi: true,
        showInList: true,
        showInDetail: true,
        isIndexed: true,
        sortOrder: 3,
        status: 1,
        isSystem: true,
        version: 1,
      },
    ];

    for (const def of definitions) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO custom_field_definitions (
             id, entity_code, module, field_key, name, description, data_type,
             is_required, default_value_json, validation_rules_json, view_permission, edit_permission,
             allowed_view_roles_json, allowed_edit_roles_json, is_sensitive, show_in_api, show_in_list,
             show_in_detail, is_indexed, sort_order, status, is_system, version
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23
           )
           ON CONFLICT (entity_code, field_key) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             validation_rules_json = EXCLUDED.validation_rules_json`,
          [
            def.id,
            def.entityCode,
            def.moduleCode,
            def.fieldKey,
            def.name,
            def.description,
            def.dataType,
            def.isRequired,
            def.defaultValueJson,
            def.validationRulesJson,
            def.viewPermission,
            def.editPermission,
            def.allowedViewRolesJson,
            def.allowedEditRolesJson,
            def.isSensitive,
            def.showInApi,
            def.showInList,
            def.showInDetail,
            def.isIndexed,
            def.sortOrder,
            def.status,
            def.isSystem,
            def.version,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO custom_field_definitions (
             id, entity_code, module, field_key, name, description, data_type,
             is_required, default_value_json, validation_rules_json, view_permission, edit_permission,
             allowed_view_roles_json, allowed_edit_roles_json, is_sensitive, show_in_api, show_in_list,
             show_in_detail, is_indexed, sort_order, status, is_system, version
           )
           VALUES (
             ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?
           )
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             description = VALUES(description),
             validation_rules_json = VALUES(validation_rules_json)`,
          [
            def.id,
            def.entityCode,
            def.moduleCode,
            def.fieldKey,
            def.name,
            def.description,
            def.dataType,
            def.isRequired,
            def.defaultValueJson,
            def.validationRulesJson,
            def.viewPermission,
            def.editPermission,
            def.allowedViewRolesJson,
            def.allowedEditRolesJson,
            def.isSensitive,
            def.showInApi,
            def.showInList,
            def.showInDetail,
            def.isIndexed,
            def.sortOrder,
            def.status,
            def.isSystem,
            def.version,
          ],
        );
      }
      count++;
    }

    const options = [
      {
        id: 1,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L1',
        label: 'L1 - Associate / Junior',
        labelsJson: JSON.stringify({ vi: 'L1 - Chuyên viên sơ cấp', en: 'L1 - Associate / Junior' }),
        color: '#64748b',
        sortOrder: 1,
        status: 1,
        isDefault: false,
      },
      {
        id: 2,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L2',
        label: 'L2 - Mid-Level Professional',
        labelsJson: JSON.stringify({ vi: 'L2 - Chuyên viên chính', en: 'L2 - Mid-Level Professional' }),
        color: '#0284c7',
        sortOrder: 2,
        status: 1,
        isDefault: true,
      },
      {
        id: 3,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L3',
        label: 'L3 - Senior Specialist',
        labelsJson: JSON.stringify({ vi: 'L3 - Chuyên viên cao cấp', en: 'L3 - Senior Specialist' }),
        color: '#4f46e5',
        sortOrder: 3,
        status: 1,
        isDefault: false,
      },
      {
        id: 4,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L4',
        label: 'L4 - Lead / Principal',
        labelsJson: JSON.stringify({ vi: 'L4 - Trưởng nhóm / Chuyên gia', en: 'L4 - Lead / Principal' }),
        color: '#7c3aed',
        sortOrder: 4,
        status: 1,
        isDefault: false,
      },
      {
        id: 5,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L5',
        label: 'L5 - Executive / Director',
        labelsJson: JSON.stringify({ vi: 'L5 - Giám đốc / Điều hành', en: 'L5 - Executive / Director' }),
        color: '#d97706',
        sortOrder: 5,
        status: 1,
        isDefault: false,
      },
      {
        id: 6,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        value: 'L0_LEGACY',
        label: 'L0 - Legacy Contractor (Ngừng dùng)',
        labelsJson: JSON.stringify({
          vi: 'L0 - Cộng tác viên cũ (Ngừng dùng)',
          en: 'L0 - Legacy Contractor (Inactive)',
        }),
        color: '#94a3b8',
        sortOrder: 6,
        status: 2,
        isDefault: false,
      },
      {
        id: 7,
        defId: 8,
        entityCode: 'organizations.organization_unit',
        fieldKey: 'region_tier',
        value: 'TIER_1',
        label: 'Tier 1 - Trung tâm Chiến lược',
        labelsJson: JSON.stringify({ vi: 'Tier 1 - Trung tâm Chiến lược', en: 'Tier 1 - Strategic Hub' }),
        color: '#059669',
        sortOrder: 1,
        status: 1,
        isDefault: true,
      },
      {
        id: 8,
        defId: 8,
        entityCode: 'organizations.organization_unit',
        fieldKey: 'region_tier',
        value: 'TIER_2',
        label: 'Tier 2 - Đơn vị Mở rộng',
        labelsJson: JSON.stringify({ vi: 'Tier 2 - Đơn vị Mở rộng', en: 'Tier 2 - Growth Unit' }),
        color: '#2563eb',
        sortOrder: 2,
        status: 1,
        isDefault: false,
      },
      {
        id: 9,
        defId: 8,
        entityCode: 'organizations.organization_unit',
        fieldKey: 'region_tier',
        value: 'TIER_3',
        label: 'Tier 3 - Đơn vị Vệ tinh',
        labelsJson: JSON.stringify({ vi: 'Tier 3 - Đơn vị Vệ tinh', en: 'Tier 3 - Satellite Unit' }),
        color: '#64748b',
        sortOrder: 3,
        status: 1,
        isDefault: false,
      },
    ];

    for (const opt of options) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO custom_field_options (
             id, field_id, option_code, option_label, labels_json,
             color, sort_order, status, is_default
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (field_id, option_code) DO UPDATE SET
             option_label = EXCLUDED.option_label,
             labels_json = EXCLUDED.labels_json,
             sort_order = EXCLUDED.sort_order,
             status = EXCLUDED.status`,
          [
            opt.id,
            opt.defId,
            opt.value,
            opt.label,
            opt.labelsJson,
            opt.color,
            opt.sortOrder,
            opt.status,
            opt.isDefault,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO custom_field_options (
             id, field_id, option_code, option_label, labels_json,
             color, sort_order, status, is_default
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             option_label = VALUES(option_label),
             labels_json = VALUES(labels_json),
             sort_order = VALUES(sort_order),
             status = VALUES(status)`,
          [
            opt.id,
            opt.defId,
            opt.value,
            opt.label,
            opt.labelsJson,
            opt.color,
            opt.sortOrder,
            opt.status,
            opt.isDefault,
          ],
        );
      }
      count++;
    }

    const values = [
      {
        id: 1,
        defId: 1,
        entityCode: 'users.user',
        recordId: '1',
        fieldKey: 'employee_level',
        dataType: 'SELECT',
        valueText: 'L5',
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify('L5'),
      },
      {
        id: 2,
        defId: 2,
        entityCode: 'users.user',
        recordId: '1',
        fieldKey: 'onboarding_date',
        dataType: 'DATE',
        valueText: '2020-01-15',
        valueNumber: null,
        valueDate: '2020-01-15',
        valueBoolean: null,
        valueJson: JSON.stringify('2020-01-15'),
      },
      {
        id: 3,
        defId: 3,
        entityCode: 'users.user',
        recordId: '1',
        fieldKey: 'remote_eligible',
        dataType: 'BOOLEAN',
        valueText: 'true',
        valueNumber: null,
        valueDate: null,
        valueBoolean: true,
        valueJson: JSON.stringify(true),
      },
      {
        id: 4,
        defId: 1,
        entityCode: 'users.user',
        recordId: '2',
        fieldKey: 'employee_level',
        dataType: 'SELECT',
        valueText: 'L4',
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify('L4'),
      },
      {
        id: 5,
        defId: 2,
        entityCode: 'users.user',
        recordId: '2',
        fieldKey: 'onboarding_date',
        dataType: 'DATE',
        valueText: '2021-06-01',
        valueNumber: null,
        valueDate: '2021-06-01',
        valueBoolean: null,
        valueJson: JSON.stringify('2021-06-01'),
      },
      {
        id: 6,
        defId: 6,
        entityCode: 'organizations.organization_unit',
        recordId: '1',
        fieldKey: 'cost_center_code',
        dataType: 'TEXT',
        valueText: 'CC-HQ-HCM-001',
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify('CC-HQ-HCM-001'),
      },
      {
        id: 7,
        defId: 7,
        entityCode: 'organizations.organization_unit',
        recordId: '1',
        fieldKey: 'headcount_quota',
        dataType: 'NUMBER',
        valueText: '250',
        valueNumber: 250,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify(250),
      },
      {
        id: 8,
        defId: 8,
        entityCode: 'organizations.organization_unit',
        recordId: '1',
        fieldKey: 'region_tier',
        dataType: 'SELECT',
        valueText: 'TIER_1',
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify('TIER_1'),
      },
      {
        id: 9,
        defId: 6,
        entityCode: 'organizations.organization_unit',
        recordId: '3',
        fieldKey: 'cost_center_code',
        dataType: 'TEXT',
        valueText: 'CC-ENG-HCM-003',
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify('CC-ENG-HCM-003'),
      },
      {
        id: 10,
        defId: 7,
        entityCode: 'organizations.organization_unit',
        recordId: '3',
        fieldKey: 'headcount_quota',
        dataType: 'NUMBER',
        valueText: '80',
        valueNumber: 80,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify(80),
      },
    ];

    for (const val of values) {
      const optionCode = val.dataType === 'SELECT' ? val.valueText : null;
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO custom_field_values (
             id, field_id, entity_code, record_id, field_key, data_type,
             value_text, value_number, value_date, value_boolean, option_code, option_label, value_json,
             encrypted_value, updated_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, 1)
           ON CONFLICT (entity_code, record_id, field_key) DO UPDATE SET
             value_text = EXCLUDED.value_text,
             value_number = EXCLUDED.value_number,
             value_date = EXCLUDED.value_date,
             value_boolean = EXCLUDED.value_boolean,
             option_code = EXCLUDED.option_code,
             value_json = EXCLUDED.value_json`,
          [
            val.id,
            val.defId,
            val.entityCode,
            val.recordId,
            val.fieldKey,
            val.dataType,
            val.valueText,
            val.valueNumber,
            val.valueDate,
            val.valueBoolean,
            optionCode,
            optionCode,
            val.valueJson,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO custom_field_values (
             id, field_id, entity_code, record_id, field_key, data_type,
             value_text, value_number, value_date, value_boolean, option_code, option_label, value_json,
             encrypted_value, updated_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
           ON DUPLICATE KEY UPDATE
             value_text = VALUES(value_text),
             value_number = VALUES(value_number),
             value_date = VALUES(value_date),
             value_boolean = VALUES(value_boolean),
             option_code = VALUES(option_code),
             value_json = VALUES(value_json)`,
          [
            val.id,
            val.defId,
            val.entityCode,
            val.recordId,
            val.fieldKey,
            val.dataType,
            val.valueText,
            val.valueNumber,
            val.valueDate,
            val.valueBoolean,
            optionCode,
            optionCode,
            val.valueJson,
          ],
        );
      }
      count++;
    }

    const histories = [
      {
        id: 1,
        defId: 1,
        entityCode: 'users.user',
        fieldKey: 'employee_level',
        actionType: 'MANIFEST_SYNC',
        beforeSnapshotJson: null,
        afterSnapshotJson: JSON.stringify({
          fieldKey: 'employee_level',
          dataType: 'SELECT',
          isIndexed: true,
          showInApi: true,
        }),
        changedFieldsJson: JSON.stringify(['*']),
        actorUserId: 1,
        reason: 'Đồng bộ trường tùy chỉnh employee_level từ users/module.manifest.json',
      },
      {
        id: 2,
        defId: 4,
        entityCode: 'users.user',
        fieldKey: 'tax_id_number',
        actionType: 'DATA_TYPE_CHANGE_BLOCKED',
        beforeSnapshotJson: JSON.stringify({
          fieldKey: 'tax_id_number',
          dataType: 'TEXT',
          isSensitive: true,
        }),
        afterSnapshotJson: JSON.stringify({
          attemptedDataType: 'NUMBER',
        }),
        changedFieldsJson: JSON.stringify(['dataType']),
        actorUserId: 2,
        reason: 'Chặn đổi kiểu dữ liệu tùy tiện từ TEXT sang NUMBER để bảo toàn dữ liệu lịch sử (Mục 9.8.8)',
      },
    ];

    for (const h of histories) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO custom_field_histories (
             id, field_id, entity_code, field_key, action_type,
             before_snapshot_json, after_snapshot_json, changed_fields_json, actor_user_id, reason
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason`,
          [
            h.id,
            h.defId,
            h.entityCode,
            h.fieldKey,
            h.actionType,
            h.beforeSnapshotJson,
            h.afterSnapshotJson,
            h.changedFieldsJson,
            h.actorUserId,
            h.reason,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO custom_field_histories (
             id, field_id, entity_code, field_key, action_type,
             before_snapshot_json, after_snapshot_json, changed_fields_json, actor_user_id, reason
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
          [
            h.id,
            h.defId,
            h.entityCode,
            h.fieldKey,
            h.actionType,
            h.beforeSnapshotJson,
            h.afterSnapshotJson,
            h.changedFieldsJson,
            h.actorUserId,
            h.reason,
          ],
        );
      }
      count++;
    }

    if (isPostgres) {
      for (const tbl of [
        'custom_field_definitions',
        'custom_field_options',
        'custom_field_values',
        'custom_field_histories',
      ]) {
        await ctx.manager
          .query(
            `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), true)`,
          )
          .catch(() => undefined);
      }
    }

    return count;
  }
}
