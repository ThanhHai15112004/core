import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  type NotificationChannelCode,
  type NotificationDocumentFormatName,
  type NotificationTemplateTypeName,
} from '../enum/notifications.enum.js';

export interface NotificationTemplateSeedDefinition {
  readonly code: string;
  readonly name: string;
  readonly channel: number;
  readonly category: number;
  readonly locale: string;
  readonly templateType?: NotificationTemplateTypeName;
  readonly documentFormat?: NotificationDocumentFormatName | null;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly isSystem: boolean;
}

export interface NotificationTemplateUsageSeedDefinition {
  readonly templateCode: string;
  readonly channel: number | null;
  readonly moduleName: string;
  readonly featureCode: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly description: string;
}

export const DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeedDefinition[] =
  [
    {
      code: 'SYSTEM_ANNOUNCEMENT',
      name: 'Thông báo hệ thống qua Email (VI)',
      channel: NOTIFICATION_CHANNEL.EMAIL,
      category: NOTIFICATION_CATEGORY.SYSTEM,
      locale: 'vi',
      templateType: NOTIFICATION_TEMPLATE_TYPE.EMAIL,
      documentFormat: null,
      subjectTemplate: '[{{appName|Core System}}] {{title}}',
      bodyTemplate:
        'Xin chào {{fullName|Bạn}},\n\n{{content}}\n\nTrân trọng,\n{{appName|Core System}}',
      htmlTemplate:
        '<div style="font-family:sans-serif;line-height:1.6"><h2>{{title}}</h2><p>Xin chào <strong>{{fullName|Bạn}}</strong>,</p><p>{{content}}</p><hr/><small>Gửi từ {{appName|Core System}}</small></div>',
      variables: ['title', 'content', 'fullName', 'appName'],
      isSystem: true,
    },
    {
      code: 'SYSTEM_ANNOUNCEMENT',
      name: 'System Announcement Email (EN)',
      channel: NOTIFICATION_CHANNEL.EMAIL,
      category: NOTIFICATION_CATEGORY.SYSTEM,
      locale: 'en',
      templateType: NOTIFICATION_TEMPLATE_TYPE.EMAIL,
      documentFormat: null,
      subjectTemplate: '[{{appName|Core System}}] {{title}}',
      bodyTemplate:
        'Hello {{fullName|User}},\n\n{{content}}\n\nBest regards,\n{{appName|Core System}}',
      htmlTemplate:
        '<div style="font-family:sans-serif;line-height:1.6"><h2>{{title}}</h2><p>Hello <strong>{{fullName|User}}</strong>,</p><p>{{content}}</p><hr/><small>Sent by {{appName|Core System}}</small></div>',
      variables: ['title', 'content', 'fullName', 'appName'],
      isSystem: true,
    },
    {
      code: 'WORK_TASK_ASSIGNED',
      name: 'Giao việc mới qua Email (VI)',
      channel: NOTIFICATION_CHANNEL.EMAIL,
      category: NOTIFICATION_CATEGORY.WORK,
      locale: 'vi',
      templateType: NOTIFICATION_TEMPLATE_TYPE.EMAIL,
      documentFormat: null,
      subjectTemplate: '[Công việc] Bạn được giao tác vụ: {{taskName}}',
      bodyTemplate:
        'Xin chào {{fullName|Bạn}},\nBạn vừa được {{assignedBy|Quản lý}} giao công việc "{{taskName}}" với hạn hoàn thành {{dueDate|Sớm nhất}}.\nChi tiết: {{content}}',
      htmlTemplate:
        '<div><h3>Công việc mới: {{taskName}}</h3><p>Xin chào <b>{{fullName|Bạn}}</b>,</p><p>Người giao: {{assignedBy|Quản lý}} — Hạn: <b>{{dueDate|Sớm nhất}}</b></p><p>{{content}}</p></div>',
      variables: ['fullName', 'assignedBy', 'taskName', 'dueDate', 'content'],
      isSystem: true,
    },
    {
      code: 'SECURITY_OTP_ALERT',
      name: 'Cảnh báo bảo mật / Mã xác thực SMS (VI)',
      channel: NOTIFICATION_CHANNEL.SMS,
      category: NOTIFICATION_CATEGORY.SECURITY,
      locale: 'vi',
      templateType: NOTIFICATION_TEMPLATE_TYPE.NOTIFICATION,
      documentFormat: null,
      subjectTemplate: null,
      bodyTemplate:
        '[{{appName|CORE}}] Ma xac thuc cua ban la {{otpCode}}. Co hieu luc trong {{expiresInMinutes|5}} phut. Tuyet doi khong chia se ma nay.',
      htmlTemplate: null,
      variables: ['appName', 'otpCode', 'expiresInMinutes'],
      isSystem: true,
    },
    {
      code: 'SECURITY_ALERT_PUSH',
      name: 'Thông báo đẩy Cảnh báo bảo mật (VI)',
      channel: NOTIFICATION_CHANNEL.PUSH,
      category: NOTIFICATION_CATEGORY.SECURITY,
      locale: 'vi',
      templateType: NOTIFICATION_TEMPLATE_TYPE.NOTIFICATION,
      documentFormat: null,
      subjectTemplate: 'Cảnh báo bảo mật: {{title}}',
      bodyTemplate: '{{content}} (Thiết bị: {{deviceName|Không xác định}})',
      htmlTemplate: null,
      variables: ['title', 'content', 'deviceName'],
      isSystem: true,
    },
    {
      code: 'CONTRACT_HANDOVER_DOC',
      name: 'Mẫu biên bản bàn giao & xác nhận hồ sơ (VI)',
      channel: NOTIFICATION_CHANNEL.DOCUMENT,
      category: NOTIFICATION_CATEGORY.WORK,
      locale: 'vi',
      templateType: NOTIFICATION_TEMPLATE_TYPE.DOCUMENT,
      documentFormat: NOTIFICATION_DOCUMENT_FORMAT.HTML,
      subjectTemplate: 'BIÊN BẢN BÀN GIAO HỒ SƠ #{{documentNumber}}',
      bodyTemplate:
        'BIÊN BẢN BÀN GIAO HỒ SƠ SỐ {{documentNumber}}\nĐơn vị: {{organizationName|Hội sở chính}}\nNgười bàn giao: {{senderName}}\nNgười nhận: {{recipientName}}\nNội dung: {{summary}}',
      htmlTemplate:
        '<div style="font-family:serif;padding:24px"><h1 style="text-align:center">BIÊN BẢN BÀN GIAO HỒ SƠ #{{documentNumber}}</h1><p><b>Đơn vị:</b> {{organizationName|Hội sở chính}}</p><p><b>Người bàn giao:</b> {{senderName}}</p><p><b>Người nhận:</b> {{recipientName}}</p><hr/><div>{{summary}}</div></div>',
      variables: ['documentNumber', 'organizationName', 'senderName', 'recipientName', 'summary'],
      isSystem: true,
    },
    {
      code: 'CONTRACT_HANDOVER_DOC',
      name: 'Document Handover Certificate Template (EN)',
      channel: NOTIFICATION_CHANNEL.DOCUMENT,
      category: NOTIFICATION_CATEGORY.WORK,
      locale: 'en',
      templateType: NOTIFICATION_TEMPLATE_TYPE.DOCUMENT,
      documentFormat: NOTIFICATION_DOCUMENT_FORMAT.HTML,
      subjectTemplate: 'DOCUMENT HANDOVER RECORD #{{documentNumber}}',
      bodyTemplate:
        'DOCUMENT HANDOVER RECORD #{{documentNumber}}\nOrganization: {{organizationName|Headquarters}}\nSender: {{senderName}}\nRecipient: {{recipientName}}\nSummary: {{summary}}',
      htmlTemplate:
        '<div style="font-family:serif;padding:24px"><h1 style="text-align:center">DOCUMENT HANDOVER RECORD #{{documentNumber}}</h1><p><b>Organization:</b> {{organizationName|Headquarters}}</p><p><b>Sender:</b> {{senderName}}</p><p><b>Recipient:</b> {{recipientName}}</p><hr/><div>{{summary}}</div></div>',
      variables: ['documentNumber', 'organizationName', 'senderName', 'recipientName', 'summary'],
      isSystem: true,
    },
  ];

