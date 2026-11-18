from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('type Entry={','type Entry={category?:string;')
pos=s.index('const money=');s=s[:pos]+'''const operationCategories=['Оплата материалов','Зарплата','Аренда','Услуги фулфилмента','Хранение','Доставка','Оборудование','Коммунальные услуги','Другое']
function operationCategory(entry:Entry):string{if(entry.category)return entry.category;if(entry.kind==='work'||entry.id.startsWith('salary-'))return 'Зарплата';const title=entry.title.toLowerCase();if(title.includes('аренд'))return 'Аренда';if(title.includes('хранени'))return 'Хранение';if(title.includes('короба и упаковочные')||title.includes('материал'))return 'Оплата материалов';if(title.includes('доставк'))return 'Доставка';if(title.includes('оборудован'))return 'Оборудование';if(title.includes('сборка')||title.includes('фулфилмент')||title.includes('упаковка'))return 'Услуги фулфилмента';return 'Другое'}
'''+s[pos:]
s=s.replace("kind,date:today()", "kind,category:kind==='work'?'Зарплата':'Другое',date:today()")
# examples should infer categories rather than inherit default Other
s=s.replace("kind,date,title,person,amount,...extra", "kind,category:undefined,date,title,person,amount,...extra")
s=s.replace('function newEntry(', 'function newEntry(')
s=s.replace("const next={...draft,id:","const next={...draft,category:draft.kind==='work'?'Зарплата':operationCategory(draft),id:")
s=s.replace("kind:'expense' as const,date:today()", "kind:'expense' as const,category:'Зарплата',date:today()")
s=s.replace("kind:'expense',date:today()", "kind:'expense',category:'Зарплата',date:today()")
s=s.replace("${r.title} ${r.person} ${r.number}", "${r.title} ${r.person} ${r.number} ${operationCategory(r)}")
s=s.replace("'Сумма',tab==='money'?'Тип':'Оплата'", "'Сумма',...(tab==='money'?['Вид операции']:[]),tab==='money'?'Тип':'Оплата'")
s=s.replace('<td>{money(r.amount)}</td><td>',"<td>{money(r.amount)}</td>{tab==='money'&&<td>{operationCategory(r)}</td>}<td>")
needle="{draft.kind==='invoice'&&<Field><FieldLabel htmlFor=\"entry-number\">"
insert='''{(draft.kind==='income'||draft.kind==='expense')&&<Field><FieldLabel htmlFor="entry-category">Вид операции</FieldLabel><Select value={operationCategory(draft)} onValueChange={category=>setDraft({...draft,category})}><SelectTrigger id="entry-category" className="w-full"><SelectValue/></SelectTrigger><SelectContent>{operationCategories.map(category=><SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></Field>}'''
assert needle in s;s=s.replace(needle,insert+needle)
# Edit legacy entries with inferred category filled.
s=s.replace('onClick={()=>setDraft(r)}', 'onClick={()=>setDraft({...r,category:operationCategory(r)})}')
p.write_text(s,encoding='utf-8')
