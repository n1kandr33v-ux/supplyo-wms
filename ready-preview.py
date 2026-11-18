from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
a=s.index('function restore():Item[]');b=s.index('\nconst sections=',a)
s=s[:a]+'''function restore():Item[]{let rows:Item[];try{rows=JSON.parse(localStorage.getItem('wms-v2-demo')||'null')||seed}catch{rows=seed}if(!localStorage.getItem('wms-ready-preview-20261106')){rows=rows.map(i=>i.phase==='assembly'?{...i,ready:true,assemblyStatus:'ready' as const}:i);localStorage.setItem('wms-ready-preview-20261106','1');localStorage.setItem('wms-v2-demo',JSON.stringify(rows))}return rows}
'''+s[b:]
p.write_text(s,encoding='utf-8')
