from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace("[supplyWarehouse,setSupplyWarehouse]=useState('Все склады'),","[supplyWarehouse,setSupplyWarehouse]=useState('Все склады'),[stockAvailability,setStockAvailability]=useState('Все товары'),")
s=s.replace("const filtered=current.filter(i=>(tab==='stocks'||i.phase===tab)&&", "const filtered=current.filter(i=>(tab==='stocks'||i.phase===tab)&&(tab!=='stocks'||stockAvailability==='Все товары'||i.stock>0)&&")
needle="{tab==='assembly'&&<Picker value={status}"
assert needle in s
s=s.replace(needle,"{tab==='stocks'&&<Picker value={stockAvailability} onChange={setStockAvailability} values={['Все товары','В наличии']}/>}"+needle)
p.write_text(s,encoding='utf-8')
