from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace("[query,setQuery]=useState('')","[query,setQuery]=useState(''),[searchFocused,setSearchFocused]=useState(false)")
pos=s.index(' const scannerRef=useRef')
s=s[:pos]+''' const searchRef=useRef<HTMLInputElement>(null)
 useEffect(()=>{
  if(!searchFocused||query.trim())return
  const timer=setTimeout(()=>{if(document.activeElement===searchRef.current&&!searchRef.current?.value.trim()){searchRef.current?.blur();if(tab==='assembly'&&!actionItem&&!edit)scannerRef.current?.focus()}},3000)
  return()=>clearTimeout(timer)
 },[searchFocused,query,tab,actionItem,edit])
'''+s[pos:]
s=s.replace('<Input aria-label="Поиск товара"', '<Input ref={searchRef} onFocus={()=>setSearchFocused(true)} onBlur={()=>setSearchFocused(false)} aria-label="Поиск товара"')
p.write_text(s,encoding='utf-8')
