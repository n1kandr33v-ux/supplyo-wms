from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');pos=s.index(' function scanProduct()')
s=s[:pos]+''' useEffect(()=>{
  if(tab!=='assembly'||actionItem||edit)return
  const isEditing=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"]')
  const handleKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||isEditing(event.target))return
   if(event.key.length===1){event.preventDefault();setScan(prev=>prev+event.key);scannerRef.current?.focus()}
   else if(event.key==='Enter'&&scan.trim()){event.preventDefault();scanProduct()}
   else if(event.key==='Backspace'&&scan){event.preventDefault();setScan(prev=>prev.slice(0,-1));scannerRef.current?.focus()}
  }
  const handlePaste=(event:ClipboardEvent)=>{if(isEditing(event.target))return;const value=event.clipboardData?.getData('text');if(value){event.preventDefault();setScan(prev=>prev+value.replace(/[\\r\\n]/g,''));scannerRef.current?.focus()}}
  document.addEventListener('keydown',handleKey);document.addEventListener('paste',handlePaste)
  return()=>{document.removeEventListener('keydown',handleKey);document.removeEventListener('paste',handlePaste)}
 })
'''+s[pos:];p.write_text(s,encoding='utf-8')
