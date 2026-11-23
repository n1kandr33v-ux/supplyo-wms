import {useEffect,useRef,useState} from 'react';
export class AuthError extends Error {
 status:number;retryAfter:number;code:string;
 constructor(message:string,status:number,retryAfter=0,code=''){super(message);this.status=status;this.retryAfter=retryAfter;this.code=code}
}
export async function authRequest(path:string,body:unknown){
 let r:Response;
 try{r=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Supplyo-Client':'web'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)})}
 catch{throw new AuthError('Нет связи с сервером. Проверьте подключение и повторите попытку.',0)}
 const d=await r.json().catch(()=>({error:'Сервер временно недоступен. Повторите попытку.'}));
 if(!r.ok)throw new AuthError(d.error??'Не удалось выполнить запрос',r.status,Number(d.retryAfter??r.headers.get('Retry-After')??0),d.code??'');
 return d;
}
export function AuthCode({request,initial,onDone,onBack}:{request:Record<string,unknown>;initial?:{id:string;retryAfter?:number};onDone:()=>Promise<void>;onBack:()=>void}){
 const [id,setId]=useState(initial?.id??'');
 const [digits,setDigits]=useState<string[]>(Array(6).fill(''));
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState('');
 const [busy,setBusy]=useState(false),[verified,setVerified]=useState(false),[error,setError]=useState('');
 const [wait,setWait]=useState(initial?.retryAfter??(initial?60:0));
 const [retry,setRetry]=useState(false);
 const refs=useRef<(HTMLInputElement|null)[]>([]),locked=useRef(false),attempted=useRef('');
 const reset=request.purpose==='reset',code=digits.join(''),complete=digits.every(d=>/^\d$/.test(d));
 useEffect(()=>{if(!wait)return;const t=setTimeout(()=>setWait(v=>Math.max(0,v-1)),1000);return()=>clearTimeout(t)},[wait]);
 async function finish(){try{await onDone()}catch{setError('Почта подтверждена, но рабочее пространство не загрузилось. Повторите вход.')}}
 async function send(){
  if(locked.current||wait)return;locked.current=true;setBusy(true);setError('');
  try{const d=await authRequest('code/request',request);setId(d.id);setDigits(Array(6).fill(''));attempted.current='';setRetry(false);setWait(d.retryAfter);refs.current[0]?.focus()}
  catch(e){const failure=e as AuthError;setError(failure.message);if(failure.retryAfter)setWait(failure.retryAfter)}
  finally{locked.current=false;setBusy(false)}
 }
 async function verify(e?:React.FormEvent){
  e?.preventDefault();if(locked.current||!complete||!id||verified)return;
  if(reset&&(password.length<8||password.length>128||password!==repeat)){setError('Пароли должны совпадать и содержать от 8 до 128 символов.');return}
  locked.current=true;setBusy(true);setError('');setRetry(false);attempted.current=id+code;
  try{await authRequest('code/verify',{id,code,password:reset?password:undefined});setVerified(true);await finish()}
  catch(e){const failure=e as AuthError;setError(failure.message);setRetry(failure.status===0||failure.status>=500)}
  finally{locked.current=false;setBusy(false)}
 }
 useEffect(()=>{if(!complete){attempted.current='';return}if(reset||!id||busy||verified||attempted.current===id+code)return;void verify()},[code,id,busy,reset,complete,verified]);
 function edit(index:number,value:string){
  const incoming=value.replace(/\D/g,'');setError('');setRetry(false);
  setDigits(previous=>{const next=[...previous];if(incoming.length>1){const start=incoming.length>=6?0:index;incoming.slice(0,6-start).split('').forEach((d,n)=>next[start+n]=d)}else next[index]=incoming;return next});
  if(incoming)refs.current[Math.min(incoming.length>=6?5:index+incoming.length,5)]?.focus();
 }
 return <section className="auth-panel">
  <h2>{reset?'Восстановление пароля':'Подтвердите почту'}</h2>
  <p className="auth-subtitle">{id?'Введите код из последнего письма. Он действует 10 минут.':'Отправим код для восстановления доступа, если аккаунт существует.'}<br/>{String(request.email)}</p>
  {id&&!verified&&<form onSubmit={verify}>
   <div className="auth-code-digits">{digits.map((digit,i)=><input key={i} ref={el=>{refs.current[i]=el}} aria-label={'Цифра '+(i+1)} inputMode="numeric" autoComplete={i===0?'one-time-code':'off'} value={digit} disabled={busy} onFocus={e=>e.target.select()}
    onPaste={e=>{const value=e.clipboardData.getData('text').replace(/\D/g,'');if(value){e.preventDefault();edit(i,value)}}}
    onChange={e=>edit(i,e.target.value)} onKeyDown={e=>{if(e.key==='Backspace'&&!digits[i]){e.preventDefault();refs.current[Math.max(0,i-1)]?.focus()}if(e.key==='ArrowLeft')refs.current[Math.max(0,i-1)]?.focus();if(e.key==='ArrowRight')refs.current[Math.min(5,i+1)]?.focus()}}/>)}</div>
   {reset&&<><label className="auth-code-label">Новый пароль<input className="auth-code-password" type="password" autoComplete="new-password" maxLength={128} disabled={busy} value={password} onChange={e=>{setPassword(e.target.value);setError('')}}/></label><label className="auth-code-label">Повторите пароль<input className="auth-code-password" type="password" autoComplete="new-password" maxLength={128} disabled={busy} value={repeat} onChange={e=>{setRepeat(e.target.value);setError('')}}/></label></>}
   {reset&&<button className="auth-submit auth-code-action" disabled={busy||!complete} type="submit">{busy?'Сохраняем…':'Сохранить пароль'}</button>}
   {!reset&&busy&&<p role="status">Проверяем код…</p>}
  </form>}
  {error&&<p role="alert" className="auth-message">{error}</p>}
  {verified?<a className="auth-code-link" href="#login">Перейти ко входу</a>:<>
   {retry&&<button className="auth-code-link" type="button" disabled={busy} onClick={()=>void verify()}>Повторить проверку</button>}
   <button className="auth-code-link" type="button" disabled={busy||wait>0} onClick={send}>{wait?`Повторная отправка через ${wait} с`:id?'Отправить код повторно':'Получить код'}</button>
   <button className="auth-code-link" type="button" onClick={onBack} disabled={busy}>{reset?'Назад ко входу':'Изменить данные'}</button>
  </>}
 </section>
}
