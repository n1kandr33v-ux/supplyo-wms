import {useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from './components/ui/dialog';
import {toast} from 'sonner';
async function api(path:string,body?:unknown,signal?:AbortSignal){const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Supplyo-Client':'web'},body:body===undefined?undefined:JSON.stringify(body),signal});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось подготовить печать');return d;}
export function OzonPrintButton({storeId,posting,disabled=false,printed=false,onPrinted,autoStart=false}:{storeId:string;posting:string;disabled?:boolean;printed?:boolean;onPrinted?:()=>void;autoStart?:boolean}){
 const [done,setDone]=useState(printed),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState('');
 const autoStarted=useRef(false);
 const operation=useRef<{id:string;reprint:boolean}|null>(null),controller=useRef<AbortController|null>(null),alive=useRef(true),locked=useRef(false);
 useEffect(()=>{setDone(printed);},[printed]);useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function print(reprint=false){if(locked.current||disabled)return;locked.current=true;setBusy(true);setError('');setConfirm(false);controller.current=new AbortController();const signal=controller.current.signal;
 try{
  let health:any;try{const r=await fetch('http://127.0.0.1:17891/health',{signal:AbortSignal.timeout(10000)});health=await r.json();if(!r.ok||!health.ok)throw Error();}catch{throw Error('Нет связи с печатным агентом. Откройте агент supply и проверьте подключение в настройках печати.');}
  if(!health.mediaSizes||!health.deviceId)throw Error('Для этикеток Ozon обновите агент: закройте старый через значок в трее, скачайте новый и откройте его.');
  const printer=localStorage.getItem('supplyo-printer')||health.defaultPrinter||health.printer;if(!printer)throw Error('Выберите принтер в настройках печати.');
  if(health.printers&&!health.printers.some((p:any)=>p.name===printer))throw Error('Выбранный принтер не найден. Выберите принтер в настройках печати.');
  if(!operation.current||operation.current.reprint!==reprint)operation.current={id:crypto.randomUUID(),reprint};
  const base='/stores/'+storeId+'/ozon/labels',prepared=await api(base+'/prepare',{posting,requestId:operation.current.id,deviceId:health.deviceId,printer,reprint},signal);
  if(prepared.alreadyPrinted){setDone(true);operation.current=null;toast.success('Этикетка уже напечатана');onPrinted?.();return;}
  const start=Date.now();let job:any;
  for(;;){if(!alive.current||signal.aborted)return;job=await api(base+'/'+prepared.jobId+'?deviceId='+encodeURIComponent(health.deviceId),undefined,signal);if(job.completed){setDone(true);operation.current=null;onPrinted?.();return;}if(job.state==='error')throw Error(job.error||'Ozon не сформировал этикетку');if(job.state==='ready')break;if(Date.now()-start>180000)throw Error('Этикетка ещё формируется в Ozon. Повторите печать чуть позже — задание сохранено.');await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2000);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});}
  if(!alive.current||signal.aborted)return;
  // Immutable body and stable job/device identity make an uncertain acknowledgement retry safe.
  const r=await fetch('http://127.0.0.1:17891/print-batch',{method:'POST',headers:{'Content-Type':'application/json','X-WMS-Print-Agent':'Supplyo'},body:JSON.stringify({job_id:job.jobId,device_id:health.deviceId,stickers:job.stickers,printer:job.printer}),signal:AbortSignal.timeout(300000)}),receipt=await r.json();if(!r.ok||!receipt.ok)throw Error(receipt.error||'Агент не подтвердил печать.');
  await api(base+'/'+job.jobId+'/printed',{deviceId:health.deviceId},signal);if(alive.current){setDone(true);operation.current=null;toast.success('Этикетка передана на принтер');onPrinted?.();}
 }catch(e){if(alive.current&&!signal.aborted){setError((e as Error).message);toast.error((e as Error).message);}}
 finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 useEffect(()=>{if(autoStart&&!disabled&&!done&&!autoStarted.current){autoStarted.current=true;void print();}},[autoStart,disabled,done]);
 return <><Button variant="secondary" disabled={disabled||busy} onClick={()=>done?setConfirm(true):void print()}>{busy?'Готовим и печатаем…':done?'Повторить печать':'Печать'}</Button>
 <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Повторить печать этикетки?</DialogTitle></DialogHeader><p>Отправление {posting}. Будет напечатан ещё один экземпляр этикетки.</p><DialogFooter><Button variant="secondary" onClick={()=>setConfirm(false)}>Отмена</Button><Button onClick={()=>void print(true)}>Напечатать повторно</Button></DialogFooter></DialogContent></Dialog>
 {error&&<Dialog open={!!error} onOpenChange={open=>{if(!open)setError('');}}><DialogContent><DialogHeader><DialogTitle>Печать этикетки</DialogTitle></DialogHeader><p role="alert">{error}</p>{(error.includes('обновите агент')||error.startsWith('Нет связи с печатным агентом'))&&<a className="live-supply-link" href="/downloads/supply-print-agent.exe" download>Скачать агент</a>}<DialogFooter><Button variant="secondary" onClick={()=>setError('')}>Закрыть</Button></DialogFooter></DialogContent></Dialog>}</>;
}
