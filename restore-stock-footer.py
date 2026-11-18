from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace('<CardFooter className="justify-between">', '<CardFooter className={`justify-between${tab===\'stocks\'?\' stocks-table-footer\':\'\'}`}>');p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='\n[data-slot=card-footer].stocks-table-footer:empty{display:flex;min-height:40px;background:var(--portal-elevated);border-top:1px solid var(--portal-line)}\n';p.write_text(s,encoding='utf-8')
