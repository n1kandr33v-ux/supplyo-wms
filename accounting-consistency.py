from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8')
s=s.replace("persist(draft.id?rows.map(r=>r.id===draft.id?next:r):[...rows,next]);", "persist(draft.id?rows.map(r=>r.id===draft.id?next:r.id==='invoice-payment-'+draft.id||r.id==='salary-payment-'+draft.id?{...r,amount:next.amount,person:next.person,title:next.kind==='invoice'?`Оплата счёта ${next.number||next.title}`:`Зарплата: ${next.title}`}:r):[...rows,next]);")
s=s.replace('className="supply-number-link" onClick={()=>setDraft(r)}','className="supply-number-link" disabled={r.id.startsWith(\'invoice-payment-\')||r.id.startsWith(\'salary-payment-\')} onClick={()=>setDraft(r)}')
s=s.replace('aria-label={`Удалить ${r.title}`} onClick',"disabled={r.id.startsWith('invoice-payment-')||r.id.startsWith('salary-payment-')} aria-label={`Удалить ${r.title}`} onClick")
p.write_text(s,encoding='utf-8')
