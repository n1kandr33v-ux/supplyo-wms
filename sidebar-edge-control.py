from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig').replace('Check, PanelLeftClose, PanelLeftOpen','Check, ChevronLeft')
a=s.index('<Button className="sidebar-toggle"');b=s.index('</Button>',a)+len('</Button>');s=s[:a]+s[b:]
s=s.replace('</aside>','</aside><Button className="sidebar-edge-toggle" variant="outline" size="icon" title={collapsed?"Развернуть меню":"Свернуть меню"} aria-label={collapsed?"Развернуть меню":"Свернуть меню"} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight/>:<ChevronLeft/>}</Button>',1)
p.write_text(s,encoding='utf-8')
