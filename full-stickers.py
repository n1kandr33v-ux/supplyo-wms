from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace('warehouse:string}', 'warehouse:string;sticker?:string}')
s=s.replace("barcode:String(2049000000100+c*100+i),", "barcode:String(2049000000100+c*100+i),sticker:`${5951000+c*100+i}/${String(1000+c*100+i).padStart(4,'0')}`,")
s=s.replace('5951 / {String(i.id).slice(-4)}',"{i.sticker ?? `${5951000+(i.id-6200001000)}/${String(i.id).slice(-4)}`}")
s=s.replace('${i.address} ${i.id}', '${i.address} ${i.id} ${i.sticker ?? ""}')
p.write_text(s,encoding='utf-8')
