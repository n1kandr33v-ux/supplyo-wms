from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace('warehouse:string;sticker?', 'warehouse:string;supplyId?:string;sticker?')
s=s.replace("[query,setQuery]=useState('')","[query,setQuery]=useState(''),[addSupplyOpen,setAddSupplyOpen]=useState(false),[targetSupply,setTargetSupply]=useState('')")
pos=s.index(' function navigate(')
s=s[:pos]+''' const selectedOrders=fresh.filter(i=>selected.includes(i.id))
 const selectedWarehouses=[...new Set(selectedOrders.map(i=>i.warehouse))]
 const eligibleSupplies=[...new Map(items.filter(i=>i.client===client&&i.phase==='assembly'&&(selectedWarehouses.length===1?i.warehouse===selectedWarehouses[0]:warehouse==='Все склады'||i.warehouse===warehouse)).map(i=>{const id=i.supplyId??`DEMO-${1000+client}-${i.warehouse}`;return [id,{id,warehouse:i.warehouse}]})).values()]
 function appendToSupply(){const target=eligibleSupplies.find(s=>s.id===targetSupply);if(!target||!selectedOrders.length||selectedWarehouses.length!==1||selectedOrders.some(i=>i.warehouse!==target.warehouse))return;setItems(prev=>prev.map(i=>selectedOrders.some(order=>order.id===i.id)?{...i,phase:'assembly',supplyId:target.id,ready:false,assemblyStatus:'waiting'}:i));setAddSupplyOpen(false);navigate('assembly');toast.success('Заказы добавлены в поставку')}
'''+s[pos:]
s=s.replace("phase:'assembly'}:i));navigate('assembly');toast.success('Заказы добавлены в тестовую поставку')", "phase:'assembly',supplyId:`DEMO-${Date.now()}-${i.warehouse}`,ready:false,assemblyStatus:'waiting'}:i));navigate('assembly');toast.success('Поставка создана')")
needle="{tab==='new'&&<Button disabled={!fresh.some(i=>selected.includes(i.id))} onClick={createSupply}>"
s=s.replace(needle,"{tab==='new'&&eligibleSupplies.length>0&&<Button variant=\"outline\" disabled={!selectedOrders.length||selectedWarehouses.length!==1} onClick={()=>{setTargetSupply(eligibleSupplies[0].id);setAddSupplyOpen(true)}}>Добавить в поставку</Button>}"+needle)
pos=s.index(' <Dialog open={!!actionItem}')
s=s[:pos]+''' <Dialog open={addSupplyOpen} onOpenChange={setAddSupplyOpen}><DialogContent><DialogHeader><DialogTitle>Добавить в поставку</DialogTitle><DialogDescription>{selectedOrders.length} заказов · {selectedWarehouses[0]}</DialogDescription></DialogHeader><Field><FieldLabel>Открытая поставка</FieldLabel><Picker value={targetSupply} onChange={setTargetSupply} values={eligibleSupplies.map(s=>s.id)}/></Field><DialogFooter><Button disabled={!targetSupply||!selectedOrders.length||selectedWarehouses.length!==1} onClick={appendToSupply}>Добавить заказы</Button></DialogFooter></DialogContent></Dialog>
'''+s[pos:]
p.write_text(s,encoding='utf-8')
