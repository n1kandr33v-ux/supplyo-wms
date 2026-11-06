import { MultiSelectPicker } from './ui/multi-select-picker'

type Props = { names: string[]; value: number[]; onChange: (value: number[]) => void }
export function CabinetPicker(props: Props) {
  return <MultiSelectPicker {...props} label="Кабинеты" allLabel="Все кабинеты" emptyLabel="Выберите кабинеты" countLabel="Кабинетов" />
}
