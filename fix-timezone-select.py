from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace("useState(()=>read('supplyo-profile',emptyProfile))","useState(()=>{const value=read('supplyo-profile',emptyProfile);return {...value,timezone:value.timezone||'Europe/Moscow'}})")
s=s.replace('value={profileDraft.timezone}',"value={profileDraft.timezone||'Europe/Moscow'}")
s=s.replace('<SelectTrigger aria-label="Часовой пояс"><SelectValue/></SelectTrigger>', '<SelectTrigger className="account-timezone-select" aria-label="Часовой пояс"><SelectValue placeholder="Москва · UTC+3"/></SelectTrigger>')
p.write_text(s,encoding='utf-8')
