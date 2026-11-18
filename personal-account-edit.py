from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s="import { PersonalAccount } from '@/components/personal-account'\n"+s
s=s.replace('<div className="profile"><span className="avatar">А</span><div className="nav-label">Администратор<small>Полный доступ</small></div></div>','<button type="button" className="profile" aria-label="Личный кабинет" title="Личный кабинет" aria-current={tab===\'profile\'?\'page\':undefined} onClick={()=>navigate(\'profile\')}><span className="avatar">А</span><div className="nav-label">Администратор<small>Полный доступ</small></div></button>')
s=s.replace("{tab==='settings'&&", "{tab==='profile'&&<PersonalAccount/>}\n {tab==='settings'&&",1)
p.write_text(s,encoding='utf-8')
