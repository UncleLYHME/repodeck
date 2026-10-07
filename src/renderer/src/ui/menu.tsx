// Dropdown and context menus (Base UI: keyboard navigation, focus handling, ARIA roles).

import type { ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Check, MoreVertical } from 'lucide-react'

export interface Item {
  label: string
  onClick?: () => void
  disabled?: boolean
  checked?: boolean // a toggle item
  danger?: boolean
  hidden?: boolean
}

export type Sections = Item[][]

type Parts = typeof Menu | typeof ContextMenu

function Items({ sections, parts: P }: { sections: Sections; parts: Parts }) {
  const visible = sections.map((s) => s.filter((i) => !i.hidden)).filter((s) => s.length)
  return (
    <>
      {visible.map((section, i) => (
        <div key={i} role="group">
          {i > 0 && <P.Separator className="menu-sep" />}
          {section.map((item) =>
            item.checked !== undefined ? (
              <P.CheckboxItem
                key={item.label}
                className="menu-item"
                checked={item.checked}
                disabled={item.disabled}
                onCheckedChange={() => item.onClick?.()}
              >
                <span className="grid w-4 place-items-center">
                  <P.CheckboxItemIndicator>
                    <Check size={14} />
                  </P.CheckboxItemIndicator>
                </span>
                {item.label}
              </P.CheckboxItem>
            ) : (
              <P.Item
                key={item.label}
                className={`menu-item${item.danger ? ' danger' : ''}`}
                disabled={item.disabled}
                onClick={() => item.onClick?.()}
              >
                {item.label}
              </P.Item>
            ),
          )}
        </div>
      ))}
    </>
  )
}

export function MenuButton({ sections, label, icon, className = 'icon-btn' }: {
  sections: Sections
  label: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className={className} aria-label={label} title={label}>
        {icon ?? <MoreVertical size={16} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-50 outline-none">
          <Menu.Popup className="menu-popup">
            <Items sections={sections} parts={Menu} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** Right-click, long-press, Shift+F10 or the Menu key on `children` opens these items. */
export function ContextArea({ sections, children, className, ...rest }: {
  sections: Sections
  children: ReactNode
  className?: string
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className={className} {...rest}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none">
          <ContextMenu.Popup className="menu-popup">
            <Items sections={sections} parts={ContextMenu} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
