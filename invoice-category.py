from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8');old="{(draft.kind==='income'||draft.kind==='expense')&&<Field><FieldLabel htmlFor=\"entry-category\">";new="{draft.kind!=='work'&&<Field><FieldLabel htmlFor=\"entry-category\">";assert old in s;s=s.replace(old,new);p.write_text(s,encoding='utf-8')
