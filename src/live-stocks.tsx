import {InventoryCount} from './inventory-count';
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import "./live-stocks.css";
import {InternalQuantity,OzonInternalStocks,StockModal} from "./internal-stocks";

type Item = { chrt_id:string; title:string;article:string;size:string;barcodes:string[];amount:number|null;cell:string;address:string;version:number;internal:any };
type Result = {items:Item[];total:number;summary:{quantity:number;positions:number;unknown:number};sync:{status:string;synced_at:string|null;error:string|null;run_at:number};canEdit:boolean};
async function api(path:string,body?:unknown,signal?:AbortSignal){
  const response=await fetch("/api"+path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json","X-Supplyo-Client":"web"},body:body===undefined?undefined:JSON.stringify(body),signal});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось загрузить остатки.");return data;
}
function StockField({item,field,disabled,onSave}:{item:Item;field:"cell"|"address"|"amount";disabled:boolean;onSave:(value:string)=>Promise<void>}){
  const value=String(item[field]??""),[draft,setDraft]=useState(value),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const ref=useRef<HTMLInputElement>(null),cancelled=useRef(false),busy=useRef(false);
  useEffect(()=>{if(!editing)setDraft(value)},[value,editing]);
  async function save(){
    if(busy.current||cancelled.current)return;
    if(draft===value){setEditing(false);return}
    if(field==="amount"&&!/^\d{1,6}$/.test(draft)){setError("Введите целое число от 0 до 100000.");return}
    busy.current=true;setSaving(true);setError("");
    try{await onSave(draft);setEditing(false)}catch(e){setError((e as Error).message);ref.current?.focus()}finally{setSaving(false);busy.current=false}
  }
  const label=field==="amount"?"Остаток на WB":field==="cell"?"Код":"Адрес";
  return <div className={"stock-field-slot"+(field==="amount"?" stock-number-slot":"")}>
    <input ref={ref} aria-label={`${label}: ${item.title}`} title={disabled?"Нет права изменять остатки":`${label} — нажмите для изменения`} value={draft} readOnly={!editing||saving||disabled} inputMode={field==="amount"?"numeric":"text"} maxLength={field==="amount"?6:field==="cell"?80:160} placeholder={field==="amount"?"—":"Не задано"} aria-invalid={!!error} aria-busy={saving}
      onFocus={()=>{cancelled.current=false;if(!disabled)setEditing(true)}} onChange={e=>{setDraft(e.target.value);setError("")}}
      onBlur={()=>void save()} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save()}if(e.key==="Escape"){cancelled.current=true;setDraft(value);setError("");setEditing(false);ref.current?.blur()}}}/>
    {field==="amount"&&<span className="stock-unit">шт.</span>}
    {error&&<span className="stock-field-error" role="alert">{error}</span>}
  </div>;
}
function MarketplaceStocks({storeId}:{storeId:string}){
  const [warehouses,setWarehouses]=useState<{id:string;name:string}[]>([]),[warehouse,setWarehouse]=useState(""),[scoped,setScoped]=useState(false),[search,setSearch]=useState(""),[query,setQuery]=useState(""),[availability,setAvailability]=useState("available"),[page,setPage]=useState(1),[data,setData]=useState<Result|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[refreshing,setRefreshing]=useState(false),[publication,setPublication]=useState<{id:string;count:number;quantity:number;skipped:number}|null>(null),[publishing,setPublishing]=useState(false),[publishError,setPublishError]=useState("");
  const generation=useRef(0),notification=useRef<string|number|undefined>(undefined);
  const base=`/stores/${encodeURIComponent(storeId)}`;
  useEffect(()=>{const controller=new AbortController();void api(base+"/warehouses",undefined,controller.signal).then(d=>{setWarehouses(d.warehouses);setScoped(!!d.scoped);const saved=localStorage.getItem("supplyo-warehouse-"+storeId);setWarehouse(d.warehouses.some((w:{id:string})=>w.id===saved)?saved!:d.warehouses[0]?.id||"")}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[base,storeId]);
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search.trim());setPage(1)},250);return()=>clearTimeout(timer)},[search]);
  const suffix=`?warehouse=${encodeURIComponent(warehouse)}&search=${encodeURIComponent(query)}&availability=${availability}&page=${page}`;
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!warehouse)return;const seq=++generation.current;
    try{const result:Result=await api(base+"/stocks"+suffix,undefined,signal);if(seq!==generation.current||signal?.aborted)return;setData(result);setError("");
      if(notification.current!==undefined&&!["queued","syncing"].includes(result.sync.status)){const id=notification.current;notification.current=undefined;setRefreshing(false);if(result.sync.error)toast.error(result.sync.error,{id});else toast.success("Остатки обновлены",{id})}
    }catch(e){if(!signal?.aborted&&seq===generation.current)setError((e as Error).message)}finally{if(!signal?.aborted&&seq===generation.current)setLoading(false)}
  },[base,suffix,warehouse]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);void load(controller.signal);const timer=setInterval(()=>{if(document.visibilityState==="visible")void load(controller.signal)},3000);return()=>{generation.current++;controller.abort();clearInterval(timer)}},[load]);
  useEffect(()=>{setData(null);setPage(1)},[warehouse]);
  useEffect(()=>()=>{if(notification.current!==undefined)toast.dismiss(notification.current)},[]);
  async function refresh(){setRefreshing(true);notification.current=toast.loading("Остатки обновляются…");try{await api(base+"/stocks/sync?warehouse="+encodeURIComponent(warehouse),{});await load()}catch(e){toast.error((e as Error).message,{id:notification.current});notification.current=undefined;setRefreshing(false)}}
  async function preparePublish(){setPublishing(true);setPublishError("");try{setPublication(await api(base+"/stocks/publish-preview?warehouse="+encodeURIComponent(warehouse),{}))}catch(e){toast.error((e as Error).message)}finally{setPublishing(false)}}
  async function publish(){if(!publication)return;setPublishing(true);setPublishError("");try{await api(base+"/stocks/publish?warehouse="+encodeURIComponent(warehouse),{id:publication.id});await load();setPublication(null);toast.success("Остатки переданы и подтверждены WB")}catch(e){setPublishError((e as Error).message)}finally{setPublishing(false)}}
  async function save(item:Item,field:"cell"|"address"|"amount",value:string){await api(base+"/stocks/"+item.chrt_id+"?warehouse="+encodeURIComponent(warehouse),{version:item.version,[field]:field==="amount"?Number(value):value});await load();toast.success(field==="amount"?"Остаток подтверждён WB":"Размещение сохранено")}
  const syncing=!!data&&["queued","syncing"].includes(data.sync.status),pages=Math.ceil((data?.total??0)/100);
  return <section className="live-card live-stocks">
    <header className="stock-heading"><div><h1>Остатки и размещение</h1><p>Товары и размещение на складе{scoped&&warehouses[0]?` · ${warehouses[0].name}`:""}</p></div>
      <dl className="stock-totals"><div><dt>Остаток на WB</dt><dd>{data?Number(data.summary.quantity).toLocaleString("ru-RU"):"—"} <small>шт.</small></dd></div><div><dt>Позиций в наличии</dt><dd>{data?.summary.positions??"—"}</dd></div></dl>
    </header>
    <div className="stock-toolbar"><label className="stock-search"><Search size={16}/><input aria-label="Поиск товара" placeholder="Название, артикул, баркод, код или адрес" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      {!scoped&&warehouses.length>1&&<select aria-label="Склад остатков" value={warehouse} onChange={e=>{setWarehouse(e.target.value);localStorage.setItem("supplyo-warehouse-"+storeId,e.target.value)}}>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      {!scoped&&warehouses.length===1&&<span className="stock-warehouse">{warehouses[0].name}</span>}
      <select aria-label="Наличие товаров" value={availability} onChange={e=>{setAvailability(e.target.value);setPage(1)}}><option value="available">В наличии</option><option value="all">Все товары</option></select>
      <Button variant="secondary" disabled={!warehouse||refreshing||syncing} onClick={()=>void refresh()}><RefreshCw size={15} className={syncing?"stock-spinning":""}/>Обновить</Button>
      <Button variant="secondary" disabled={!data?.canEdit||syncing||publishing} onClick={()=>void preparePublish()}>Передать остатки на WB</Button>
      <a className="stock-export" aria-disabled={!data?.items.length} href={data?.items.length?"/api"+base+"/stocks-export"+suffix:undefined}><Download size={15}/>Экспорт</a>
    </div>
    <div className="stock-sync-status" aria-live="polite">{error||data?.sync.error?<span role="alert">{error||data?.sync.error}</span>:syncing?"Остатки обновляются…":data?.sync.synced_at?`Обновлено ${new Date(data.sync.synced_at).toLocaleString("ru-RU")}`:!warehouse&&!error?"Нет доступных складов":"Загружаем остатки…"}{!!data?.summary.unknown&&<span> · Для {data.summary.unknown} позиций WB не вернул количество</span>}</div>
    <div className="stock-table-scroll"><table className="stock-table"><colgroup><col className="stock-col-product"/><col className="stock-col-barcode"/><col className="stock-col-cell"/><col className="stock-col-address"/><col className="stock-col-amount"/><col className="stock-col-internal"/></colgroup><thead><tr><th>Товар</th><th>Баркоды</th><th>Код</th><th>Адрес</th><th>Остаток на WB</th><th>На складе</th></tr></thead><tbody>
      {data?.items.map(item=><tr key={item.chrt_id}><td><strong>{item.title}</strong><small>{[item.article,item.size&&item.size!=="0"?`Размер ${item.size}`:""].filter(Boolean).join(" · ")}</small></td><td><div className="stock-barcodes">{item.barcodes.length?item.barcodes.map(code=><span key={code}>{code}</span>):"—"}</div></td><td><StockField item={item} field="cell" disabled={!data.canEdit||syncing} onSave={v=>save(item,"cell",v)}/></td><td><StockField item={item} field="address" disabled={!data.canEdit||syncing} onSave={v=>save(item,"address",v)}/></td><td><StockField item={item} field="amount" disabled={!data.canEdit||syncing} onSave={v=>save(item,"amount",v)}/></td><td><InternalQuantity item={item.internal?{...item,...item.internal}:null} source={{id:"wb:"+item.chrt_id,title:item.title}} context={"?store="+encodeURIComponent(storeId)+"&warehouse="+encodeURIComponent(warehouse)} onSaved={load} disabled={!data.canEdit}/></td></tr>)}
      {!data?.items.length&&<tr><td colSpan={6} className="stock-empty">{loading||syncing?"Загружаем товары и остатки…":error||data?.sync.error?"Остатки пока недоступны":!warehouse?"Нет доступных складов":query?"Нет подходящих товаров":availability==="available"?"Товаров в наличии нет":"Товаров пока нет"}</td></tr>}
    </tbody></table></div>
    {publication&&<StockModal label="Передать остатки на WB" busy={publishing} onClose={()=>setPublication(null)}><h2>Передать остатки на WB?</h2><p>WB получит внутренние количества для {publication.count} позиций: {publication.quantity.toLocaleString("ru-RU")} шт. Товары без заданного внутреннего остатка ({publication.skipped}) останутся без изменений.</p>{publishError&&<p role="alert">{publishError}</p>}<div className="stock-pages"><Button variant="secondary" disabled={publishing} onClick={()=>setPublication(null)}>Закрыть</Button><Button disabled={publishing} onClick={()=>void publish()}>{publishing?"Передаём…":"Подтвердить"}</Button></div></StockModal>}
    <footer className="stock-footer">{pages>1&&<div className="stock-pages"><Button variant="ghost" aria-label="Предыдущая страница" disabled={page===1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></Button><span>{page} / {pages}</span><Button variant="ghost" aria-label="Следующая страница" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></Button></div>}</footer>
  </section>;
}

export function LiveStocks({storeId,marketplace}:{storeId?:string;marketplace?:string}){
 const [tab,setTab]=useState('stocks');
 useEffect(()=>setTab('stocks'),[storeId]);
 if(!storeId)return <section className="live-card"><h1>Остатки и размещение</h1><p>Выберите подключённый кабинет для просмотра остатков.</p></section>;
 return <><nav className="stock-mode" aria-label="Разделы остатков"><Button variant={tab==='stocks'?'default':'ghost'} onClick={()=>setTab('stocks')}>Остатки</Button><Button variant={tab==='count'?'default':'ghost'} onClick={()=>setTab('count')}>Инвентаризация</Button></nav>{tab==='count'?<InventoryCount key={storeId} storeId={storeId}/>:marketplace==='ozon'?<OzonInternalStocks storeId={storeId}/>:<MarketplaceStocks storeId={storeId}/>}</>;
}
