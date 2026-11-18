from pathlib import Path
p=Path('src/index.css');s=p.read_text(encoding='utf-8').replace('.account-error{color:#f87171;','.account-error{color:var(--destructive);');p.write_text(s,encoding='utf-8')
