from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('staffRights?:Record<string,string[]>}', 'staffRights?:Record<string,string[]>;staffNames?:Record<string,string>}')
s=s.replace("[editingStaff,setEditingStaff]=useState(false)","[editingStaff,setEditingStaff]=useState(false),[staffFullName,setStaffFullName]=useState('')")
s=s.replace("setNewStaffEmail('');setStaffPermissions", "setNewStaffEmail('');setStaffFullName('');setStaffPermissions")
s=s.replace("setNewStaffEmail(name);setStaffPermissions", "setNewStaffEmail(name);setStaffFullName(s.staffNames?.[name]||'');setStaffPermissions")
s=s.replace('<span>{name}</span></button>',"{s.staffNames?.[name]?<><span>{s.staffNames[name]}</span><small>{name}</small></>:<span>{name}</span>}</button>")
s=s.replace("if(!staffPermissions.length||!staffStore", "if(!staffFullName.trim()||!staffPermissions.length||!staffStore")
s=s.replace('staffRights:{...s.staffRights,[email]:staffPermissions}', 'staffRights:{...s.staffRights,[email]:staffPermissions},staffNames:{...s.staffNames,[email]:staffFullName.trim()}')
needle='<Field className="account-dialog-fields"><FieldLabel htmlFor="new-staff-email">'
assert needle in s
s=s.replace(needle,'''<Field className="account-dialog-fields"><FieldLabel htmlFor="staff-full-name">ФИО сотрудника</FieldLabel><Input id="staff-full-name" autoFocus required autoComplete="name" placeholder="Фамилия Имя Отчество" value={staffFullName} onChange={e=>setStaffFullName(e.target.value)}/></Field><Field className="account-dialog-fields"><FieldLabel htmlFor="new-staff-email">''')
s=s.replace('type="email" autoFocus required readOnly={editingStaff}', 'type="email" required readOnly={editingStaff}')
s=s.replace('disabled={!staffPermissions.length||!/', 'disabled={!staffFullName.trim()||!staffPermissions.length||!/')
p.write_text(s,encoding='utf-8')
