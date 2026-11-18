from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace("[actionMode,setActionMode]=useState<'kiz'|'print'>('print')", "[actionMode,setActionMode]=useState<'kiz'|'print'>('print'),[printItem,setPrintItem]=useState<Item|null>(null)")
pos=s.index(' function saveKiz()')
s=s[:pos]+''' function startPrint(item:Item){setActionItem(null);setPrintItem({...item});}
 useEffect(()=>{if(!printItem)return;const timer=setTimeout(()=>{window.print();setPrintItem(null);scannerRef.current?.focus()},100);return()=>clearTimeout(timer)},[printItem])
'''+s[pos:]
s=s.replace("setActionItem({...actionItem,kiz:result.code});setActionMode('print');", "startPrint({...actionItem,kiz:result.code});")
s=s.replace("else{setActionMode('print')}","else{startPrint(item)}")
s=s.replace("onClick={()=>{setActionItem(i);setActionMode('print')}}", "onClick={()=>startPrint(i)}")
a=s.index(':<div className="sticker-preview">');b=s.index('</div>}',a)+len('</div>}');s=s[:a]+':null}'+s[b:]
s=s.replace("{actionMode==='kiz'?'КИЗ товара':'Предпросмотр стикера'}", "КИЗ товара")
s=s.replace(":<Button onClick={()=>window.print()}>Печать</Button>",':null')
pos=s.index(' <Dialog open={!!actionItem}')
s=s[:pos]+''' {printItem&&<div className="direct-print-sticker"><strong>{printItem.sticker??`${5951000+printItem.id-6200001000}/${String(printItem.id).slice(-4)}`}</strong><p>{printItem.name} · {printItem.size}</p><p>Заказ № {printItem.id}</p></div>}
'''+s[pos:]
p.write_text(s,encoding='utf-8')
