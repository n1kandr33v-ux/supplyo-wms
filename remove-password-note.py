from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace('<small>Смена пароля станет доступна после подключения сервера авторизации.</small>','');p.write_text(s,encoding='utf-8')
