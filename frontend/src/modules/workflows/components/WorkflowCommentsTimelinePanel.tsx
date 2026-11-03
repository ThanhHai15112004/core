import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Lock, MessageSquare, Paperclip, Reply, Send, Trash2 } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { workflowsApi } from '../services/workflows.api';
import type {
  WorkflowActivityTimelineEntry,
  WorkflowCommentItem,
} from '../types/workflows.types';

export interface WorkflowCommentsTimelinePanelProps {
  readonly entityType: string;
  readonly entityId: string;
  readonly workflowInstanceId: number;
}

export const WorkflowCommentsTimelinePanel: React.FC<WorkflowCommentsTimelinePanelProps> = ({
  entityType,
  entityId,
  workflowInstanceId,
}) => {
  const [comments, setComments] = useState<WorkflowCommentItem[]>([]);
  const [timeline, setTimeline] = useState<WorkflowActivityTimelineEntry[]>([]);
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [attachmentIdsInput, setAttachmentIdsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [commentList, timelineData] = await Promise.all([
        workflowsApi.listComments(entityType, entityId),
        workflowsApi.getTimeline(entityType, entityId),
      ]);
      setComments(commentList ?? []);
      setTimeline(timelineData?.items ?? []);
    } catch {
      // Ignore load errors in compact panel
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void loadData();
  }, [loadData, workflowInstanceId]);

  const handleAddComment = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const attachmentFileIds = attachmentIdsInput
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);

      await workflowsApi.addComment({
        entityType,
        entityId,
        workflowInstanceId,
        parentCommentId: replyToId,
        content: content.trim(),
        isInternal,
        ...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {}),
      });
      setContent('');
      setReplyToId(null);
      setAttachmentIdsInput('');
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (id: number) => {
    setSubmitting(true);
    try {
      await workflowsApi.deleteComment(id);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '14px',
        padding: '14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <h4 style={{ ...authStyles.sectionTitle, fontSize: '14px', margin: 0 }}>
        <MessageSquare size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
        Mục 9.5 — Bình luận, Ghi chú Nội bộ, Tệp đính kèm & Dòng thời gian ({comments.length} chủ đề)
      </h4>

      {/* Form thêm bình luận / ghi chú nội bộ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {replyToId && (
          <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
            Đang trả lời bình luận #{replyToId}{' '}
            <button
              type="button"
              onClick={() => setReplyToId(null)}
              style={{ ...authStyles.btnSecondary, padding: '2px 8px', fontSize: '11px' }}
            >
              Hủy trả lời
            </button>
          </div>
        )}
        <textarea
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Nhập bình luận (hỗ trợ nhắc tên @user_20)... (Mục 9.5.1 & 9.5.4)"
          style={{ ...authStyles.input, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={attachmentIdsInput}
            onChange={(e) => setAttachmentIdsInput(e.target.value)}
            placeholder="File ID đính kèm (VD: 101, 102) — Mục 9.5.5"
            style={{ ...authStyles.input, width: '240px' }}
          />
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
            />
            <Lock size={13} /> Ghi chú nội bộ (9.5.2)
          </label>
          <button
            type="button"
            disabled={submitting || !content.trim()}
            onClick={() => void handleAddComment()}
            style={authStyles.btnPrimary}
          >
            <Send size={13} /> Gửi bình luận
          </button>
        </div>
      </div>

      {/* Danh sách bình luận & chuỗi trả lời */}
      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                background: c.isInternal ? 'var(--status-warning-bg)' : 'var(--bg-input)',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>
                  #{c.id} {c.authorFullName ?? `User #${c.authorUserId ?? 0}`}{' '}
                  {c.isInternal ? '[Ghi chú nội bộ]' : ''} {c.isEdited ? '(Đã chỉnh sửa)' : ''}
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setReplyToId(c.id)}
                    style={{ ...authStyles.btnSecondary, padding: '2px 7px', fontSize: '11px' }}
                  >
                    <Reply size={11} /> Trả lời
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteComment(c.id)}
                    style={{ ...authStyles.btnDanger, padding: '2px 7px', fontSize: '11px' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div style={{ marginTop: '4px', color: 'var(--text-main)' }}>{c.content}</div>
              {c.attachments.length > 0 && (
                <div style={{ marginTop: '4px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                  <Paperclip size={11} style={{ verticalAlign: 'middle' }} /> Tệp đính kèm:{' '}
                  {c.attachments.map((a) => a.displayName).join(', ')}
                </div>
              )}
              {c.editHistories.length > 0 && (
                <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                  Lịch sử chỉnh sửa ({c.editHistories.length}): Nội dung gốc &quot;
                  {c.editHistories[0]?.previousContent}&quot;
                </div>
              )}
              {c.replies.length > 0 && (
                <div
                  style={{
                    marginTop: '6px',
                    paddingLeft: '12px',
                    borderLeft: '2px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {c.replies.map((r) => (
                    <div key={r.id} style={{ fontSize: '11.5px' }}>
                      <strong>{r.authorFullName ?? `User #${r.authorUserId ?? 0}`}:</strong>{' '}
                      {r.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dòng thời gian hoạt động hợp nhất (9.5.8: Comment + Workflow + Audit) */}
      <div>
        <div style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px' }}>
          <Activity size={13} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
          Dòng thời gian hoạt động hợp nhất (9.5.8 — {timeline.length} sự kiện Comment / Workflow /
          Audit)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '180px', overflowY: 'auto' }}>
          {timeline.map((item) => (
            <div
              key={item.id}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '11.5px',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span>
                <strong>[{item.source}]</strong> {item.title}
                {item.summary ? ` — ${item.summary}` : ''}
              </span>
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {new Date(item.occurredAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
