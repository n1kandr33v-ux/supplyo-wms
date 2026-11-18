from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace("<CardFooter className=\"justify-between\">{tab!=='assembly'&&", "<CardFooter className=\"justify-between\">{tab==='new'&&");p.write_text(s,encoding='utf-8')
