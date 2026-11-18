from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s="import { EditableStockValue } from '@/components/editable-stock-value'\n"+s
s=s.replace('MapPin, Pencil, Plus','MapPin, Plus')
s=s.replace(",[edit,setEdit]=useState<Item|null>(null),[address,setAddress]=useState(''),[cell,setCell]=useState(''),[stock,setStock]=useState('')",'')
a=s.index('<TableCell><Badge variant="secondary">{i.cell}</Badge></TableCell><TableCell>{i.address}</TableCell>')
b=s.index('</>:<>',a)
s=s[:a]+'''<TableCell><EditableStockValue value={i.cell} label={`Ячейка ${i.name}`} onSave={value=>update(i.id,{cell:value})}/></TableCell><TableCell><EditableStockValue value={i.address} label={`Адрес ${i.name}`} onSave={value=>update(i.id,{address:value})}/></TableCell><TableCell><EditableStockValue value={String(i.stock)} numeric label={`Остаток ${i.name}`} onSave={value=>update(i.id,{stock:Number(value)})}/></TableCell>'''+s[b:]
s=s.replace("['auto','160px','110px','140px','100px','60px']","['auto','160px','110px','140px','110px']").replace("['Товар','Баркод','Ячейка','Адрес','Остаток','']","['Товар','Баркод','Ячейка','Адрес','Остаток']").replace("colSpan={tab==='assembly'?7:6}","colSpan={tab==='assembly'?7:tab==='stocks'?5:6}")
s='\n'.join(line for line in s.split('\n') if '<Dialog open={!!edit}' not in line)
p.write_text(s,encoding='utf-8')
