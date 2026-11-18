from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');a=s.index('<div className="staff-role-presets">');b=s.index('<div className="staff-permissions">',a);s=s[:a]+s[b:];a=s.index('<small>{s.staffRights?.[name]');b=s.index('</small>',a)+8;s=s[:a]+s[b:];p.write_text(s,encoding='utf-8')
