from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');old='className="profile-menu" side="top" align="start" sideOffset={10}';assert old in s;s=s.replace(old,'className="profile-menu" side="right" align="end" sideOffset={16}');p.write_text(s,encoding='utf-8')
