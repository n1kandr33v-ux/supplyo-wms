from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('staff:string[]}', 'staff:string[];staffRights?:Record<string,string[]>}')
s=s.replace("[newStaffEmail,setNewStaffEmail]=useState('')", "[newStaffEmail,setNewStaffEmail]=useState(''),[staffPermissions,setStaffPermissions]=useState<string[]>(['view','assembly']),[editingStaff,setEditingStaff]=useState(false)")
s=s.replace("setStaffStore(s);setNewStaffEmail('')", "setStaffStore(s);setNewStaffEmail('');setStaffPermissions(['view','assembly']);setEditingStaff(false)")
s=s.replace('<Badge variant="secondary" key={name}>{name}</Badge>', '''<button type="button" className="staff-access-button" key={name} title="Изменить права сотрудника" onClick={()=>{setStaffStore(s);setNewStaffEmail(name);setStaffPermissions(s.staffRights?.[name]||['view']);setEditingStaff(true)}}><span>{name}</span><small>{s.staffRights?.[name]?.includes('manage')?'Администратор склада':s.staffRights?.[name]?.includes('assembly')?'Сборка':'Просмотр'}</small></button>''')
s=s.replace("if(target.staff.some(value=>value.toLowerCase()===email))", "if(!editingStaff&&target.staff.some(value=>value.toLowerCase()===email))")
s=s.replace("{...s,staff:[...s.staff,email]}","{...s,staff:[...new Set([...s.staff,email])],staffRights:{...s.staffRights,[email]:staffPermissions}}")
s=s.replace("toast.success('Сотрудник добавлен в список склада')","toast.success(editingStaff?'Права сотрудника сохранены':'Сотрудник добавлен в список склада')")
s=s.replace('<DialogTitle>Добавить сотрудника</DialogTitle>',"<DialogTitle>{editingStaff?'Доступ сотрудника':'Добавить сотрудника'}</DialogTitle>")
s=s.replace('id="new-staff-email" type="email" autoFocus required', 'id="new-staff-email" type="email" autoFocus required readOnly={editingStaff}')
needle='</Field><DialogFooter><Button type="button" variant="outline" onClick={()=>setStaffStore(null)}>'
assert needle in s
s=s.replace(needle,'''</Field><Field className="staff-permissions-field"><FieldLabel>Доступ на этом складе</FieldLabel><div className="staff-role-presets">{[['Просмотр',['view']],['Сборщик',['view','assembly']],['Администратор',['view','assembly','supplies','stocks','manage']]].map(([label,rights])=><Button key={String(label)} type="button" variant="outline" onClick={()=>setStaffPermissions(rights as string[])}>{label as string}</Button>)}</div><div className="staff-permissions">{[['view','Просмотр заказов и остатков'],['assembly','Сборка, КИЗ и печать этикеток'],['supplies','Создание поставок и передача в доставку'],['stocks','Изменение остатков, ячеек и адресов'],['manage','Управление складом и сотрудниками']].map(([key,label])=><label key={key}><input type="checkbox" checked={staffPermissions.includes(key)} onChange={e=>setStaffPermissions(prev=>e.target.checked?[...new Set([...prev,key,'view'])]:key==='view'?[]:prev.filter(p=>p!==key))}/><span>{label}</span></label>)}</div></Field><DialogFooter><Button type="button" variant="outline" onClick={()=>setStaffStore(null)}>''',1)
s=s.replace("disabled={!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newStaffEmail.trim())}>Добавить", "disabled={!staffPermissions.length||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newStaffEmail.trim())}>{editingStaff?'Сохранить права':'Добавить'}")
# Guard the submit handler too.
s=s.replace("if(!staffStore||! /^[", "if(!staffPermissions.length||!staffStore||! /^[")
p.write_text(s,encoding='utf-8')
