import { DropdownMenu } from 'radix-ui'
import { Check, ListFilter, ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react'

type Option = { value: string; label: string }
export function TableSortMenu({ label, value, options, onValueChange }: {
  label: string; value: string; options: Option[]; onValueChange: (value: string) => void
}) {
  const Icon = value === 'attention' ? ArrowDownWideNarrow : value === 'ready' ? ArrowUpWideNarrow : ListFilter
  return <DropdownMenu.Root><DropdownMenu.Trigger className="table-sort-trigger" aria-label={`Сортировка: ${label}`} data-active={value !== 'address' || undefined}>
    <span>{label}</span><Icon size={14} aria-hidden="true"/>
  </DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="profile-menu table-sort-menu" sideOffset={6} align="start" collisionPadding={12}>
    <DropdownMenu.Label className="table-sort-label">Порядок статусов</DropdownMenu.Label>
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>{options.map(option=><DropdownMenu.RadioItem className="table-sort-option" value={option.value} key={option.value}>
      <span>{option.label}</span><span className="table-sort-indicator"><DropdownMenu.ItemIndicator><Check size={14}/></DropdownMenu.ItemIndicator></span>
    </DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}
