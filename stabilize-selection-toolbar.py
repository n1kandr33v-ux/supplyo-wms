from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("{tab==='new'&&<Button disabled={!fresh.some(i=>selected.includes(i.id))} onClick={createSupply}>","{tab==='new'&&<Button className=\"create-supply-action\" disabled={!fresh.some(i=>selected.includes(i.id))} onClick={createSupply}>")
s=s.replace('Создать поставку ({fresh.filter(i=>selected.includes(i.id)).length})</Button>', 'Создать поставку <span className="selection-count">({fresh.filter(i=>selected.includes(i.id)).length})</span></Button>')
p.write_text(s,encoding='utf-8')
