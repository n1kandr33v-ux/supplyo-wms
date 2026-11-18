from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace("{dataRow('org','phone','Телефон','tel')}{dataRow('org','email','Электронная почта','email')}",'');p.write_text(s,encoding='utf-8')
