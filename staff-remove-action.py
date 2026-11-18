from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace('aria-label={`Удалить сотрудника ${s.staffNames?.[name]||name}`}','title="Удалить сотрудника" className="staff-remove-action" aria-label={`Удалить сотрудника ${s.staffNames?.[name]||name}`}');p.write_text(s,encoding='utf-8')
