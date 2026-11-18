from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace('codes.map((code,index)=>','codes.map(code=>').replace("{codes.length>1&&<small>{index===0?'Основной':'Дополнительный'}</small>}",'');p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='\n.product-barcodes{gap:5px}\n';p.write_text(s,encoding='utf-8')
