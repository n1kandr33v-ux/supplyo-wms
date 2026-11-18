from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');a=s.index("{tab==='new'&&<span className=\"text-muted-foreground text-xs\">Показано");b=s.index('</span>}',a)+len('</span>}');s=s[:a]+s[b:];s=s.replace("tab==='stocks'?' stocks-table-footer':''","tab!=='assembly'?' stocks-table-footer':''");p.write_text(s,encoding='utf-8')
