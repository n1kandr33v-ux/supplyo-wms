from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace("useState<Record<number,string>>({})","useState<Record<number,string>>(()=>{try{return JSON.parse(localStorage.getItem('wms-last-updated')||'{}')}catch{return {}}})")
s=s.replace('export default function App(){','export default function App(){')
needle=" const scannerRef="
# Persist alongside existing effects without relying on ref formatting.
pos=s.index(' useEffect(')
s=s[:pos]+" useEffect(()=>{localStorage.setItem('wms-last-updated',JSON.stringify(updated))},[updated])\n"+s[pos:]
s=s.replace("new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',second:'2-digit'})","new Date().toISOString()")
s=s.replace('`Обновлено ${updated[client]} МСК`',"`Обновлено ${new Date(updated[client]).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})} МСК`")
p.write_text(s,encoding='utf-8')
