from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');assert "['36%','22%','14%','16%','12%']" in s;s=s.replace("['36%','22%','14%','16%','12%']","['36%','170px','auto','180px','130px']");p.write_text(s,encoding='utf-8')
