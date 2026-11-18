from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');old='<Button onClick={()=>openStore(blankStore)}><Plus size={16}/>Добавить склад</Button>';assert old in s;s=s.replace(old,'');s=s.replace('length:(3-stores.length%3)%3','length:3-stores.length%3');p.write_text(s,encoding='utf-8')
