from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace('warehouse:string;sticker?:string}', 'warehouse:string;sticker?:string;orderedAt?:string}')
s=s.replace("warehouse:i===7?'Москва':'Казань'", "orderedAt:new Date(Date.UTC(2026,10,6,5+i,c*7)).toISOString(),warehouse:i===7?'Москва':'Казань'")
s=s.replace("['','Номер заказа','Товар','Ячейка / адрес','Баркод']","['','Номер заказа','Товар','Ячейка / адрес','Баркод','Дата и время (МСК)']")
s=s.replace('<TableCell className="font-mono text-xs">{i.barcode}</TableCell>{tab!==\'new\'&&', '<TableCell className="font-mono text-xs">{i.barcode}</TableCell>{tab===\'new\'&&<TableCell className="text-xs whitespace-nowrap">{new Date(i.orderedAt ?? Date.UTC(2026,10,6,5+(i.id%100),i.client*7)).toLocaleString(\'ru-RU\',{timeZone:\'Europe/Moscow\',day:\'2-digit\',month:\'2-digit\',year:\'numeric\',hour:\'2-digit\',minute:\'2-digit\'})}</TableCell>}{tab!==\'new\'&&')
s=s.replace("colSpan={tab==='new'?5:6}",'colSpan={6}')
p.write_text(s,encoding='utf-8')
