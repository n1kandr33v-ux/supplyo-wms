from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace("<CardFooter className={`justify-between${tab!=='assembly'?' stocks-table-footer':''}`}>",'<CardFooter className="justify-between table-ending">')
needle='</TableBody></Table></CardContent></Card>}'
assert needle in s
s=s.replace(needle,'</TableBody></Table></CardContent><CardFooter className="table-ending"/></Card>}',1)
p.write_text(s,encoding='utf-8')
