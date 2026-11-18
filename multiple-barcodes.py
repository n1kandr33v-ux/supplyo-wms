from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('barcode:string;cell:string','barcode:string;additionalBarcodes?:string[];cell:string')
s=s.replace('barcode:String(2049000000100+c*100+i),','barcode:String(2049000000100+c*100+i),additionalBarcodes:i%3===0?[String(4649000000100+c*100+i)]:[],')
s=s.replace('return rows}',"return rows.map(row=>({...row,additionalBarcodes:row.additionalBarcodes??seed.find(i=>i.id===row.id)?.additionalBarcodes??[]}))}")
pos=s.index('function restore()')
s=s[:pos]+'''function itemBarcodes(item:Item){return [...new Set([item.barcode,...(item.additionalBarcodes??[])].filter(Boolean))]}
function ProductBarcodes({item}:{item:Item}){const codes=itemBarcodes(item);return <div className="product-barcodes">{codes.map((code,index)=><div key={code}><span>{code}</span>{codes.length>1&&<small>{index===0?'Основной':'Дополнительный'}</small>}</div>)}</div>}
'''+s[pos:]
s=s.replace('i.barcode===code','itemBarcodes(i).includes(code)')
s=s.replace('${i.name} ${i.barcode} ${i.cell}','${i.name} ${itemBarcodes(i).join(" ")} ${i.cell}')
s=s.replace('<TableCell className="font-mono text-xs">{i.barcode}</TableCell>','<TableCell className="font-mono text-xs"><ProductBarcodes item={i}/></TableCell>')
s=s.replace('[i.name,i.barcode,i.cell,i.address,i.stock]','[i.name,itemBarcodes(i).join(", "),i.cell,i.address,i.stock]')
p.write_text(s,encoding='utf-8')
