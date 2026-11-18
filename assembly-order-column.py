from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("['Статус','Товар / заказ','Ячейка / адрес','Баркод','Стикер','']","['Статус','Номер заказа','Товар','Ячейка / адрес','Баркод','Стикер','']")
s=s.replace("{tab==='new'&&<TableCell className=\"font-mono text-xs\">{i.id}</TableCell>}",'<TableCell className="font-mono text-xs">{i.id}</TableCell>')
s=s.replace("{i.size}{tab!=='new'&&` · № ${i.id}`}",'{i.size}')
s=s.replace('colSpan={6}',"colSpan={tab==='assembly'?7:6}")
p.write_text(s,encoding='utf-8')
