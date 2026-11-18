from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');needle='</div></CardContent></Card>)}</div>';assert needle in s;s=s.replace(needle,'</div></CardContent><CardFooter className="table-ending"/></Card>)}</div>',1);p.write_text(s,encoding='utf-8')
