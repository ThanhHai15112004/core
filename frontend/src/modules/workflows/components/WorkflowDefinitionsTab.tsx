import React, { useEffect, useState } from 'react';
import { CopyPlus, GitBranch, Layers, Plus, Save, Trash2 } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import {
  WORKFLOW_BADGE_TONE_OPTIONS,
  WORKFLOW_CONDITION_OPERATOR_OPTIONS,
  WORKFLOW_STATE_TYPE_OPTIONS,
} from '../enum/workflows.enum';
import type {
  CreateWorkflowDefinitionPayload,
  WorkflowDefinitionItem,
  WorkflowStateItem,
  WorkflowTransitionItem,
} from '../types/workflows.types';

interface WorkflowDefinitionsTabProps {
  readonly definitions: readonly WorkflowDefinitionItem[];
  readonly selectedDefinition: WorkflowDefinitionItem | null;
  readonly submitting: boolean;
  readonly onSelectDefinition: (id: number) => void;
  readonly onCreateDefinition: (payload: CreateWorkflowDefinitionPayload) => Promise<boolean>;
  readonly onCreateNewVersion: (id: number) => Promise<void>;
  readonly onSaveStates: (id: number, states: readonly WorkflowStateItem[]) => Promise<void>;
  readonly onSaveTransitions: (
    id: number,
    transitions: readonly WorkflowTransitionItem[],
  ) => Promise<void>;
}

