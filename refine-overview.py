from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
a=s.index('<div className="workspace">');b=s.index('<nav className="section-nav"',a);s=s[:a]+s[b:]
a=s.index('<div className="page-heading">');b=s.index('<div className="cabinet-picker">',a);s=s[:a]+s[b:]
s=s.replace("[collapsed,setCollapsed]=useState", "[updated,setUpdated]=useState<Record<number,string>>({}),[collapsed,setCollapsed]=useState")
s=s.replace("{warehouse!=='Все склады'&&<Badge variant=\"secondary\">{warehouse}</Badge>}</div>","{warehouse!=='Все склады'&&<Badge variant=\"secondary\">{warehouse}</Badge>}<div className=\"cabinet-refresh\"><span className=\"last-updated\">{updated[client]?`Обновлено ${updated[client]} МСК`:'Ещё не обновлялось'}</span><Button variant=\"outline\" onClick={()=>{setUpdated(prev=>({...prev,[client]:new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',second:'2-digit'})}));toast.success('Тестовые данные актуальны')}}><RefreshCw data-icon=\"inline-start\"/>Обновить</Button></div></div>")
a=s.index('<CardFooter className="gap-2"><Button variant="outline" onClick={()=>{setWarehouse(city)');b=s.index('</CardFooter>',a)+len('</CardFooter>');s=s[:a]+s[b:]
a=s.index(' <footer className="page-footer">');b=s.index('</footer>',a)+len('</footer>');s=s[:a]+s[b:]
p.write_text(s,encoding='utf-8')
