import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, UserRoundPlus, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./components/ui/dialog";
import "./live-access.css";

async function api(path: string, body?: unknown) {
  const response=await fetch("/api"+path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json","X-Supplyo-Client":"web"},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if (!response.ok) throw Error(result.error || "Не удалось выполнить действие.");
  return result;
}
type Store={id:string;name:string;status:string;delegated?:boolean};
type Connection={id:string;name:string;warehouse_name:string;expires?:number;accepted?:number;revoked?:number;fulfillment_name?:string};
export function AccessSettings({mode,stores,onStoresChanged,onOpen}:{mode:"access"|"clients";stores:Store[];onStoresChanged:()=>Promise<void>;onOpen:(id:string)=>void}) {
  const [store,setStore]=useState(""),[warehouse,setWarehouse]=useState(""),[warehouses,setWarehouses]=useState<{id:string;name:string}[]>([]);
  const [connections,setConnections]=useState<Connection[]>([]),[loading,setLoading]=useState(true),[warehouseLoading,setWarehouseLoading]=useState(false),[busy,setBusy]=useState(false);
  const [code,setCode]=useState(""),[generated,setGenerated]=useState<{code:string;expires:number}|null>(null),[copied,setCopied]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[revoke,setRevoke]=useState<Connection|null>(null);
  const own=stores.filter(s=>!s.delegated);
  const reload=useCallback(async()=>{const data=await api("/access/"+(mode==="access"?"outgoing":"incoming"));setConnections(data.grants??data.clients)},[mode]);
  useEffect(()=>{let active=true;setLoading(true);setError("");void reload().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});const timer=setInterval(()=>{if(!document.hidden)void reload().catch(()=>{})},10000);return()=>{active=false;clearInterval(timer)}},[reload]);
  useEffect(()=>{if(!own.some(s=>s.id===store))setStore(own[0]?.id??"")},[stores,store]);
  useEffect(()=>{
    let active=true;setWarehouses([]);setWarehouse("");setGenerated(null);setCopied(false);
    if (!store || mode!=="access") return;
    setWarehouseLoading(true);
    void api("/stores/"+store+"/warehouses").then(data=>{if(active){setWarehouses(data.warehouses);setWarehouse(data.warehouses[0]?.id??"")}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setWarehouseLoading(false)});
    return()=>{active=false};
  },[store,mode]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);setError("");setNotice("");setCopied(false);
    try {
      if(mode==="access") {const result=await api("/access/codes",{storeId:store,warehouseId:warehouse});setGenerated(result);setNotice("Код создан. Передайте его фулфилменту.")}
      else {await api("/access/redeem",{code});setCode("");await onStoresChanged();setNotice("Клиент подключён. Открыт доступ только к выданному складу.")}
      await reload();
    } catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="access-settings">
    <h1>{mode==="access"?"Доступ фулфилменту":"Клиенты"}</h1>
    <p className="live-subtitle">{mode==="access"?"Выберите кабинет и склад, к которому хотите предоставить доступ.":"Подключайте кабинеты клиентов по одноразовому коду. API-ключ остаётся у владельца магазина."}</p>
    <section className="live-card access-create">
      <h2>{mode==="access"?<><KeyRound size={20}/>Новый доступ</>:<><UserRoundPlus size={20}/>Подключение клиента</>}</h2>
      <form onSubmit={submit}>
        {mode==="access"?<div className="access-fields">
          <label htmlFor="share-store">Кабинет<select id="share-store" value={store} disabled={busy||!own.length} onChange={e=>{setStore(e.target.value);setError("")}}>{!own.length&&<option value="">Сначала подключите магазин</option>}{own.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
          <label htmlFor="share-warehouse">Склад<select id="share-warehouse" value={warehouse} disabled={busy||warehouseLoading||!warehouses.length} onChange={e=>{setWarehouse(e.target.value);setGenerated(null)}}>{!warehouses.length&&<option value="">{warehouseLoading?"Загружаем склады…":"Нет доступных складов"}</option>}{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <Button disabled={busy||!store||!warehouse||warehouseLoading} type="submit"><KeyRound size={16}/>{busy?"Создаём…":"Создать код"}</Button>
        </div>:<div className="access-fields access-redeem"><label htmlFor="client-access-code">Одноразовый код клиента<Input id="client-access-code" value={code} onChange={e=>setCode(e.target.value)} placeholder="FF-…" autoComplete="off" spellCheck={false} maxLength={100} required/></label><Button disabled={busy||!code.trim()} type="submit"><Plus size={16}/>{busy?"Подключаем…":"Подключить клиента"}</Button></div>}
      </form>
      {generated&&<div className="access-generated"><div><small>Код для фулфилмента</small><code>{generated.code}</code><small>Один раз · действует до {new Date(generated.expires).toLocaleString("ru-RU")}</small></div><Button type="button" variant="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(generated.code);setCopied(true)}catch{setError("Не удалось скопировать. Выделите и скопируйте код вручную.")}}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?"Скопировано":"Копировать"}</Button></div>}
      {mode==="access"&&<p className="access-hint">Доступ можно отозвать в любой момент.</p>}
      {error&&<p className="access-error" role="alert">{error}</p>}
      {notice&&<p className="access-notice" role="status">{notice}</p>}
    </section>
    <section className="live-card access-list"><h2>{mode==="access"?"Выданные доступы":"Подключённые клиенты"}</h2>
      {loading?<p role="status">Загружаем…</p>:connections.length===0?<p className="access-hint">{mode==="access"?"Вы ещё не выдавали доступ к своим магазинам.":"Пока нет подключённых клиентов. Попросите владельца магазина создать код доступа."}</p>:connections.map(connection=>{
        const state=connection.revoked?"Доступ отозван":connection.accepted?"Подключён":Number(connection.expires)<=Date.now()?"Код истёк":"Код ещё не использован";
        const canRevoke=!connection.revoked&&(!!connection.accepted||Number(connection.expires)>Date.now());
        return <div className="access-connection" key={connection.id}><div className="access-connection-info"><strong>{connection.name}</strong><span>{connection.warehouse_name}{mode==="access"&&connection.fulfillment_name?" · "+connection.fulfillment_name:""}</span><small>{mode==="access"?state:"Доступ к одному складу"}</small></div><div className="access-connection-actions">{mode==="clients"&&<Button variant="secondary" onClick={()=>onOpen(connection.id)}>Открыть заказы</Button>}{(mode==="clients"||canRevoke)&&<Button variant="ghost" aria-label={mode==="access"?"Отозвать доступ к "+connection.name:"Отключить клиента "+connection.name} onClick={()=>setRevoke(connection)}><X size={16}/>{mode==="access"?"Отозвать":"Отключить"}</Button>}</div></div>;
      })}
    </section>
    <Dialog open={!!revoke} onOpenChange={open=>{if(!open&&!busy)setRevoke(null)}}><DialogContent><DialogHeader><DialogTitle>{mode==="access"?"Отозвать доступ?":"Отключить клиента?"}</DialogTitle><DialogDescription>{revoke?.name} · {revoke?.warehouse_name}. Фулфилмент потеряет доступ к заказам и поставкам этого склада.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" disabled={busy} onClick={()=>setRevoke(null)}>Отменить</Button><Button disabled={busy} onClick={async()=>{if(!revoke)return;setBusy(true);setError("");try{await api("/access/"+revoke.id+"/revoke",{});setGenerated(null);await reload();await onStoresChanged();setRevoke(null);setNotice("Доступ отозван.")}catch(e){setError((e as Error).message);setRevoke(null)}finally{setBusy(false)}}}>{busy?"Отключаем…":"Подтвердить"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
