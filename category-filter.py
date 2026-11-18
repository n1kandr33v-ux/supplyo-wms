from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8');s=s.replace("[workPayment,setWorkPayment]=useState('pending')","[workPayment,setWorkPayment]=useState('pending'),[categoryFilter,setCategoryFilter]=useState('all')")
s=s.replace("const filtered=rows.filter(r=>", "const filtered=rows.filter(r=>(tab!=='money'||categoryFilter==='all'||operationCategory(r)===categoryFilter)&&")
needle='<DateRangePicker selectMonthOnNavigate from={from}'
insert='''{tab==='money'&&<Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger aria-label="Вид операции" className="operation-category-filter"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Все виды операций</SelectItem>{operationCategories.map(category=><SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>}'''
assert needle in s;s=s.replace(needle,insert+needle);p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='\n.operation-category-filter{min-width:190px;flex-shrink:0}\n';p.write_text(s,encoding='utf-8')
