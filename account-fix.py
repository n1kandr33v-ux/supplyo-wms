from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace("setStaffName('')}}>","setStaffName('')}}}>");p.write_text(s,encoding='utf-8')
