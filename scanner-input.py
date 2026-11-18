from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig').replace('useState, useEffect','useState, useEffect, useRef')
s=s.replace("[query,setQuery]=useState('')","[query,setQuery]=useState(''),[scan,setScan]=useState('')")
pos=s.index(' useEffect(()=>{document.documentElement')
s=s[:pos]+''' const scannerRef=useRef<HTMLInputElement>(null)
 useEffect(()=>{if(tab==='assembly'&&!actionItem&&!edit)scannerRef.current?.focus()},[tab,actionItem,edit])
 function scanProduct(){const code=scan.trim();if(!code)return;const matches=items.filter(i=>i.client===client&&i.phase==='assembly'&&(warehouse==='Все склады'||i.warehouse===warehouse)&&(i.barcode===code||String(i.id)===code||i.sticker===code));const item=matches.find(i=>!i.ready)??matches[0];setScan('');if(!item){toast.error('Товар не найден в текущей сборке');return}setActionItem(item);if((item.requiresKiz??item.client!==4)&&!item.kiz){setActionMode('kiz');setKizValue('')}else{setActionMode('print')}}
'''+s[pos:]
s=s.replace('<CardContent><div className="table-toolbar">','''<CardContent>{tab==='assembly'&&<form className="scanner-panel" onSubmit={e=>{e.preventDefault();scanProduct()}}><Field><FieldLabel htmlFor="product-scan"><ScanLine size={16}/>Сканирование товара</FieldLabel><div className="flex gap-2"><Input ref={scannerRef} id="product-scan" autoComplete="off" placeholder="Сканируйте баркод и нажмите Enter" value={scan} onChange={e=>setScan(e.target.value)}/><Button type="submit" disabled={!scan.trim()}>Сканировать</Button></div><p className="text-xs text-muted-foreground">Сканер вводит код сюда. Поиск в таблице работает отдельно.</p></Field></form>}<div className="table-toolbar">''',1)
s=s.replace("update(actionItem.id,{kiz:kizValue.trim()});setActionItem(null);toast.success('КИЗ сохранён')","update(actionItem.id,{kiz:kizValue.trim()});setActionItem({...actionItem,kiz:kizValue.trim()});setActionMode('print');toast.success('КИЗ сохранён')")
p.write_text(s,encoding='utf-8')
