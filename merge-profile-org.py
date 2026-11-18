from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace("['profile','Мой профиль',UserRound],['organization','Моя организация',Building2]","['profile','Профиль и организация',UserRound]");s=s.replace('UserRound, Building2, Warehouse','UserRound, Warehouse');p.write_text(s,encoding='utf-8')
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace("{section==='organization'&&<form", "{(section==='profile'||section==='organization')&&<form");p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='\n.personal-account .account-grid+.organization-form{margin-top:24px}\n';p.write_text(s,encoding='utf-8')
