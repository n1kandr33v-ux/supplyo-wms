from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace('Plus, Pencil, Trash2','Plus, Pencil, Trash2, X');old='onClick={()=>setRemove(s)}><Trash2 size={16}/>';assert old in s;s=s.replace(old,'onClick={()=>setRemove(s)}><X size={16}/>');p.write_text(s,encoding='utf-8')
