// A dropdown of choices styled like the app's menus. A native <select> pops up in the
// system's colors, which Chromium won't let CSS fully restyle (its highlight stays light).

import { Select } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'

export function Picker<T extends string | number>({ label, value, options, onChange, className = 'w-[150px]' }: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  className?: string
}) {
  const items = options.map(([v, text]) => ({ value: v, label: text }))
  return (
    <Select.Root value={value} items={items} onValueChange={(v) => v !== null && onChange(v)}>
      <Select.Trigger className={`field flex items-center gap-2 text-left ${className}`} aria-label={label}>
        <Select.Value className="ellipsis min-w-0 flex-1" />
        <Select.Icon className="flex-none text-white/55"><ChevronDown size={14} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-none">
          <Select.Popup className="menu-popup min-w-[var(--anchor-width)]">
            {items.map((item) => (
              <Select.Item key={item.value} value={item.value} className="menu-item">
                <span className="grid w-4 place-items-center">
                  <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                </span>
                <Select.ItemText>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
