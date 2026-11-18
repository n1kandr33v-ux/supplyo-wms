from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
a='<TableCell><Badge variant="secondary">{supply.phase===\'shipped\'?\'Отгружена\':\'На сборке\'}</Badge></TableCell><TableCell>{supply.phase===\'assembly\'&&<Button variant="ghost" onClick={()=>{setActiveSupply(supply.id);setWarehouse(supply.warehouse);navigate(\'assembly\')}}>Открыть</Button>}</TableCell>'
b='<TableCell>{supply.phase===\'assembly\'?<button type="button" className="supply-status-link" aria-label={`На сборке: ${supply.id}`} onClick={()=>{setActiveSupply(supply.id);setWarehouse(supply.warehouse);navigate(\'assembly\')}}><Badge variant="secondary">На сборке</Badge></button>:<Badge variant="secondary">Отгружена</Badge>}</TableCell>'
assert a in s
s=s.replace(a,b).replace("'Куда отгружено','Статус',''","'Куда отгружено','Статус'").replace('colSpan={10} className="py-12','colSpan={9} className="py-12')
p.write_text(s,encoding='utf-8')
