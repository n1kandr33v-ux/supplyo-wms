from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s="import { validateMarking } from '@/lib/marking'\n"+s
s=s.replace("[kizValue,setKizValue]=useState('')","[kizValue,setKizValue]=useState(''),[kizError,setKizError]=useState('')")
pos=s.index(' function scanProduct()')
s=s[:pos]+''' function saveKiz(){if(!actionItem)return;const result=validateMarking(kizValue);if(!result.valid){setKizError(result.message);toast.error('Отсканируйте КИЗ');return}const duplicate=items.some(i=>i.id!==actionItem.id&&i.kiz&&(()=>{const saved=validateMarking(i.kiz);return saved.valid&&saved.identity===result.identity})());if(duplicate){setKizError('Этот КИЗ уже указан в другом заказе. Отсканируйте другой КИЗ.');return}update(actionItem.id,{kiz:result.code});setActionItem({...actionItem,kiz:result.code});setActionMode('print');setKizError('');toast.success('КИЗ сохранён')}
'''+s[pos:]
s=s.replace("setActionMode('kiz');", "setActionMode('kiz');setKizError('');")
s=s.replace('onChange={e=>setKizValue(e.target.value)} placeholder="Сканируйте или введите КИЗ"/>','aria-invalid={!!kizError} aria-describedby={kizError?"kiz-error":undefined} onChange={e=>{setKizValue(e.target.value);setKizError(\'\')}} onKeyDown={e=>{if(e.key===\'Enter\'){e.preventDefault();saveKiz()}}} placeholder="Сканируйте или введите КИЗ"/>{kizError&&<p id="kiz-error" role="alert" className="text-sm text-destructive">{kizError}</p>}')
a=s.index("onClick={()=>{if(actionItem){update(actionItem.id,{kiz:kizValue.trim()})");b=s.index('>Сохранить</Button>',a);s=s[:a]+'onClick={saveKiz}'+s[b:]
p.write_text(s,encoding='utf-8')
