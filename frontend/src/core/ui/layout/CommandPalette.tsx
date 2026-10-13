import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { Dialog, DialogContent, DialogTitle } from '../primitives/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../primitives/command';
import { Kbd } from '../primitives/kbd';

export interface CommandEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Từ khoá tìm thêm (tên tiếng Anh, id…). */
  keywords?: string[];
  hint?: React.ReactNode;
  onSelect: () => void;
}

export interface CommandSection {
  id: string;
  heading: string;
  items: CommandEntry[];
}

const SHORTCUT_KEY = 'k';

/** Ô tìm nhanh trên thanh trên cùng + hộp lệnh (Ctrl/⌘ K). */
export function CommandPalette({ sections }: { sections: CommandSection[] }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === SHORTCUT_KEY) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (entry: CommandEntry) => {
    setOpen(false);
    entry.onSelect();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-2 rounded-md border border-border-strong bg-bg px-2 text-sm text-faint hover:border-focus hover:text-muted lg:w-60"
        aria-label={t('ui.command.open')}
      >
        <Search className="size-3.5 shrink-0" />
        <span className="hidden flex-1 text-left lg:inline">{t('ui.command.open')}</span>
        <Kbd className="hidden lg:inline-flex">{t('ui.command.hint')}</Kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] max-w-xl translate-y-0 overflow-hidden p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{t('ui.command.open')}</DialogTitle>
          <Command loop>
            <CommandInput placeholder={t('ui.command.placeholder')} />
            <CommandList>
              <CommandEmpty>{t('ui.command.empty')}</CommandEmpty>
              {sections.map((s) => (
                <CommandGroup key={s.id} heading={s.heading}>
                  {s.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem key={item.id} value={`${s.id}:${item.id} ${item.label}`} keywords={item.keywords} onSelect={() => run(item)}>
                        {Icon && <Icon />}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint && <span className="text-xs text-faint">{item.hint}</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