export const DEFAULT_SYSTEM_TEMPLATE_USAGES: readonly NotificationTemplateUsageSeedDefinition[] = [
  {
    templateCode: 'SYSTEM_ANNOUNCEMENT',
    channel: NOTIFICATION_CHANNEL.EMAIL,
    moduleName: 'notifications',
    featureCode: 'system_broadcast_email',
    entityType: 'notification_channel',
    entityId: 'EMAIL',
    description: 'Sử dụng làm mẫu Email mặc định khi phát thông báo hệ thống',
  },
  {
    templateCode: 'WORK_TASK_ASSIGNED',
    channel: NOTIFICATION_CHANNEL.EMAIL,
    moduleName: 'workflows',
    featureCode: 'workflow_transition_notify',
    entityType: 'workflow_action',
    entityId: 'NOTIFY',
    description: 'Sử dụng khi chuyển bước quy trình phê duyệt và giao việc trong module Workflows',
  },
  {
    templateCode: 'SECURITY_OTP_ALERT',
    channel: NOTIFICATION_CHANNEL.SMS,
    moduleName: 'auth',
    featureCode: 'mfa_sms_otp',
    entityType: 'auth_verification',
    entityId: 'SMS_OTP',
    description: 'Sử dụng gửi mã OTP xác thực 2 lớp (MFA) và cảnh báo bảo mật của module Auth',
  },
  {
    templateCode: 'SECURITY_ALERT_PUSH',
    channel: NOTIFICATION_CHANNEL.PUSH,
    moduleName: 'auth',
    featureCode: 'login_security_push_alert',
    entityType: 'auth_session',
    entityId: 'PUSH_ALERT',
    description: 'Sử dụng gửi cảnh báo đăng nhập thiết bị lạ qua Push Notification',
  },
  {
    templateCode: 'CONTRACT_HANDOVER_DOC',
    channel: NOTIFICATION_CHANNEL.DOCUMENT,
    moduleName: 'workflows',
    featureCode: 'approval_handover_document',
    entityType: 'workflow_document',
    entityId: 'HANDOVER_PDF',
    description: 'Sử dụng để sinh file biên bản bàn giao sau khi phê duyệt hồ sơ',
  },
];

