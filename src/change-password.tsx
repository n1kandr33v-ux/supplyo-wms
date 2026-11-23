import {useRef,useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './components/ui/dialog';
export function ChangePassword(){
 const [open,setOpen]=useState(false),[values,setValues]=useState(['','','']),[visible,setVisible]=useState([false,false,false]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
 const locked=useRef(false);
 function close(value:boolean){if(locked.current)return;setOpen(value);setValues(['','','']);setVisible([false,false,false]);setError('')}
 async function save(e:React.FormEvent){
  e.preventDefault();if(locked.current)return;
  if(!values[0]){setError('Введите текущий пароль.');return}
  if(values[1].length<8||values[1].length>128){setError('Новый пароль должен содержать от 8 до 128 символов.');return}
  if(values[1]!==values[2]){setError('Новые пароли не совпадают.');return}
  if(values[0]===values[1]){setError('Новый пароль должен отличаться от текущего.');return}
  locked.current=true;setBusy(true);setError('');
  try{
   const r=await fetch('/api/account/password',{method:'POST',headers:{'Content-Type':'application/json','X-Supplyo-Client':'web'},body:JSON.stringify({currentPassword:values[0],newPassword:values[1]}),signal:AbortSignal.timeout(35000)});
   const data=await r.json();if(!r.ok)throw Error(data.error??'Не удалось изменить пароль.');
   setValues(['','','']);setOpen(false);setSuccess(true);
  }catch(e){setError(e instanceof TypeError?'Нет связи с сервером. Повторите попытку.':(e as Error).message)}finally{locked.current=false;setBusy(false)}
 }
 return <><div className="live-detail"><span>Пароль</span><div><Button variant="outline" onClick={()=>{setSuccess(false);close(true)}}>Изменить пароль</Button>{success&&<p role="status" style={{color:'#80dbaf',marginTop:10,fontSize:13}}>Пароль изменён. Остальные сеансы завершены.</p>}</div></div>
 <Dialog open={open} onOpenChange={close}><DialogContent className="dark"><DialogHeader><DialogTitle>Изменить пароль</DialogTitle><DialogDescription>После сохранения остальные сеансы будут завершены. На этом устройстве вы останетесь в аккаунте.</DialogDescription></DialogHeader>
 <form onSubmit={save} style={{display:'grid',gap:18}}>
 {['Текущий пароль','Новый пароль','Повторите новый пароль'].map((label,i)=><label key={label} style={{display:'grid',gap:8,fontSize:14}} htmlFor={'change-password-'+i}>{label}<div style={{position:'relative'}}><Input id={'change-password-'+i} autoFocus={i===0} autoComplete={i===0?'current-password':'new-password'} type={visible[i]?'text':'password'} maxLength={128} value={values[i]} disabled={busy} style={{paddingRight:44}} onChange={e=>{setValues(previous=>previous.map((v,n)=>n===i?e.target.value:v));setError('')}}/><button type="button" disabled={busy} aria-label={(visible[i]?'Скрыть: ':'Показать: ')+label.toLowerCase()} onClick={()=>setVisible(previous=>previous.map((v,n)=>n===i?!v:v))} style={{position:'absolute',right:12,top:10,color:'#aaa'}}>{visible[i]?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>)}
 {error&&<p role="alert" style={{color:'#ffb4b4',background:'#351c20',border:'1px solid #ba5050',padding:12,borderRadius:8,fontSize:13}}>{error}</p>}
 <div style={{display:'flex',justifyContent:'flex-end',gap:10}}><Button type="button" variant="outline" disabled={busy} onClick={()=>close(false)}>Отмена</Button><Button type="submit" disabled={busy}>{busy?'Сохраняем…':'Сохранить пароль'}</Button></div>
 </form></DialogContent></Dialog></>;
}
