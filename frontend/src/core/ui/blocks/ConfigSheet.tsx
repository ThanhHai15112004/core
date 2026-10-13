import React from 'react';
import { DetailSheet, DetailSection } from './DetailSheet';
import { KeyValueGrid, type KeyValueItem } from './KeyValueGrid';

export interface ConfigGroup {
  id: string;
  title: string;
  items: KeyValueItem[];
}

/** Nhóm cấu hình dạng nhãn / giá trị (dùng trong ConfigSheet hoặc trang cấu hình). */
export function ConfigGroups({ groups }: { groups: ConfigGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <DetailSection key={g.id} title={g.title}>
          <KeyValueGrid items={g.items} />
        </DetailSection>
      ))}
    </>
  );
}

interface ConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Nội dung (thường là `<QueryView>` bọc `<ConfigGroups>`). */
  children: React.ReactNode;
}

/** Drawer cấu hình (chỉ đọc) — thay cho các tab "Cấu hình" riêng của từng trang. */
export function ConfigSheet({ open, onOpenChange, title, subtitle, children }: ConfigSheetProps) {
  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={title} subtitle={subtitle} width="lg">
      {children}
    </DetailSheet>
  );
}
