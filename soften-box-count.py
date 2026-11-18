from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("{deliveryType==='ПВЗ'&&<div className=\"box-count\">",'<div className={`box-count ${deliveryType===\'ПВЗ\'?\'box-count-visible\':\'box-count-hidden\'}`} aria-hidden={deliveryType!==\'ПВЗ\'}>')
s=s.replace('id="delivery-boxes" type="number"','id="delivery-boxes" disabled={deliveryType!==\'ПВЗ\'} tabIndex={deliveryType===\'ПВЗ\'?0:-1} type="number"')
s=s.replace('onChange={e=>setBoxCount(e.target.value)}/></div>}<Button','onChange={e=>setBoxCount(e.target.value)}/></div><Button')
p.write_text(s,encoding='utf-8')
