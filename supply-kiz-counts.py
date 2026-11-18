from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('count:rows.length,openedAt:',"count:rows.length,withKiz:rows.filter(i=>i.requiresKiz??i.client!==4).length,withoutKiz:rows.filter(i=>!(i.requiresKiz??i.client!==4)).length,openedAt:")
s=s.replace("count:38,openedAt:","count:38,withKiz:client===4?0:30,withoutKiz:client===4?38:8,openedAt:").replace("count:21,openedAt:","count:21,withKiz:client===4?0:16,withoutKiz:client===4?21:5,openedAt:").replace("count:57,openedAt:","count:57,withKiz:client===4?0:45,withoutKiz:client===4?57:12,openedAt:")
s=s.replace("'Передана','Заказов','Коробов'","'Передана','Заказов без КИЗ','Заказов с КИЗ','Коробов'")
s=s.replace('<TableCell>{supply.count}</TableCell>','<TableCell>{supply.withoutKiz}</TableCell><TableCell>{supply.withKiz}</TableCell>')
s=s.replace('colSpan={9} className="py-12','colSpan={10} className="py-12')
p.write_text(s,encoding='utf-8')
