from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');a=s.index('<span className="text-muted-foreground text-xs">Показано');b=s.index('</span>',a)+len('</span>');s=s[:a]+"{tab!=='assembly'&&"+s[a:b]+'}'+s[b:];p.write_text(s,encoding='utf-8')