export const WorkflowDefinitionsTab: React.FC<WorkflowDefinitionsTabProps> = ({
  definitions,
  selectedDefinition,
  submitting,
  onSelectDefinition,
  onCreateDefinition,
  onCreateNewVersion,
  onSaveStates,
  onSaveTransitions,
}) => {
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newTargetEntity, setNewTargetEntity] = useState('contract');
  const [newSlaHours, setNewSlaHours] = useState(24);
  const [newWarningMinutes, setNewWarningMinutes] = useState(120);

  const [editableStates, setEditableStates] = useState<WorkflowStateItem[]>([]);
  const [editableTransitions, setEditableTransitions] = useState<WorkflowTransitionItem[]>([]);

  useEffect(() => {
    if (selectedDefinition) {
      setEditableStates([...selectedDefinition.states]);
      setEditableTransitions([...selectedDefinition.transitions]);
    }
  }, [selectedDefinition]);

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    const ok = await onCreateDefinition({
      code: newCode.trim().toUpperCase(),
      name: newName.trim(),
      targetEntityType: newTargetEntity.trim().toLowerCase() || 'general',
      defaultSlaHours: Number(newSlaHours) || 24,
      warningBeforeMinutes: Number(newWarningMinutes) || 120,
    });
    if (ok) {
      setNewCode('');
      setNewName('');
    }
  };

  const addStateRow = () => {
    setEditableStates((prev) => [
      ...prev,
      {
        code: `STEP_${prev.length + 1}`,
        name: `Bước ${prev.length + 1}`,
        stateType: 'INTERMEDIATE',
        badgeTone: 'info',
        slaHours: 24,
        sortOrder: prev.length + 1,
      },
    ]);
  };

  const addTransitionRow = () => {
    const firstState = editableStates[0]?.code ?? 'DRAFT';
    const secondState = editableStates[1]?.code ?? firstState;
    setEditableTransitions((prev) => [
      ...prev,
      {
        code: `ACTION_${prev.length + 1}`,
        name: `Chuyển bước ${prev.length + 1}`,
        fromStateCode: firstState,
        toStateCode: secondState,
        conditions: { requireReason: false, fieldRules: [] },
        actions: [{ type: 'RECORD_HISTORY' }, { type: 'NOTIFY', notifyTargets: ['INITIATOR'] }],
        sortOrder: prev.length + 1,
      },
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Section 9.3.1: Create New Workflow Definition */}
      <form onSubmit={(e) => void handleSubmitCreate(e)} style={authStyles.cardHighlighted}>
        <h3 style={authStyles.sectionTitle}>
          <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Mục 9.3.1 — Tạo mới Quy trình xử lý (Có tên, mã, phiên bản & cấu hình SLA)
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '10px',
            alignItems: 'end',
          }}
        >
          <div>
            <label style={authStyles.label}>Mã quy trình (Code) *</label>
            <input
              type="text"
              required
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="VD: CONTRACT_APPROVAL"
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Tên quy trình *</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="VD: Quy trình Duyệt Hợp đồng"
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Loại đối tượng nghiệp vụ</label>
            <input
              type="text"
              value={newTargetEntity}
              onChange={(e) => setNewTargetEntity(e.target.value)}
              placeholder="VD: contract, leave_request"
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Thời hạn SLA mặc định (Giờ)</label>
            <input
              type="number"
              min={1}
              max={720}
              value={newSlaHours}
              onChange={(e) => setNewSlaHours(Number(e.target.value))}
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Cảnh báo trước hạn (Phút)</label>
            <input
              type="number"
              min={5}
              max={10080}
              value={newWarningMinutes}
              onChange={(e) => setNewWarningMinutes(Number(e.target.value))}
              style={authStyles.input}
            />
          </div>
          <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
            <Plus size={15} /> Tạo Quy trình (v1)
          </button>
        </div>
      </form>

      {/* Workflow Definitions Selector */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
              <Layers size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Danh sách Quy trình & Phiên bản ({definitions.length})
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Chọn một quy trình để cấu hình trạng thái (9.3.2), điều kiện chuyển (9.3.3) và hành
              động khi chuyển trạng thái (9.3.4).
            </p>
          </div>

          {selectedDefinition && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onCreateNewVersion(selectedDefinition.id)}
              style={authStyles.btnSecondary}
            >
              <CopyPlus size={14} /> Tạo Phiên bản mới (v{selectedDefinition.version + 1})
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {definitions.map((def) => {
            const active = selectedDefinition?.id === def.id;
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => onSelectDefinition(def.id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: active
                    ? '2px solid var(--primary)'
                    : '1px solid var(--border-color)',
                  background: active ? 'var(--bg-light-blue)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>
                  {def.name}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  <code>{def.code}</code> · Phiên bản <strong>v{def.version}</strong> · Entity:{' '}
                  <code>{def.targetEntityType}</code> · SLA: {def.defaultSlaHours}h
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDefinition && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
            gap: '16px',
          }}
        >
          {/* Section 9.3.2: States Configuration */}
          <div style={authStyles.card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <div>
                <h4 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
                  Mục 9.3.2 — Các Trạng thái của Quy trình ({editableStates.length})
                </h4>
                <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                  Ví dụ: <code>DRAFT</code>, <code>PENDING</code>, <code>APPROVED</code>,{' '}
                  <code>REJECTED</code>.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={addStateRow} style={authStyles.btnSecondary}>
                  <Plus size={14} /> Thêm trạng thái
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void onSaveStates(selectedDefinition.id, editableStates)}
                  style={authStyles.btnTeal}
                >
                  <Save size={14} /> Lưu trạng thái
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {editableStates.map((st, idx) => (
                <div
                  key={`${st.code}-${idx}`}
                  style={{
                    padding: '10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-input)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1.3fr 1.3fr 0.8fr auto',
                    gap: '8px',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    value={st.code}
                    onChange={(e) =>
                      setEditableStates((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, code: e.target.value.toUpperCase() } : item,
                        ),
                      )
                    }
                    placeholder="Mã (DRAFT)"
                    style={authStyles.monoInput}
                  />
                  <input
                    type="text"
                    value={st.name}
                    onChange={(e) =>
                      setEditableStates((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item)),
                      )
                    }
                    placeholder="Tên hiển thị"
                    style={authStyles.input}
                  />
                  <select
                    value={st.stateType}
                    onChange={(e) =>
                      setEditableStates((prev) =>
                        prev.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                stateType: e.target.value as WorkflowStateItem['stateType'],
                              }
                            : item,
                        ),
                      )
                    }
                    style={authStyles.input}
                  >
                    {WORKFLOW_STATE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={st.badgeTone}
                    onChange={(e) =>
                      setEditableStates((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, badgeTone: e.target.value } : item,
                        ),
                      )
                    }
                    style={authStyles.input}
                  >
                    {WORKFLOW_BADGE_TONE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setEditableStates((prev) => prev.filter((_, i) => i !== idx))
                    }
                    style={{ ...authStyles.btnDanger, padding: '6px 8px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 9.3.3 & 9.3.4: Transitions, Conditions & Actions */}
          <div style={authStyles.card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <div>
                <h4 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
                  <GitBranch size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  Mục 9.3.3 & 9.3.4 — Điều kiện & Hành động Chuyển trạng thái (
                  {editableTransitions.length})
                </h4>
                <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                  Kiểm tra điều kiện dữ liệu / lý do và tự động ghi lịch sử, gửi thông báo hoặc tạo
                  Job.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={addTransitionRow} style={authStyles.btnSecondary}>
                  <Plus size={14} /> Thêm bước chuyển
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void onSaveTransitions(selectedDefinition.id, editableTransitions)
                  }
                  style={authStyles.btnTeal}
                >
                  <Save size={14} /> Lưu bước chuyển
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {editableTransitions.map((tr, idx) => {
                const firstRule = tr.conditions.fieldRules?.[0];
                const hasNotify = tr.actions.some((a) => a.type === 'NOTIFY');
                const hasJob = tr.actions.some((a) => a.type === 'DISPATCH_JOB');

                return (
                  <div
                    key={`${tr.code}-${idx}`}
                    style={{
                      padding: '10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-input)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1.3fr 1fr 1fr auto',
                        gap: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        type="text"
                        value={tr.code}
                        onChange={(e) =>
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, code: e.target.value.toUpperCase() } : item,
                            ),
                          )
                        }
                        placeholder="Mã (SUBMIT)"
                        style={authStyles.monoInput}
                      />
                      <input
                        type="text"
                        value={tr.name}
                        onChange={(e) =>
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, name: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder="Tên bước chuyển"
                        style={authStyles.input}
                      />
                      <select
                        value={tr.fromStateCode}
                        onChange={(e) =>
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, fromStateCode: e.target.value } : item,
                            ),
                          )
                        }
                        style={authStyles.input}
                      >
                        {editableStates.map((s) => (
                          <option key={s.code} value={s.code}>
                            Từ: {s.code}
                          </option>
                        ))}
                      </select>
                      <select
                        value={tr.toStateCode}
                        onChange={(e) =>
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, toStateCode: e.target.value } : item,
                            ),
                          )
                        }
                        style={authStyles.input}
                      >
                        {editableStates.map((s) => (
                          <option key={s.code} value={s.code}>
                            Sang: {s.code}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setEditableTransitions((prev) => prev.filter((_, i) => i !== idx))
                        }
                        style={{ ...authStyles.btnDanger, padding: '6px 8px' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Conditions & Actions Controls */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '12px',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(tr.conditions.requireReason)}
                          onChange={(e) =>
                            setEditableTransitions((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      conditions: {
                                        ...item.conditions,
                                        requireReason: e.target.checked,
                                      },
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        Bắt buộc nhập lý do (9.3.3)
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="checkbox"
                          checked={hasNotify}
                          onChange={(e) =>
                            setEditableTransitions((prev) =>
                              prev.map((item, i) => {
                                if (i !== idx) return item;
                                const filtered = item.actions.filter((a) => a.type !== 'NOTIFY');
                                return {
                                  ...item,
                                  actions: e.target.checked
                                    ? [
                                        ...filtered,
                                        {
                                          type: 'NOTIFY',
                                          notifyTargets: ['INITIATOR', 'NEXT_APPROVERS'],
                                        },
                                      ]
                                    : filtered,
                                };
                              }),
                            )
                          }
                        />
                        Gửi thông báo (9.3.4)
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="checkbox"
                          checked={hasJob}
                          onChange={(e) =>
                            setEditableTransitions((prev) =>
                              prev.map((item, i) => {
                                if (i !== idx) return item;
                                const filtered = item.actions.filter(
                                  (a) => a.type !== 'DISPATCH_JOB',
                                );
                                return {
                                  ...item,
                                  actions: e.target.checked
                                    ? [
                                        ...filtered,
                                        {
                                          type: 'DISPATCH_JOB',
                                          jobTopic: `workflows.${tr.code.toLowerCase()}.executed`,
                                        },
                                      ]
                                    : filtered,
                                };
                              }),
                            )
                          }
                        />
                        Tạo Background Job (9.3.4)
                      </label>
                    </div>

                    {/* Field Condition Rule (9.3.3) */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '6px',
                      }}
                    >
                      <input
                        type="text"
                        value={firstRule?.field ?? ''}
                        onChange={(e) => {
                          const fieldVal = e.target.value.trim();
                          setEditableTransitions((prev) =>
                            prev.map((item, i) => {
                              if (i !== idx) return item;
                              return {
                                ...item,
                                conditions: {
                                  ...item.conditions,
                                  fieldRules: fieldVal
                                    ? [
                                        {
                                          field: fieldVal,
                                          operator: firstRule?.operator ?? 'gte',
                                          value: firstRule?.value ?? 1,
                                        },
                                      ]
                                    : [],
                                },
                              };
                            }),
                          );
                        }}
                        placeholder="Trường điều kiện (VD: days, amount)"
                        style={authStyles.monoInput}
                      />
                      <select
                        value={firstRule?.operator ?? 'gte'}
                        onChange={(e) => {
                          if (!firstRule?.field) return;
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    conditions: {
                                      ...item.conditions,
                                      fieldRules: [
                                        {
                                          field: firstRule.field,
                                          operator:
                                            e.target.value as NonNullable<typeof firstRule>['operator'],
                                          value: firstRule.value,
                                        },
                                      ],
                                    },
                                  }
                                : item,
                            ),
                          );
                        }}
                        style={authStyles.input}
                      >
                        {WORKFLOW_CONDITION_OPERATOR_OPTIONS.map((op) => (
                          <option key={op.code} value={op.code}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={firstRule?.value !== undefined ? String(firstRule.value) : ''}
                        onChange={(e) => {
                          if (!firstRule?.field) return;
                          const raw = e.target.value;
                          const num = Number(raw);
                          setEditableTransitions((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    conditions: {
                                      ...item.conditions,
                                      fieldRules: [
                                        {
                                          field: firstRule.field,
                                          operator: firstRule.operator,
                                          value:
                                            raw !== '' && !Number.isNaN(num) ? num : raw,
                                        },
                                      ],
                                    },
                                  }
                                : item,
                            ),
                          );
                        }}
                        placeholder="Giá trị điều kiện (VD: 1)"
                        style={authStyles.monoInput}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

