from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');a=s.index('<Card><CardHeader><CardTitle>Демонстрационные данные');b=s.index('</Card>',a)+len('</Card>');s=s[:a]+s[b:];p.write_text(s,encoding='utf-8')