export function normalizeDocumentFormat(
  raw?: string | null,
): NotificationDocumentFormatName | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'PDF') return NOTIFICATION_DOCUMENT_FORMAT.PDF;
  if (upper === 'TXT' || upper === 'TEXT') return NOTIFICATION_DOCUMENT_FORMAT.TXT;
  if (upper === 'MD' || upper === 'MARKDOWN') return NOTIFICATION_DOCUMENT_FORMAT.MARKDOWN;
  if (upper === 'HTML' || upper === 'HTM') return NOTIFICATION_DOCUMENT_FORMAT.HTML;
  return NOTIFICATION_DOCUMENT_FORMAT.HTML;
}

export function resolveTemplateTypeAndFormat(params: {
  channel: NotificationChannelCode;
  templateType?: string | null | undefined;
  documentFormat?: string | null | undefined;
}): {
  readonly channel: NotificationChannelCode;
  readonly templateType: NotificationTemplateTypeName;
  readonly documentFormat: NotificationDocumentFormatName | null;
} {
  const upperType = params.templateType?.trim().toUpperCase();
  if (
    params.channel === NOTIFICATION_CHANNEL.DOCUMENT ||
    upperType === NOTIFICATION_TEMPLATE_TYPE.DOCUMENT
  ) {
    return {
      channel: NOTIFICATION_CHANNEL.DOCUMENT,
      templateType: NOTIFICATION_TEMPLATE_TYPE.DOCUMENT,
      documentFormat:
        normalizeDocumentFormat(params.documentFormat) ?? NOTIFICATION_DOCUMENT_FORMAT.HTML,
    };
  }
  if (
    params.channel === NOTIFICATION_CHANNEL.EMAIL ||
    upperType === NOTIFICATION_TEMPLATE_TYPE.EMAIL
  ) {
    return {
      channel: params.channel,
      templateType: NOTIFICATION_TEMPLATE_TYPE.EMAIL,
      documentFormat: null,
    };
  }
  return {
    channel: params.channel,
    templateType: NOTIFICATION_TEMPLATE_TYPE.NOTIFICATION,
    documentFormat: null,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveNestedValue(variables: Record<string, unknown>, path: string): unknown {
  const parts = path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let current: unknown = variables;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function extractTemplateVariables(templateText: string | null | undefined): string[] {
  if (!templateText) return [];
  const found = new Set<string>();
  const regex = /\{\{\{?\s*([a-zA-Z0-9_.]+)(?:\|[^}]*)?\s*\}?\}\}/g;
  let match = regex.exec(templateText);
  while (match !== null) {
    if (match[1]) {
      found.add(match[1].trim());
    }
    match = regex.exec(templateText);
  }
  return [...found];
}

export function interpolateTemplateString(
  template: string | null | undefined,
  variables: Record<string, unknown>,
  options?: { escapeHtmlValues?: boolean; missingSet?: Set<string> },
): string | null {
  if (template === null || template === undefined) return null;

  // First handle triple braces {{{rawVar|fallback}}} (never HTML-escaped)
  let output = template.replace(
    /\{\{\{\s*([a-zA-Z0-9_.]+)(?:\|([^}]*))?\s*\}\}\}/g,
    (_full, rawKey: string, fallback?: string) => {
      const key = rawKey.trim();
      const val = resolveNestedValue(variables, key);
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }
      if (fallback !== undefined) {
        return fallback;
      }
      options?.missingSet?.add(key);
      return '';
    },
  );

  // Then handle double braces {{var|fallback}}
  output = output.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)(?:\|([^}]*))?\s*\}\}/g,
    (_full, rawKey: string, fallback?: string) => {
      const key = rawKey.trim();
      const val = resolveNestedValue(variables, key);
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const strVal = String(val);
        return options?.escapeHtmlValues ? escapeHtml(strVal) : strVal;
      }
      if (fallback !== undefined) {
        return options?.escapeHtmlValues ? escapeHtml(fallback) : fallback;
      }
      options?.missingSet?.add(key);
      return '';
    },
  );

  return output;
}

