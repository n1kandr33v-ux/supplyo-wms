from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');assert "['auto','160px','110px','140px','110px']" in s;s=s.replace("['auto','160px','110px','140px','110px']","['36%','22%','14%','16%','12%']");p.write_text(s,encoding='utf-8')
