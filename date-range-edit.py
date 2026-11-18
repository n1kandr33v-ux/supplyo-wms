from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s="import { DateRangePicker } from '@/components/date-range-picker'\n"+s
start=s.index('<div className="supply-filter"><label htmlFor="supply-date-from">');end=s.index("{(supplyWarehouse!=='Все склады'",start)
s=s[:start]+'<div className="supply-filter"><label>Период</label><DateRangePicker from={supplyFrom} to={supplyTo} onChange={(from,to)=>{setSupplyFrom(from);setSupplyTo(to)}}/></div>'+s[end:]
s=s.replace('Передана в доставку','Передана в доставку')
# Correct misspelled Cyrillic word visible in screenshot/source.
s=s.replace('Передана в доставку','Передана в доставку').replace('Передана в доставку','Передана в доставку')
p.write_text(s,encoding='utf-8')
