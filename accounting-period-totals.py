from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8')
a=s.index(' const filtered=');b=s.index(' const people=',a)
s=s[:a]+''' const periodRows=rows.filter(r=>(r.warehouseId||warehouses[0]?.id||'unassigned')===warehouseId&&(!from||r.date>=from)&&(!to||r.date<=to))
 const filtered=periodRows.filter(r=>(tab!=='money'||categoryFilter==='all'||operationCategory(r)===categoryFilter)&&`${r.title} ${r.person} ${r.number} ${operationCategory(r)}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date))
 const income=periodRows.filter(r=>r.kind==='income').reduce((s,r)=>s+r.amount,0),expense=periodRows.filter(r=>r.kind==='expense').reduce((s,r)=>s+r.amount,0),wages=filtered.filter(r=>r.kind==='work'),periodWages=periodRows.filter(r=>r.kind==='work'),paidWages=periodWages.filter(r=>r.paid).reduce((s,r)=>s+r.amount,0),accrued=periodWages.reduce((s,r)=>s+r.amount,0)
'''+s[b:]
s=s.replace("filtered.filter(r=>r.kind==='invoice').reduce", "periodRows.filter(r=>r.kind==='invoice').reduce").replace("filtered.filter(r=>r.kind==='invoice'&&!r.paid).reduce", "periodRows.filter(r=>r.kind==='invoice'&&!r.paid).reduce")
p.write_text(s,encoding='utf-8')
