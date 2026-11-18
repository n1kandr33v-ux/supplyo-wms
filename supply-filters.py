from pathlib import Path
p=Path('src/App.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace("[activeSupply,setActiveSupply]=useState(''),", "[activeSupply,setActiveSupply]=useState(''),[supplyWarehouse,setSupplyWarehouse]=useState('Все склады'),[supplyFrom,setSupplyFrom]=useState(''),[supplyTo,setSupplyTo]=useState(''),")
needle=' const formatSupplyDate='
idx=s.find(needle)
print('formatter location',idx)
# Insert independently before JSX return (formatter is an arrow declaration).
line=next(line for line in s.splitlines() if 'const formatSupplyDate=' in line)
extra="""
 const visibleSupplies=[...supplyGroups,...historyExamples].filter(supply=>{if(supplyWarehouse!=='Все склады'&&supply.warehouse!==supplyWarehouse)return false;if(!supplyFrom&&!supplyTo)return true;if(!supply.closedAt)return false;const day=new Date(new Date(supply.closedAt).getTime()+3*60*60*1000).toISOString().slice(0,10);return (!supplyFrom||day>=supplyFrom)&&(!supplyTo||day<=supplyTo)}).sort((a,b)=>b.openedAt.localeCompare(a.openedAt))
"""
s=s.replace(line,line+extra)
s=s.replace('<CardContent><Table className="supplies-table">','''<CardContent><div className="supply-filters"><div className="supply-filter"><label>Склад</label><Picker value={supplyWarehouse} onChange={setSupplyWarehouse} values={['Все склады',...new Set([...supplyGroups,...historyExamples].map(s=>s.warehouse))]}/></div><div className="supply-filter"><label htmlFor="supply-date-from">Дата с</label><Input id="supply-date-from" type="date" value={supplyFrom} max={supplyTo||undefined} onChange={e=>setSupplyFrom(e.target.value)}/></div><div className="supply-filter"><label htmlFor="supply-date-to">Дата по</label><Input id="supply-date-to" type="date" value={supplyTo} min={supplyFrom||undefined} onChange={e=>setSupplyTo(e.target.value)}/></div>{(supplyWarehouse!=='Все склады'||supplyFrom||supplyTo)&&<Button variant="ghost" onClick={()=>{setSupplyWarehouse('Все склады');setSupplyFrom('');setSupplyTo('')}}>Сбросить</Button>}</div><Table className="supplies-table">''')
s=s.replace('[...supplyGroups,...historyExamples].sort((a,b)=>b.openedAt.localeCompare(a.openedAt)).map(supply=>','visibleSupplies.map(supply=>')
s=s.replace('</TableRow>)}</TableBody></Table></CardContent></Card>}','</TableRow>)}{visibleSupplies.length===0&&<TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">Нет поставок за выбранный период</TableCell></TableRow>}</TableBody></Table></CardContent></Card>}',1)
p.write_text(s,encoding='utf-8')
