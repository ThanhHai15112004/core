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

    return {
      affected,
      details: `${affected} development record(s) (settings, folders, files, usages, notifications & workflows) seeded`,
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
}
