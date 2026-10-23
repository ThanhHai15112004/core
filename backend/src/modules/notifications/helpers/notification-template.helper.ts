import { NOTIFICATION_CATEGORY, NOTIFICATION_CHANNEL } from '../enum/notifications.enum.js';

export interface NotificationTemplateSeedDefinition {
  readonly code: string;
  readonly name: string;
  readonly channel: number;
  readonly category: number;
  readonly locale: string;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly isSystem: boolean;
}

export const DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeedDefinition[] =
  [
    {
      code: 'SYSTEM_ANNOUNCEMENT',
      name: 'Thông báo hệ thống qua Email (VI)',
      channel: NOTIFICATION_CHANNEL.EMAIL,
      category: NOTIFICATION_CATEGORY.SYSTEM,
      locale: 'vi',
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
      subjectTemplate: 'Cảnh báo bảo mật: {{title}}',
      bodyTemplate: '{{content}} (Thiết bị: {{deviceName|Không xác định}})',
      htmlTemplate: null,
      variables: ['title', 'content', 'deviceName'],
      isSystem: true,
    },
  ];

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
  readonly missingVariables: string[];
}

export function renderNotificationTemplateContent(params: {
  subjectTemplate?: string | null | undefined;
  bodyTemplate: string;
  htmlTemplate?: string | null | undefined;
  variables?: Record<string, unknown> | null | undefined;
}): RenderedNotificationTemplateResult {
  const vars = params.variables ?? {};
  const missingSet = new Set<string>();

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

  return {
    renderedSubject,
    renderedBody,
    renderedHtml,
    missingVariables: [...missingSet],
  };
}
