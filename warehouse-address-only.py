from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8')
s=s.replace("[staffName,setStaffName]=useState(''),",'')
s=s.replace("setStaffName('');",'')
a=s.index('<Field><FieldLabel htmlFor="store-staff">');b=s.index('</Field>',a)+len('</Field>');s=s[:a]+s[b:]
s=s.replace('Название, расположение и сотрудники','Название и расположение')
s=s.replace("[storeError,setStoreError]=useState('')","[storeError,setStoreError]=useState(''),[addressStore,setAddressStore]=useState<Store|null>(null),[warehouseAddress,setWarehouseAddress]=useState('')")
s=s.replace('title="Изменить адрес" onClick={()=>openStore(s)}','title="Изменить адрес" onClick={()=>{setAddressStore(s);setWarehouseAddress(s.address)}}')
needle=' <Dialog open={!!store}'
assert needle in s
s=s.replace(needle,''' <Dialog open={!!addressStore} onOpenChange={open=>!open&&setAddressStore(null)}><DialogContent><form onSubmit={e=>{e.preventDefault();if(!addressStore||!warehouseAddress.trim())return;persistStores(stores.map(s=>s.id===addressStore.id?{...s,address:warehouseAddress.trim()}:s));setAddressStore(null);toast.success('Адрес сохранён')}}><DialogHeader><DialogTitle>Изменить адрес</DialogTitle><DialogDescription>{addressStore?.name} · {addressStore?.city}</DialogDescription></DialogHeader><Field className="account-dialog-fields"><FieldLabel htmlFor="warehouse-address-only">Адрес склада</FieldLabel><Input id="warehouse-address-only" autoFocus required value={warehouseAddress} onChange={e=>setWarehouseAddress(e.target.value)}/></Field><DialogFooter><Button type="button" variant="outline" onClick={()=>setAddressStore(null)}>Отменить</Button><Button type="submit" disabled={!warehouseAddress.trim()}>Сохранить адрес</Button></DialogFooter></form></DialogContent></Dialog>
'''+needle,1)
p.write_text(s,encoding='utf-8')
