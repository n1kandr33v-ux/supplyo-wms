import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, Minus } from 'lucide-react'

type Props = { names: string[]; value: number[]; onChange: (value: number[]) => void; label: string; allLabel: string; emptyLabel: string; countLabel: string }
export function MultiSelectPicker({ names, value, onChange, label: accessibleLabel, allLabel, emptyLabel, countLabel }: Props) {
  const all = value.length === names.length
  const partial = value.length > 0 && !all
  const label = all ? allLabel : value.length === 1 ? names[value[0]] : value.length ? `${countLabel}: ${value.length}` : emptyLabel
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger data-ui-control="select" className="cabinet-multi-trigger" aria-label={accessibleLabel}>
      <span>{label}</span><ChevronDown size={16} aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="profile-menu cabinet-options" sideOffset={8} align="start" collisionPadding={12}>
      <DropdownMenu.CheckboxItem className="cabinet-option" checked={all ? true : partial ? 'indeterminate' : false} onSelect={e=>e.preventDefault()} onCheckedChange={()=>onChange(all ? [] : names.map((_,i)=>i))}>
        <span className="cabinet-checkbox"><DropdownMenu.ItemIndicator>{partial ? <Minus size={12}/> : <Check size={12}/>}</DropdownMenu.ItemIndicator></span>Выбрать все
      </DropdownMenu.CheckboxItem>
      <DropdownMenu.Separator className="cabinet-option-separator" />
      {names.map((name,index)=><DropdownMenu.CheckboxItem key={name} className="cabinet-option" checked={value.includes(index)} onSelect={e=>e.preventDefault()} onCheckedChange={checked=>onChange(checked ? [...value,index].sort((a,b)=>a-b) : value.filter(i=>i!==index))}>
        <span className="cabinet-checkbox"><DropdownMenu.ItemIndicator><Check size={12}/></DropdownMenu.ItemIndicator></span>{name}
      </DropdownMenu.CheckboxItem>)}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
