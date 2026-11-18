from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
needle="{tab==='assembly'&&<Picker value={status}"
assert needle in s
s=s.replace(needle,"{tab==='stocks'&&<div className=\"stocks-warehouse-filter\"><Picker value={warehouse} onChange={setWarehouse} values={['Все склады',...new Set(items.filter(i=>i.client===client).map(i=>i.warehouse))]}/></div>}"+needle)
p.write_text(s,encoding='utf-8')
