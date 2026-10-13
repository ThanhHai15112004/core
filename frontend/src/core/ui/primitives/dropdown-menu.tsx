import React from 'react';
import { DropdownMenu as Menu } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

const CONTENT = 'z-50 min-w-40 overflow-hidden rounded-md border border-border-strong bg-panel-2 p-1 text-sm text-fg shadow-lg';
const ITEM =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-panel-3 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted';

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content sideOffset={sideOffset} className={cn(CONTENT, className)} {...props} />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, tone, ...props }: React.ComponentProps<typeof Menu.Item> & { tone?: 'danger' }) {
  return <Menu.Item className={cn(ITEM, tone === 'danger' && 'text-crit-fg [&_svg]:text-crit-fg', className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(ITEM, 'pl-7', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check className="text-fg" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-muted', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
