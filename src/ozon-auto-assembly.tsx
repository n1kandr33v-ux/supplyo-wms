import {useEffect,useRef,useState} from 'react';import {Button} from './components/ui/button';import {OzonPrintButton} from './ozon-print';
export function OzonAutoAssembly({storeId,warehouse,paused,onChanged}:{storeId:string;warehouse:string;paused:boolean;onChanged:()=>void}){
 const [printing,setPrinting]=useState<string[]>([]),[error,setError]=useState(''),[working,setWorking]=useState('');
 const busy=useRef(false),completed=useRef(new Set<string>()),blocked=useRef(new Set<string>()),state=useRef({paused,printing,onChanged});state.current={paused,printing,onChanged};
 useEffect(()=>{let live=true;setPrinting([]);state.current.printing=[];setError('');blocked.current.clear();completed.current.clear();const base='/api/stores/'+encodeURIComponent(storeId)+'/ozon/assembly';
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
 const printable=rows.filter((r:any)=>(r.status==='awaiting_deliver'||r.finish==='done')&&!completed.current.has(r.posting_number)&&!state.current.printing.includes(r.posting_number)).slice(0,Math.max(0,4-state.current.printing.length)).map((r:any)=>r.posting_number);
 if(printable.length){const next=[...state.current.printing,...printable];state.current.printing=next;setPrinting(next);}

 if(live){const waiting=rows.filter((r:any)=>r.finish==='checking').length;setWorking(waiting?'Ozon подтверждает отправлений: '+waiting+'. Печать продолжится автоматически.':'');}
 }catch(e){if(live){setError((e as Error).message);setWorking('');}}finally{busy.current=false}}

 void run();const timer=setInterval(()=>void run(),2000);return()=>{live=false;clearInterval(timer)};
 },[storeId,warehouse]);
 return <div className="ozon-auto-assembly"><p>После сканирования товаров и проверки КИЗ готовые отправления передаются в Ozon. Этикетки печатаются автоматически по мере готовности.</p>{working&&<p role="status">{working}</p>}{error&&<div role="alert">{error} <Button variant="secondary" onClick={()=>{blocked.current.clear();setError('')}}>Повторить</Button></div>}{printing.map(number=><div className="fulfillment-toolbar" key={storeId+number}><span>Этикетка {number}</span><OzonPrintButton storeId={storeId} posting={number} autoStart onPrinted={()=>{completed.current.add(number);state.current.printing=state.current.printing.filter(n=>n!==number);setPrinting(state.current.printing);state.current.onChanged()}} onError={message=>{blocked.current.add(number);setError(number+': '+message);state.current.printing=state.current.printing.filter(n=>n!==number);setPrinting(state.current.printing)}}/></div>)}</div>
}
