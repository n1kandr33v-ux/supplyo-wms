from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');a=s.index('<Field><FieldLabel>Порядок сборки</FieldLabel>');b=s.index('</Field>',a)+len('</Field>');s=s[:a]+s[b:];p.write_text(s,encoding='utf-8')
