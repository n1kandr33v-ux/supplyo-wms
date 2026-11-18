from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
a=s.index('<Button className="collapse-control"');b=s.index('</Button>',a)+len('</Button>')
s=s[:a]+s[b:]
s=s.replace('<header className="topbar"><span>','<header className="topbar"><Button className="sidebar-toggle" variant="ghost" size="icon" title={collapsed?"Развернуть боковую панель":"Свернуть боковую панель"} aria-label={collapsed?"Развернуть панель":"Свернуть панель"} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</Button><span>')
p.write_text(s,encoding='utf-8')
