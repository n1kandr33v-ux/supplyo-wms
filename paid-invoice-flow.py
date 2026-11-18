from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('type Entry={category?', 'type Entry={recordedAt?:string;category?')
s=s.replace("kind:'income',date:today(),title:`Оплата счёта ${invoice.number||invoice.title}`", "kind:'income',recordedAt:new Date().toISOString(),date:today(),title:`Оплата счёта ${invoice.number||invoice.title}`")
s=s.replace(".sort((a,b)=>b.date.localeCompare(a.date))", ".sort((a,b)=>b.date.localeCompare(a.date)||(b.recordedAt||'').localeCompare(a.recordedAt||'')||Number(b.id.startsWith('invoice-payment-'))-Number(a.id.startsWith('invoice-payment-')))")
s=s.replace(":r.kind==='invoice')", ":r.kind==='invoice'&&!r.paid)")
# Restore paid invoices that lack a matching income, without duplicating existing payments.
needle="localStorage.setItem('supplyo-accounting',JSON.stringify(rows));return rows}"
replacement="""for(const invoice of [...rows]){if(invoice.kind==='invoice'&&invoice.paid&&!rows.some(row=>row.id==='invoice-payment-'+invoice.id)){rows.push({...invoice,id:'invoice-payment-'+invoice.id,kind:'income',title:`Оплата счёта ${invoice.number||invoice.title}`})}}localStorage.setItem('supplyo-accounting',JSON.stringify(rows));return rows}"""
assert needle in s;s=s.replace(needle,replacement)
p.write_text(s,encoding='utf-8')
