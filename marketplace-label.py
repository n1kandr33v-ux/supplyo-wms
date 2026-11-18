from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');needle=' values={clients}/>';s=s.replace(needle,needle+'<Badge variant="secondary" className="marketplace-badge" aria-label="Маркетплейс: Wildberries">Wildberries</Badge>',1);p.write_text(s,encoding='utf-8')
