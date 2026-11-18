from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
needle='<Table className={`orders-table orders-table-${tab}`}>'
assert needle in s
s=s.replace(needle,'''{tab==='stocks'&&<div className="stock-summary" aria-live="polite"><div><span>Общий остаток</span><strong>{filtered.reduce((sum,item)=>sum+item.stock,0).toLocaleString('ru-RU')} <small>шт.</small></strong></div><div><span>Позиций в наличии</span><strong>{filtered.filter(item=>item.stock>0).length.toLocaleString('ru-RU')}</strong></div></div>}'''+needle)
p.write_text(s,encoding='utf-8')