export interface RenderedNotificationTemplateResult {
  readonly renderedSubject: string | null;
  readonly renderedBody: string;
  readonly renderedHtml: string | null;
  readonly extractedVariables: string[];
  readonly missingVariables: string[];
}

export function renderNotificationTemplateContent(params: {
  subjectTemplate?: string | null | undefined;
  bodyTemplate: string;
  htmlTemplate?: string | null | undefined;
  variables?: Record<string, unknown> | null | undefined;
  declaredVariables?: readonly string[] | null | undefined;
}): RenderedNotificationTemplateResult {
  const vars = params.variables ?? {};
  const missingSet = new Set<string>();

  const extractedVariables = [
    ...new Set([
      ...(params.declaredVariables ?? []),
      ...extractTemplateVariables(params.subjectTemplate),
      ...extractTemplateVariables(params.bodyTemplate),
      ...extractTemplateVariables(params.htmlTemplate),
    ]),
  ];

  const renderedSubject = interpolateTemplateString(params.subjectTemplate ?? null, vars, {
    escapeHtmlValues: false,
    missingSet,
  });
  const renderedBody =
    interpolateTemplateString(params.bodyTemplate, vars, {
      escapeHtmlValues: false,
      missingSet,
    }) ?? '';
  const renderedHtml = interpolateTemplateString(params.htmlTemplate ?? null, vars, {
    escapeHtmlValues: true,
    missingSet,
  });

  if (params.declaredVariables) {
    for (const rawKey of params.declaredVariables) {
      const key = rawKey.trim();
      if (!key) continue;
      const val = resolveNestedValue(vars, key);
      if (val === undefined || val === null || String(val).trim() === '') {
        // Check if template has a fallback for this key; if not, mark as missing
        const hasFallbackRegex = new RegExp(
          `\\{\\{\\{?\\s*${key.replace(/\./g, '\\.')}\\|[^}]+\\}\\}\\}?`,
        );
        const combinedText = `${params.subjectTemplate ?? ''}\n${params.bodyTemplate}\n${params.htmlTemplate ?? ''}`;
        if (!hasFallbackRegex.test(combinedText)) {
          missingSet.add(key);
        }
      }
    }
  }

  return {
    renderedSubject,
    renderedBody,
    renderedHtml,
    extractedVariables,
    missingVariables: [...missingSet],
  };
}

