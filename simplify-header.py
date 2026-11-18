from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
s=s.replace(',[help,setHelp]=useState(false)','').replace(",[dark,setDark]=useState(localStorage.getItem('wms-theme')!=='light')",'')
s=s.replace("useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('wms-theme',dark?'dark':'light')},[dark])","useEffect(()=>{document.documentElement.classList.add('dark')},[])")
s=s.replace('<Button variant="ghost" className="help-control" title="Как проверить интерфейс" onClick={()=>setHelp(true)}><Package/><span className="nav-label">Как проверить интерфейс</span></Button>','<Button variant={tab===\'settings\'?\'default\':\'ghost\'} className="help-control" title="Настройки" aria-label="Настройки" onClick={()=>navigate(\'settings\')}><Settings2/><span className="nav-label">Настройки</span></Button>')
a=s.index('<div className="flex items-center gap-3"><span className="connection">');b=s.index('</header>',a);s=s[:a]+s[b:]
a=s.index(' <Dialog open={help}');b=s.index('<Toaster position=',a);s=s[:a]+s[b:]
p.write_text(s,encoding='utf-8')
