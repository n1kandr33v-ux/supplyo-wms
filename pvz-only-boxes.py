from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("[boxCount,setBoxCount]=useState('1')","[boxCount,setBoxCount]=useState('')")
a=s.index('<div className={`box-count ');b=s.index('</div><Button disabled={deliveryType',a)+len('</div>')
s=s[:a]+'''<div className="box-count-slot">{deliveryType==='ПВЗ'&&<div className="box-count box-count-visible"><FieldLabel htmlFor="delivery-boxes">Коробов для ПВЗ</FieldLabel><Input id="delivery-boxes" type="number" min="1" step="1" inputMode="numeric" placeholder="Кол-во" value={boxCount} onChange={e=>setBoxCount(e.target.value)}/></div>}</div>'''+s[b:]
p.write_text(s,encoding='utf-8')
