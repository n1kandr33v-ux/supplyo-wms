from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace("import { Badge } from '@/components/ui/badge'\n",'')
s=s.replace('<Card key={s.id}><CardHeader><CardTitle>{s.name}</CardTitle>', '<Card key={s.id} className="warehouse-account-card"><CardHeader><CardTitle>{s.name}</CardTitle><Button type="button" className="warehouse-delete-action" size="icon" variant="ghost" aria-label={`Удалить склад ${s.name}`} title="Удалить склад" onClick={()=>setRemove(s)}><Trash2 size={16}/></Button>')
a=s.index('<CardFooter className="account-actions"><Button variant="ghost" aria-label={`Удалить склад');b=s.index('</CardFooter>',a)+len('</CardFooter>');s=s[:a]+s[b:];p.write_text(s,encoding='utf-8')
