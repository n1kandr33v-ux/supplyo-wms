from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');needle='<CardFooter><Button disabled={!fresh.length} onClick={()=>navigate(\'new\')}><Plus data-icon="inline-start"/>Выбрать новые заказы ({fresh.length})</Button></CardFooter>';assert needle in s;s=s.replace(needle,'');p.write_text(s,encoding='utf-8')