export function buildRenderedDocumentPayload(params: {
  templateId: number | null;
  templateCode: string;
  locale: string;
  versionUsed: number;
  documentFormat: NotificationDocumentFormatName;
  subjectTemplate: string | null;
  bodyTemplate: string;
  htmlTemplate: string | null;
  declaredVariables?: readonly string[] | null;
  variables?: Record<string, unknown> | null;
  customFileName?: string | null;
}): {
  readonly templateId: number | null;
  readonly templateCode: string;
  readonly locale: string;
  readonly versionUsed: number;
  readonly documentFormat: NotificationDocumentFormatName;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly renderedTitle: string;
  readonly renderedContent: string;
  readonly renderedHtml: string | null;
  readonly contentBase64: string;
  readonly missingVariables: readonly string[];
  readonly generatedAt: string;
} {
  const rendered = renderNotificationTemplateContent({
    subjectTemplate: params.subjectTemplate,
    bodyTemplate: params.bodyTemplate,
    htmlTemplate: params.htmlTemplate,
    variables: params.variables ?? {},
    declaredVariables: params.declaredVariables ?? null,
  });

  const renderedTitle = rendered.renderedSubject || params.templateCode;
  const format = params.documentFormat;
  const extMap: Record<NotificationDocumentFormatName, string> = {
    HTML: 'html',
    PDF: 'pdf',
    MARKDOWN: 'md',
    TXT: 'txt',
  };
  const mimeMap: Record<NotificationDocumentFormatName, string> = {
    HTML: 'text/html; charset=utf-8',
    PDF: 'application/pdf',
    MARKDOWN: 'text/markdown; charset=utf-8',
    TXT: 'text/plain; charset=utf-8',
  };

  const ext = extMap[format] ?? 'html';
  const safeBaseName = (
    params.customFileName?.trim() ||
    `${params.templateCode.toLowerCase()}-v${params.versionUsed}-${params.locale}`
  )
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
  const fileName = safeBaseName.endsWith(`.${ext}`) ? safeBaseName : `${safeBaseName}.${ext}`;

  let finalOutputString: string;
  if (format === NOTIFICATION_DOCUMENT_FORMAT.HTML) {
    finalOutputString =
      rendered.renderedHtml ??
      `<!DOCTYPE html><html lang="${params.locale}"><head><meta charset="utf-8"/><title>${escapeHtml(renderedTitle)}</title></head><body><pre>${escapeHtml(rendered.renderedBody)}</pre></body></html>`;
  } else if (format === NOTIFICATION_DOCUMENT_FORMAT.PDF) {
    const cleanText = rendered.renderedBody.replace(/[()\\]/g, '');
    finalOutputString = `%PDF-1.4\n% Generated by Core Template Engine (${params.templateCode} v${params.versionUsed})\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\n% Title: ${renderedTitle}\n% Body: ${cleanText}\n%%EOF`;
  } else {
    finalOutputString = rendered.renderedBody;
  }

  const buffer = Buffer.from(finalOutputString, 'utf-8');

  return {
    templateId: params.templateId,
    templateCode: params.templateCode,
    locale: params.locale,
    versionUsed: params.versionUsed,
    documentFormat: format,
    fileName,
    mimeType: mimeMap[format] ?? 'text/plain; charset=utf-8',
    sizeBytes: buffer.byteLength,
    renderedTitle,
    renderedContent: rendered.renderedBody,
    renderedHtml: rendered.renderedHtml,
    contentBase64: buffer.toString('base64'),
    missingVariables: rendered.missingVariables,
    generatedAt: new Date().toISOString(),
  };
}
