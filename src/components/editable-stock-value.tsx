import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
export function EditableStockValue({value,label,numeric=false,onSave}:{value:string;label:string;numeric?:boolean;onSave:(value:string)=>void}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value),[error,setError]=useState(''),cancelled=useRef(false),input=useRef<HTMLInputElement>(null)
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select()}},[editing])
 function save(){if(cancelled.current)return;const next=draft.trim();if(numeric?(!/^\d+$/.test(next)||!Number.isSafeInteger(Number(next))):!next){setError(numeric?'Введите целое число от 0':'Заполните поле');return}if(next!==value)onSave(next);setEditing(false);setError('')}
 return <div className={numeric?"stock-quantity-value":"stock-text-value"}>{editing?<div className="inline-stock-editor"><Input ref={input} aria-label={label} aria-invalid={!!error} type="text" inputMode={numeric?'numeric':'text'} value={draft} onChange={e=>{setDraft(e.target.value);setError('')}} onBlur={save} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save()}if(e.key==='Escape'){cancelled.current=true;setEditing(false);setError('')}}}/>{error&&<small role="alert">{error}</small>}</div>:<button type="button" className="editable-stock-value" aria-label={`Изменить: ${label}`} title="Нажмите для редактирования" onClick={()=>{cancelled.current=false;setDraft(value);setEditing(true)}}>{value||'—'}</button>}{numeric&&<span className="stock-unit">шт.</span>}</div>
}
