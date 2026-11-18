from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace("tab==='new'?['','Товар / заказ','Ячейка / адрес','Баркод']", "tab==='new'?['','Номер заказа','Товар','Ячейка / адрес','Баркод']")
s=s.replace("</Badge>}</TableCell><TableCell><strong>{i.name}</strong>","</Badge>}</TableCell>{tab==='new'&&<TableCell className=\"font-mono text-xs\">{i.id}</TableCell>}<TableCell><strong>{i.name}</strong>")
s=s.replace('{i.size} · № {i.id}',"{i.size}{tab!=='new'&&` · № ${i.id}`}")
s=s.replace("colSpan={tab==='new'?4:6}","colSpan={tab==='new'?5:6}")
p.write_text(s,encoding='utf-8')
