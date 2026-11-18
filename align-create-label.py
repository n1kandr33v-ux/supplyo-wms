from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace('Создать поставку <span className="selection-count">({fresh.filter(i=>selected.includes(i.id)).length})</span>', '<span className="create-supply-label">Создать поставку <span className="selection-count">({fresh.filter(i=>selected.includes(i.id)).length})</span></span>');p.write_text(s,encoding='utf-8')
