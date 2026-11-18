from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8')
needle=' return <div className="accounting mt-6">'
fn=''' function deleteEntry(entry:Entry){
 const grouped=entry.id.startsWith('salary-group:')
 const targets=grouped?rows.filter(r=>r.id.startsWith('salary-payment-')&&r.date===entry.date&&r.person===entry.person&&(r.warehouseId||warehouses[0]?.id||'unassigned')===warehouseId):[entry]
 const removed=new Set(targets.flatMap(r=>[r.id,'invoice-payment-'+r.id,'salary-payment-'+r.id]))
 const unpaid=new Set(targets.flatMap(r=>r.id.startsWith('salary-payment-')?[r.id.slice('salary-payment-'.length)]:r.id.startsWith('invoice-payment-')?[r.id.slice('invoice-payment-'.length)]:[]))
 persist(rows.filter(r=>!removed.has(r.id)).map(r=>unpaid.has(r.id)?{...r,paid:false}:r));setDeleting(null);toast.success('Запись удалена')
 }
'''
assert needle in s;s=s.replace(needle,fn+needle)
needle='size="icon" disabled={r.id.startsWith(\'invoice-payment-\')||(r.id.startsWith(\'salary-payment-\')||r.id.startsWith(\'salary-group:\'))} aria-label='
assert needle in s;s=s.replace(needle,'size="icon" aria-label=')
s=s.replace('<p>{deleting?.title}</p>','<div><p>{deleting?.title}</p>{deleting?.person&&<p className="mt-2 text-sm text-muted-foreground">{deleting.person}</p>}</div>')
old="if(deleting)persist(rows.filter(r=>r.id!==deleting.id&&r.id!=='invoice-payment-'+deleting.id&&r.id!=='salary-payment-'+deleting.id));setDeleting(null)"
assert old in s;s=s.replace(old,'if(deleting)deleteEntry(deleting)')
p.write_text(s,encoding='utf-8')
