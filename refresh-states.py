from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("[query,setQuery]=useState('')","[query,setQuery]=useState(''),[refreshing,setRefreshing]=useState(false)")
a=s.index('<Button variant="outline" onClick={()=>{setUpdated(');b=s.index('</Button>',a)+len('</Button>')
s=s[:a]+'''<Button variant="outline" disabled={refreshing} onClick={async()=>{if(refreshing)return;setRefreshing(true);const target=client;const notification=toast.loading('Данные обновляются');try{await new Promise(resolve=>setTimeout(resolve,800));setUpdated(prev=>({...prev,[target]:new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',second:'2-digit'})}));toast.success('Данные обновлены',{id:notification})}finally{setRefreshing(false)}}}><RefreshCw data-icon="inline-start" className={refreshing?'animate-spin':undefined}/>{refreshing?'Обновление…':'Обновить'}</Button>'''+s[b:]
p.write_text(s,encoding='utf-8')
