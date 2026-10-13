import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../primitives/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Liệt kê ảnh hưởng của thao tác. */
  impact?: React.ReactNode[];
  confirmLabel: string;
  /** `danger` = thao tác phá huỷ (nút đỏ). */
  tone?: 'danger' | 'primary';
  /** Bắt gõ đúng chuỗi này mới cho xác nhận (thao tác nguy hiểm). */
  typeToConfirm?: string;
  loading?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}

/** Hộp xác nhận chuẩn cho mọi thao tác thay đổi hệ thống. */
export function ConfirmDialog({ open, onOpenChange, title, description, impact, confirmLabel, tone = 'primary', typeToConfirm, loading, onConfirm, children }: ConfirmDialogProps) {
  const { t } = useLocale();
  const [typed, setTyped] = useState('');
  const blocked = Boolean(typeToConfirm) && typed !== typeToConfirm;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {(impact?.length || children || typeToConfirm) && (
          <DialogBody className="flex flex-col gap-3">
            {impact && impact.length > 0 && (
              <div className="rounded-md border border-warn-border bg-warn-bg px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warn-fg">
                  <AlertTriangle className="size-3.5" />
                  {t('ui.confirm.impact')}
                </div>
                <ul className="list-disc pl-5 text-sm text-fg-2">
                  {impact.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {children}
            {typeToConfirm && (
              <label className="flex flex-col gap-1.5 text-sm text-fg-2">
                {t('ui.confirm.typeToConfirm', { word: typeToConfirm })}
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="font-mono" />
              </label>
            )}
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('ui.action.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={blocked || loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
