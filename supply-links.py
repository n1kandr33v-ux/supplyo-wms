from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('<TableCell className="font-mono text-xs">{supply.id}</TableCell>','<TableCell className="font-mono text-xs">{supply.phase===\'assembly\'?<button type="button" className="supply-number-link" onClick={()=>{setActiveSupply(supply.id);setWarehouse(supply.warehouse);navigate(\'assembly\')}}>{supply.id}</button>:supply.id}</TableCell>')
s=s.replace('<Badge variant="secondary">На сборке</Badge></button>','<ScanLine size={14}/>На сборке</button>')
p.write_text(s,encoding='utf-8')
