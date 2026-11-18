from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8');s="import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'\n"+s;s=s.replace("[query,setQuery]=useState('')","[query,setQuery]=useState(''),[workPayment,setWorkPayment]=useState('pending')")
s=s.replace("tab==='work'?r.kind==='work':r.kind==='invoice'","tab==='work'?r.kind==='work'&&(workPayment==='all'||(workPayment==='paid'?r.paid:!r.paid)):r.kind==='invoice'")
needle="{tab==='money'?<><Button"
assert needle in s
s=s.replace(needle,"{tab==='work'&&<Select value={workPayment} onValueChange={setWorkPayment}><SelectTrigger aria-label=\"Оплата работ\" className=\"work-payment-filter\"><SelectValue/></SelectTrigger><SelectContent><SelectItem value=\"pending\">К выплате</SelectItem><SelectItem value=\"paid\">Выплачено</SelectItem><SelectItem value=\"all\">Все работы</SelectItem></SelectContent></Select>}"+needle)
p.write_text(s,encoding='utf-8')
