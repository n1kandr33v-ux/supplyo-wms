from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');a='<main><div className="cabinet-picker">';assert a in s;s=s.replace(a,'<main>{tab!==\'profile\'&&<div className="cabinet-picker">',1);b="</Button></div></div>\n";assert b in s;s=s.replace(b,'</Button></div></div>}\n',1);p.write_text(s,encoding='utf-8')
