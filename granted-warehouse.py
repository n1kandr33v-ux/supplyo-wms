from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace(",[supplyWarehouse,setSupplyWarehouse]=useState('Все склады')",'').replace(",[warehouse,setWarehouse]=useState('Все склады')",'')
# Current demo client grants are restricted to Kazan; scope every WMS dataset to that grant.
pos=s.index(' const current=');s=s[:pos]+" const warehouse='Казань'\n"+s[pos:]
s=s.replace("setWarehouse('Все склады');",'').replace("setWarehouse('Все склады')",'').replace('setWarehouse(supply.warehouse);','')
s=s.replace("if(supplyWarehouse!=='Все склады'&&supply.warehouse!==supplyWarehouse)return false;",'')
old="{tab==='stocks'&&<div className=\"stocks-warehouse-filter\"><Picker value={warehouse} onChange={setWarehouse} values={['Все склады',...new Set(items.filter(i=>i.client===client).map(i=>i.warehouse))]}/></div>}"
assert old in s;s=s.replace(old,'')
old="<div className=\"supply-filter\"><label>Склад</label><Picker value={supplyWarehouse} onChange={setSupplyWarehouse} values={['Все склады',...new Set([...supplyGroups,...historyExamples].map(s=>s.warehouse))]}/></div>"
assert old in s;s=s.replace(old,'')
s=s.replace("{['Казань','Москва'].map(city=>", "{[warehouse].map(city=>")
old='<Card><CardHeader><CardTitle>Отображение склада</CardTitle><CardDescription>Настройки этого сеанса</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel>Доступные склады</FieldLabel><Picker value={warehouse} onChange={setWarehouse} values={[\'Казань\',\'Москва\',\'Все склады\']}/></Field></FieldGroup></CardContent></Card>'
assert old in s;s=s.replace(old,'')
s=s.replace('FieldGroup, ','').replace(', FieldGroup','')
# Simplify now-unnecessary all-warehouses branches, preventing literal-type TS diagnostics.
s=s.replace("(warehouse==='Все склады'||i.warehouse===warehouse)","i.warehouse===warehouse").replace("warehouse==='Все склады'||s.warehouse===warehouse","s.warehouse===warehouse").replace("warehouse==='Все склады'||i.warehouse===warehouse","i.warehouse===warehouse").replace("{warehouse!=='Все склады'&&<Badge variant=\"secondary\">{warehouse}</Badge>}","<Badge variant=\"secondary\">{warehouse}</Badge>")
p.write_text(s,encoding='utf-8')
