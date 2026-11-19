import {useEffect,useRef,useState} from 'react';import {Button} from './components/ui/button';import {OzonPrintButton} from './ozon-print';
export function OzonAutoAssembly({storeId,warehouse,paused,onChanged}:{storeId:string;warehouse:string;paused:boolean;onChanged:()=>void}){
 const [printing,setPrinting]=useState<string|null>(null),[error,setError]=useState(''),[working,setWorking]=useState('');
 const busy=useRef(false),blocked=useRef(new Set<string>()),state=useRef({paused,printing,onChanged});state.current={paused,printing,onChanged};
 useEffect(()=>{let live=true;setPrinting(null);setError('');blocked.current.clear();const base='/api/stores/'+encodeURIComponent(storeId)+'/ozon/assembly';
 async function read(path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Supplyo-Client':'web'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось завершить сборку Ozon');return d}
 async function run(){if(!live||busy.current||state.current.paused||document.hidden)return;busy.current=true;let number='';try{
 const d=await read('/auto-candidates?'+new URLSearchParams({warehouse}));if(!live)return;
 const rows=(d.rows||[]).filter((r:any)=>!blocked.current.has(r.posting_number));
 // Finish ready postings even while a different label is being prepared/printed.
 // Each posting retains its own immutable print job and acknowledgement.
 for(const row of rows.filter((r:any)=>r.status==='awaiting_packaging'&&r.finish!=='checking'&&r.finish!=='done'&&r.quantity>0&&r.quantity===r.ready).slice(0,10)){
  if(!live||state.current.paused)break;number=row.posting_number;
  try{setWorking('Передаём сборку '+number+' в Ozon…');await read('/finish',{posting:number});if(live)state.current.onChanged();}catch(e){blocked.current.add(number);if(live)setError(number+': '+(e as Error).message);}
 }
 if(!state.current.printing){const printable=rows.find((r:any)=>r.status==='awaiting_deliver'||r.finish==='done');if(printable){setPrinting(printable.posting_number);state.current.printing=printable.posting_number;}}
 if(live){const waiting=rows.filter((r:any)=>r.finish==='checking').length;setWorking(waiting?'Ozon подтверждает отправлений: '+waiting+'. Печать продолжится автоматически.':'');}
 }catch(e){if(live){setError((e as Error).message);setWorking('');}}finally{busy.current=false}}

 void run();const timer=setInterval(()=>void run(),2000);return()=>{live=false;clearInterval(timer)};
 },[storeId,warehouse]);
 return <div className="ozon-auto-assembly"><p>После сканирования товаров и проверки КИЗ готовые отправления передаются в Ozon. Этикетки печатаются автоматически по мере готовности.</p>{working&&<p role="status">{working}</p>}{error&&<div role="alert">{error} <Button variant="secondary" onClick={()=>{blocked.current.clear();setError('')}}>Повторить</Button></div>}{printing&&<div className="fulfillment-toolbar"><span>Этикетка {printing}</span><OzonPrintButton key={storeId+printing} storeId={storeId} posting={printing} autoStart onPrinted={()=>{setPrinting(null);state.current.printing=null;state.current.onChanged()}}/></div>}</div>
}
