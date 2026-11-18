import { useEffect, useRef, useState } from "react";
import { PersonalAccount } from "./components/personal-account";
import type { AccountWarehouse } from "./components/personal-account";
import { Accounting } from "./components/accounting";
import type {PriceService} from "./lib/invoice";
import type { AccountingEntry } from "./components/accounting";
import { Button } from "./components/ui/button";

type Document<T> = {data:T;version:number};
type ClientServices={client:string;serviceIds:string[]};
type Snapshot = {warehouses:Document<AccountWarehouse[]>;accounting:Document<AccountingEntry[]>;clientServices?:Document<ClientServices[]>;prices?:Document<PriceService[]>};
async function request(path:string, body?:unknown,team?:string) {
 const response=await fetch("/api/workspace"+path+(team?"?team="+encodeURIComponent(team):""),{method:body===undefined?"GET":"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Supplyo-Client":"web"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();
 if(!response.ok)throw new Error(value.error||"Не удалось сохранить данные");
 return value;
}
export function LiveWorkspace({section,team}:{section:"warehouses"|"accounting";team?:string}) {
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const [bindingOptions,setBindingOptions]=useState<{storeId:string;warehouseId:string;label:string}[]|undefined>(undefined);
 const versions=useRef({warehouses:0,accounting:0,prices:0,clientServices:0}), busy=useRef(false);
 useEffect(()=>{let cancelled=false;request("",undefined,team).then(value=>{if(cancelled)return;versions.current={warehouses:value.warehouses.version,accounting:value.accounting.version,prices:value.prices?.version||0,clientServices:value.clientServices?.version||0};setSnapshot(value)}).catch(e=>!cancelled&&setError(e.message));if(!team)request("/bindings").then(value=>!cancelled&&setBindingOptions(value.options)).catch(e=>!cancelled&&setError(e.message));return()=>{cancelled=true}},[team]);
 async function save(kind:"warehouses"|"accounting"|"prices"|"clientServices",data:AccountWarehouse[]|AccountingEntry[]|PriceService[]|ClientServices[]) {
  if(busy.current)return false;
  busy.current=true;setSaving(true);setError("");
  try{const result=await request("/"+kind,{data,version:versions.current[kind]},team);versions.current[kind]=result.version;return true}
  catch(e){setError((e as Error).message);return false}
  finally{busy.current=false;setSaving(false)}
 }
 async function upload(file:File,id:string){
  if(file.size>5*1024*1024)throw new Error("Размер файла не должен превышать 5 МБ.");
  const response=await fetch("/api/workspace/files",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/octet-stream","X-Supplyo-Client":"web","X-File-Name":encodeURIComponent(file.name),"X-File-Type":file.type,"X-File-Id":id},body:file});
  const result=await response.json();if(!response.ok)throw new Error(result.error||"Не удалось загрузить документ");
 }
 async function download(id:string){
  const response=await fetch("/api/workspace/files/"+encodeURIComponent(id));
  if(!response.ok){setError("Документ недоступен");return}
  const file=await response.blob(),url=URL.createObjectURL(file),link=document.createElement("a");
  const disposition=response.headers.get("Content-Disposition")||"";
  link.href=url;link.download=decodeURIComponent(disposition.split("UTF-8''")[1]||"document");link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <div className="live-workspace" aria-busy={saving}>
  {error&&<div className="live-error" role="alert">{error}<Button variant="secondary" onClick={()=>window.location.reload()}>Перезагрузить</Button></div>}
  {!snapshot?<p role="status">{error?"Раздел не загружен":"Загружаем данные…"}</p>:section==="warehouses"?<PersonalAccount section="warehouses" remote={{warehouses:snapshot.warehouses.data,employeeManaged:!!team,bindingsOptions:bindingOptions,saveWarehouses:next=>save("warehouses",next)}}/>:<Accounting remote={{rows:snapshot.accounting.data,clientServices:snapshot.clientServices?.data||[],saveClientServices:next=>save("clientServices",next),prices:snapshot.prices?.data||[],savePrices:next=>save("prices",next),warehouses:snapshot.warehouses.data,save:next=>save("accounting",next),upload,download}}/>}
  {saving&&<div className="workspace-save-status" role="status">Сохраняем на сервере…</div>}
 </div>
}
