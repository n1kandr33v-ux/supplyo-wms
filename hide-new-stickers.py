from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace(":['Статус','Товар / заказ','Ячейка / адрес','Баркод','Стикер','']).map",":tab==='new'?['','Товар / заказ','Ячейка / адрес','Баркод']:['Статус','Товар / заказ','Ячейка / адрес','Баркод','Стикер','']).map")
s=s.replace('<TableCell className="font-mono text-xs">{i.sticker ?? `${5951000+(i.id-6200001000)}/${String(i.id).slice(-4)}`}</TableCell><TableCell>{tab===\'assembly\'&&',"{tab!=='new'&&<TableCell className=\"font-mono text-xs\">{i.sticker ?? `${5951000+(i.id-6200001000)}/${String(i.id).slice(-4)}`}</TableCell>}{tab!=='new'&&<TableCell>{tab==='assembly'&&")
s=s.replace("{i.ready?'Отменить':'Собрано'}</Button>}</TableCell></>}","{i.ready?'Отменить':'Собрано'}</Button>}</TableCell>}</>}")
s=s.replace('colSpan={6}',"colSpan={tab==='new'?4:6}")
s=s.replace('<Button disabled={!fresh.some(i=>selected.includes(i.id))} onClick={createSupply}><Plus data-icon="inline-start"/>Создать из новых заказов ({fresh.length})</Button>', '<Button disabled={!fresh.length} onClick={()=>navigate(\'new\')}><Plus data-icon="inline-start"/>Выбрать новые заказы ({fresh.length})</Button>')
p.write_text(s,encoding='utf-8')
