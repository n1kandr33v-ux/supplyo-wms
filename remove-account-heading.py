from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');a=s.index('<div className="account-heading">');b=s.index('\n {',a);s=s[:a]+s[b:];s=s.replace('UserRound, Warehouse','Warehouse');p.write_text(s,encoding='utf-8')
