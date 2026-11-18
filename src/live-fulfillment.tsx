import { requiresKiz, canPrintWithoutMarking } from "./lib/order-marking";
import { compareAddresses } from "./lib/address-sort";
import { readSession, writeSession } from "./lib/session-state";
import { scannerKey, insertScanText, normalizeScannerText } from "./lib/scanner-input";
import { validateMarking } from "./lib/marking";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { DateRangePicker } from "./components/date-range-picker";
import { Check, Clock3, LoaderCircle, CircleAlert, Truck, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./components/ui/dialog";
async function api(path: string, body?: unknown) {
  let r: Response;
  try { r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Supplyo-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch { throw Error("Нет связи с сервером supply. Проверьте подключение и повторите попытку."); }
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Не удалось выполнить действие");
  return d;
}
async function sendToPrinter(printJob: string, stickers: {file:string}[], printer = localStorage.getItem("supplyo-printer") || undefined) {
  let r: Response;
  try { r = await fetch("http://127.0.0.1:17891/print-batch", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-WMS-Print-Agent":"Supplyo"},
    body: JSON.stringify({job_id:printJob,stickers,printer}),
    signal: AbortSignal.timeout(300000),
  }); } catch {
    throw Error("Нет связи с печатным агентом на этом компьютере. Откройте supply-print-agent.exe и проверьте подключение в «Настройки → Печать этикеток». Если браузер спросит доступ к локальной сети — разрешите его. Результат печати не подтверждён; повторите это же задание после восстановления связи.");
  }
  const result = await r.json();
  if (!r.ok || !result.ok) throw Error(result.error || "Агент не подтвердил печать. Проверьте принтер.");
  return !!result.duplicate;
}
function scanKeyDown(e: ReactKeyboardEvent<HTMLInputElement>, update: (value:string)=>void) {
  const text = scannerKey(e.nativeEvent);
  if (text === null) return;
  e.preventDefault();
  const input = e.currentTarget;
  const position = (input.selectionStart ?? input.value.length) + text.length;
  const next = insertScanText(input.value, input.selectionStart, input.selectionEnd, text);
  update(next);
  requestAnimationFrame(() => {
    if (document.activeElement === input && input.value === next) input.setSelectionRange(position, position);
  });
}
type Item = {
  sticker_text?: string | null;
  cell?: string | null;
  address?: string | null;
  id: string;
  supply_id: string;
  snapshot: { article: string; skus: string[]; requiredMeta?: string[]; optionalMeta?: string[]; warehouseId?: number };
  status: string;
  printed: boolean;
};
export function Fulfillment({
  accountKey,
  storeId,
  mode,
  onMode,
  storeVersion,
  permissions,
}: {
  accountKey: string;
  permissions?:string[];
  storeId: string;
  storeVersion: string;
  mode: "orders" | "assembly" | "supplies";
  onMode: (m: "orders" | "assembly" | "supplies") => void;
}) {
  const supplyKey = "supplyo-active-supply-" + accountKey + "-" + storeId;
  const canAssemble=!permissions||permissions.includes("assembly"),canSupply=!permissions||permissions.includes("supplies");
  const [orders, setOrders] = useState<any[]>([]),
    [supplies, setSupplies] = useState<any[]>([]),
    [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [supply, setSupply] = useState(() => {
      const saved = readSession<unknown>(supplyKey);
      return typeof saved === "string" ? saved : "";
    }),
    [search, setSearch] = useState(""),
    [scan, setScan] = useState(""),
    [kiz, setKiz] = useState(""),
    [target, setTarget] = useState<Item | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [addingToSupply, setAddingToSupply] = useState(false);
  const [warehouses, setWarehouses] = useState<{id: string; name: string}[]>([]);
  const [deliveryTarget, setDeliveryTarget] = useState<"SC" | "PVZ">("SC");
  const [boxCount, setBoxCount] = useState("");
  const activeToast = useRef<string | number | undefined>(undefined);
  const [reprintSupply, setReprintSupply] = useState<any>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [moveOrders,setMoveOrders]=useState<string[]>([]),[moving,setMoving]=useState(false),[moveTarget,setMoveTarget]=useState(''),[moveName,setMoveName]=useState('');
  useEffect(()=>{setMoveOrders([]);setMoving(false);},[storeId,supply]);
  useEffect(()=>{setMoveOrders(previous=>previous.filter(id=>items.some(i=>i.id===id&&i.supply_id===supply)));},[items,supply]);
  useEffect(() => { if (supply) writeSession(supplyKey, supply); }, [supplyKey, supply]);
  const actionRunning = useRef(false);
  const scanner = useRef<HTMLInputElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  function focusScanner() {
    if (mode!=="assembly"||!supply||busy||!canAssemble||document.hidden||!scanner.current||scanner.current.disabled) return;
    if(document.querySelector('[role="dialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"]'))return;
    const active=document.activeElement as HTMLElement|null;
    if(active&&active!==scanner.current&&active.closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="combobox"],[role="textbox"]')&&!active.closest('[role="dialog"][data-state="closed"]'))return;
    scanner.current.focus({preventScroll:true});
  }
  useEffect(()=>{
    const frame=requestAnimationFrame(focusScanner);
    return()=>cancelAnimationFrame(frame);
  },[mode,supply,busy,target,confirm,addingToSupply,reprintSupply,moving,canAssemble]);
  useEffect(()=>{
    if(mode!=="assembly"||!supply||busy||!canAssemble)return;
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.key===' '||event.key==='Enter'||event.key==='Tab'||document.hidden)return;
      const active=document.activeElement as HTMLElement|null;
      if(active===scanner.current||active?.closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="combobox"],[role="textbox"]'))return;
      if(document.querySelector('[role="dialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"]'))return;
      const text=scannerKey(event);if(text===null||!scanner.current||scanner.current.disabled)return;
      event.preventDefault();scanner.current.focus({preventScroll:true});setScan(old=>old+text);
    };
    const resume=()=>focusScanner();
    document.addEventListener('keydown',key);
    window.addEventListener('focus',resume);
    document.addEventListener('visibilitychange',resume);
    return()=>{document.removeEventListener('keydown',key);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[mode,supply,busy,canAssemble,target,confirm]);
  useEffect(()=>{
    const input=searchField.current;if(mode!=="assembly"||!input)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const clear=()=>{if(timer)clearTimeout(timer);};
    const arm=()=>{clear();if(!input.value)timer=setTimeout(()=>{if(document.activeElement===input&&!input.value){input.blur();focusScanner();}},4000);};
    input.addEventListener('focus',arm);input.addEventListener('input',arm);input.addEventListener('blur',clear);
    if(document.activeElement===input)arm();
    return()=>{clear();input.removeEventListener('focus',arm);input.removeEventListener('input',arm);input.removeEventListener('blur',clear);};
  },[mode,supply,busy,canAssemble,target,confirm]);
  const validBoxes = /^\d+$/.test(boxCount) && Number(boxCount) >= 1 && Number(boxCount) <= 1000;
  useEffect(() => { setDeliveryTarget("SC"); setBoxCount(""); setConfirm(false); }, [storeId, supply]);
  const [scoped,setScoped]=useState(false);
  const [warehouse, setWarehouse] = useState(() => localStorage.getItem("supplyo-warehouse-" + storeId) || "");
  useEffect(() => {
    let active = true;
    void api("/stores/" + storeId + "/warehouses").then(d => {
      if (!active) return;
      setWarehouses(d.warehouses);
      setScoped(!!d.scoped);
      const saved = localStorage.getItem("supplyo-warehouse-" + storeId);
      setWarehouse(d.warehouses.some((w: any) => w.id === saved) ? saved! : d.warehouses[0]?.id || "");
    }).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [storeId]);
  const [supplyFrom,setSupplyFrom]=useState(''),[supplyTo,setSupplyTo]=useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const base = "/stores/" + storeId;
  useEffect(() => {
    if(mode!=="assembly" || !supply) return;
    let active=true;
    void api(base+"/supplies/"+encodeURIComponent(supply)+"/sticker-numbers",{})
      .then(()=>{if(active) return load();})
      .catch(e=>{if(active) setError(e.message);});
    return()=>{active=false;};
  },[mode,supply,storeId,storeVersion]);
  async function load() {
    const d = await api(base + "/fulfillment");
    setSupplies(d.supplies);
    setItems(d.items);
    setSupply((old) =>
      d.supplies.some((s: any) => s.id === old && !s.closed)
        ? old
        : d.supplies.find((s: any) => !s.closed)?.id || "",
    );
    if (mode === "orders" && warehouse) {
      const o = await api(
        base + "/orders?page=" + page + "&search=" + encodeURIComponent(search) + "&warehouse=" + encodeURIComponent(warehouse),
      );
      setTotal(o.total);
      setOrders(
        o.orders.filter((o: any) => !d.items.some((i: Item) => i.id === o.id)),
      );
    }
  }
  useEffect(() => {
    setSelected([]);
    setSearch("");
    void load().catch((e) => setError(e.message));
  }, [storeId, mode, storeVersion]);
  useEffect(() => {
    const t = setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, page, warehouse]);
  useEffect(() => {
    if (mode !== "assembly" || !supply || !canAssemble) return;
    let checking = false, active = true;
    const t = setInterval(() => {
      if (document.hidden || busy || checking) return;
      checking = true;
      void api(base + "/supplies/" + encodeURIComponent(supply) + "/check", {})
        .then(() => { if (active) return load(); })
        .catch((e) => { if (active) setError(e.message); })
        .finally(() => { checking = false; });
    }, 15000);
    return () => { active = false; clearInterval(t); };
  }, [mode, supply, storeId, busy, canAssemble]);
  async function action(fn: () => Promise<void | string>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError("");
    const notification = toast.loading("Выполняем действие…");
    activeToast.current = notification;
    try {
      const message = await fn();
      toast.success(message || "Действие выполнено", { id: notification });
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message, { id: notification, duration: 8000 });
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }
  async function printAuto(barcode: string) {
    let submitted = false;
    try {
      toast.loading("Подготавливаем все стикеры товара…", { id: activeToast.current });
      const path = base + "/supplies/" + encodeURIComponent(supply);
      const d = await api(path + "/scan-auto", { barcode });
      toast.loading(`Отправляем на принтер: ${d.jobs.length} стикеров одним заданием…`, { id: activeToast.current });
      await sendToPrinter(d.printJob, d.jobs.map((job: {label:string}) => ({file:job.label})));
      submitted = true;
      await api(path + "/print-batches/" + encodeURIComponent(d.printJob) + "/printed", {});
      const ids = new Set(d.jobs.map((job: {orderId:string}) => job.orderId));
      setItems(old => old.map(i => ids.has(i.id) ? {...i, printed:true, status:"Готов"} : i));
      setScan("");
      return `Стикеры отправлены на принтер: ${d.jobs.length}.`;
    } catch (e) {
      throw Error(`${submitted ? "Агент принял пакет, но сохранить результат не удалось." : "Печать пакета не подтверждена."} ${(e as Error).message} Повторите скан того же баркода: подготовленный пакет защищён от повторной отправки в печать.`);
    }
  }
  async function print(item: Item, code?: string) {
    const marking = code ? validateMarking(code) : null;
    if (marking && !marking.valid) throw Error(marking.message);
    const normalized = marking?.valid ? marking.code : undefined;
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized || ""))), b => b.toString(16).padStart(2,"0")).join("");
    const storageKey = "supplyo-pending-print-" + storeId + "-" + item.id;
    let pending: {fingerprint:string; printJob:string; label:string; printer?:string} | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* Invalid cache: prepare a new print intent. */ }
    toast.loading(code ? "Сохраняем КИЗ и подготавливаем стикер…" : "Подготавливаем стикер…", { id: activeToast.current });
    if (!pending || pending.fingerprint !== fingerprint) {
      const d = await api(base + "/items/" + item.id + "/scan", { kiz: normalized });
      pending = {fingerprint, printJob:d.printJob, label:d.label, printer:localStorage.getItem("supplyo-printer") || ""};
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    }
    toast.loading("Отправляем стикер на принтер…", { id: activeToast.current });
    const duplicate = await sendToPrinter(pending.printJob,[{file:pending.label}], pending.printer);
    await api(base + "/items/" + item.id + "/printed", {});
    sessionStorage.removeItem(storageKey);
    setItems(old => old.map(i => i.id === item.id ? {...i, printed:true} : i));
    setTarget(null);
    setKiz("");
    setScan("");
    const message = duplicate ? "Агент уже передал это задание в очередь принтера." : "Стикер передан в очередь принтера.";
    return code ? message + " Ожидаем проверку КИЗ в WB." : message;
  }
  async function printShipping(id: string, repeat = false) {
    try {
      const path = base + "/supplies/" + encodeURIComponent(id);
      const d = await api(path + "/labels",{});
      // Keep the same job after a timeout; a completed job is deduplicated by the agent.
      const storageKey = "supplyo-shipping-job-" + storeId + "-" + id;
      const job = repeat ? "supplyo-shipping-" + crypto.randomUUID() : localStorage.getItem(storageKey) || d.printJob;
      localStorage.setItem(storageKey,job);
      await sendToPrinter(job,d.stickers);
      await api(path + "/labels-printed",{});
      return d.stickers.length > 1 ? `Стикеры коробов отправлены на принтер: ${d.stickers.length}.` : "Стикер отправлен на принтер.";
    } catch(e) {
      throw Error("Поставка передана в доставку, но печать стикера не подтверждена. Проверьте печатный агент и принтер, затем нажмите «Печать стикера» в списке поставок. " + (e as Error).message);
    }
  }
  const current = items.filter((i) => i.supply_id === supply),
    shown = current.filter((i) =>
      [i.id, i.snapshot.article, i.cell, i.address, i.sticker_text, ...i.snapshot.skus]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ).sort((a, b) => compareAddresses(a.address, b.address)
      || compareAddresses([...a.snapshot.skus].sort().join("\n"), [...b.snapshot.skus].sort().join("\n"))
      || a.id.localeCompare(b.id, "en", {numeric:true}));
  const supplyDay=(value?:string|null)=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
  const supplyDate=(value?:string|null)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
  const visibleSupplies=supplies.filter(s=>{const day=supplyDay(s.created);return (!supplyFrom||day>=supplyFrom)&&(!supplyTo||!!day&&day<=supplyTo);});
  const openSupplies = supplies.filter(s => !s.closed && (
    s.warehouse_id === warehouse || (!s.warehouse_id && items.some(i => i.supply_id === s.id) &&
      items.filter(i => i.supply_id === s.id).every(i => String((i.snapshot as any).warehouseId) === warehouse))
  ));
  const sourceWarehouse=supplies.find(s=>s.id===supply)?.warehouse_id||String(current[0]?.snapshot.warehouseId||'');
  const moveTargets=supplies.filter(s=>!s.closed&&s.id!==supply&&(s.warehouse_id===sourceWarehouse||(!s.warehouse_id&&(!scoped&&!items.some(i=>i.supply_id===s.id)||items.some(i=>i.supply_id===s.id)&&items.filter(i=>i.supply_id===s.id).every(i=>String(i.snapshot.warehouseId)===sourceWarehouse)))));
  async function transferOrders(){
    const payload={orders:[...moveOrders].sort(),...(moveTarget==='new'?{newName:moveName.trim()}:{targetSupply:moveTarget})};
    const transferKey='supply-transfer-'+accountKey+'-'+storeId;
    const fingerprint=JSON.stringify({source:supply,...payload});
    const saved=readSession<{fingerprint:string;id:string}>(transferKey);
    const operationId=saved?.fingerprint===fingerprint?saved.id:crypto.randomUUID();
    writeSession(transferKey,{fingerprint,id:operationId});
    const result=await api(base+'/supplies/'+encodeURIComponent(supply)+'/move',{...payload,operationId});
    setSupply(result.id);setMoving(false);setMoveOrders([]);
    return `Перенесено заказов: ${result.moved}`;
  }
  async function addOrders(id: string) {
    await api(base + "/supplies/" + encodeURIComponent(id) + "/add", {orders:selected});
    setSupply(id); setSelected([]); setAddingToSupply(false); onMode("assembly");
  }
  return (
    <section className="live-card fulfillment">
      <h1>
        {mode === "orders"
          ? "Новые заказы"
          : mode === "assembly"
            ? "Сборка поставки"
            : "Поставки"}
      </h1>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {mode === "orders" ? (
        <>
          <div className="fulfillment-toolbar">
            {scoped?<span className="order-warehouse-picker">Склад: {warehouses[0]?.name || "Загружаем…"}</span>:<label className="order-warehouse-picker">Город / склад
              <select aria-label="Город / склад" value={warehouse} onChange={e => {
                setWarehouse(e.target.value); localStorage.setItem("supplyo-warehouse-" + storeId, e.target.value);
                setPage(1); setSelected([]); setOrders([]);
              }}>
                {!warehouses.length && <option value="">Загрузка складов…</option>}
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>}
            <Input
              aria-label="Поиск заказов"
              placeholder="Номер заказа, артикул или баркод"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected([]); }}
            />
            <Button
              variant="secondary"
              disabled={!canSupply || busy || !selected.length || !openSupplies.length}
              onClick={() => openSupplies.length === 1
                ? void action(() => addOrders(openSupplies[0].id))
                : setAddingToSupply(true)}
            >
              Добавить в поставку
            </Button>
            <Button
              disabled={!canSupply || busy || !selected.length}
              onClick={() =>
                void action(async () => {
                  const d = await api(base + "/supplies/create", {
                    orders: selected,
                    name: "supply " + new Date().toLocaleString("ru-RU"),
                  });
                  setSupply(d.id);
                  setSelected([]);
                  onMode("assembly");
                })
              }
            >
              Создать поставку ({selected.length})
            </Button>
          </div>
          <div className="live-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Выбрать все"
                      checked={
                        !!orders.length && selected.length === orders.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? orders.map((o) => o.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>Номер заказа</th>
                  <th>Товар</th>
                  <th>Баркоды</th>
                  <th>Склад WB</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(o.id)}
                        aria-label={"Выбрать заказ " + o.id}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, o.id]
                              : selected.filter((id) => id !== o.id),
                          )
                        }
                      />
                    </td>
                    <td>{o.id}</td>
                    <td>{o.article}</td>
                    <td>{o.skus.join(", ")}</td>
                    <td>{warehouses.find(w => w.id === o.warehouse_id)?.name || o.warehouse_id}</td>
                    <td>{new Date(o.created_at).toLocaleString("ru-RU")}</td>
                  </tr>
                ))}
                {!orders.length && (
                  <tr>
                    <td colSpan={6}>Новых заказов нет</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {total > 50 && <div className="fulfillment-toolbar"><Button variant="secondary" disabled={page === 1} onClick={() => {setPage(page-1);setSelected([]);}}>Назад</Button><span>Страница {page} из {Math.ceil(total/50)}</span><Button variant="secondary" disabled={page*50 >= total} onClick={() => {setPage(page+1);setSelected([]);}}>Далее</Button></div>}
        </>
      ) : mode === "supplies" ? (
        <>
        <div className="live-supply-filters"><div><label>Период создания</label><DateRangePicker from={supplyFrom} to={supplyTo} onChange={(from,to)=>{setSupplyFrom(from);setSupplyTo(to);}}/></div><span>Дата и время — МСК</span></div>
        <div className="live-table-scroll"><table className="live-supplies-table"><colgroup>{[230,140,150,150,100,100,80,110,120,190].map((width,n)=><col key={n} style={{width}}/>)}</colgroup><thead><tr>
          {['Поставка','Склад','Создана','Передана','Заказов без КИЗ','Заказов с КИЗ','Коробов','Куда отгружено','Статус','Стикер'].map(h=><th key={h}>{h}</th>)}
        </tr></thead><tbody>{visibleSupplies.map(s=>{
          const rows=items.filter(i=>i.supply_id===s.id),withKiz=rows.filter(i=>requiresKiz(i.snapshot)).length;
          const ids=[...new Set(rows.map(i=>String((i.snapshot as any).warehouseId||'')).filter(Boolean))];
          const warehouseId=s.warehouse_id||(ids.length===1?ids[0]:'');
          const name=s.warehouse_name||warehouses.find(w=>w.id===warehouseId)?.name||(warehouseId?'Склад WB № '+warehouseId:'—');
          const open=()=>{setSupply(s.id);onMode('assembly');};
          return <tr key={s.id}><td>{s.closed?<><strong>{s.name||s.id}</strong><small>{s.id}</small></>:<button className="live-supply-link" onClick={open}><strong>{s.name||s.id}</strong><small>{s.id}</small></button>}</td>
            <td>{name}</td><td>{supplyDate(s.created)}</td><td>{supplyDate(s.delivered_at)}</td><td>{rows.length-withKiz}</td><td>{withKiz}</td><td>{s.boxes??'—'}</td><td>{s.destination==='PVZ'?'ПВЗ':s.destination==='SC'?'СЦ':'—'}</td>
            <td>{s.closed?'Отгружена':<button className="live-supply-link" onClick={open}>На сборке</button>}</td>
            <td>{s.closed&&<Button variant="secondary" disabled={busy||!canSupply} onClick={()=>s.shipping_printed_at?setReprintSupply(s):void action(()=>printShipping(s.id))}><Printer size={16} aria-hidden="true"/>{busy?'Печатаем…':s.shipping_printed_at?'Повторить печать':'Печать стикера'}</Button>}</td></tr>;
        })}{!visibleSupplies.length&&<tr><td colSpan={10}>{supplies.length?'Нет поставок за выбранный период':'Поставок пока нет'}</td></tr>}</tbody></table></div>
        </>
      ) : !supplies.some(s => !s.closed) ? (
        <div className="live-assembly-empty">
          <Truck size={28} aria-hidden="true" />
          <h2>Нет поставок для сборки</h2>
          <p>Создайте поставку из новых заказов, чтобы начать сборку.</p>
          <Button onClick={() => onMode("orders")}>Перейти к новым заказам</Button>
        </div>
      ) : (
        <>
          <div className="fulfillment-toolbar">
            <select
              aria-label="Поставка"
              disabled={busy}
              value={supply}
              onChange={(e) => setSupply(e.target.value)}
            >
              {supplies
                .filter((s) => !s.closed)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.id}
                  </option>
                ))}
            </select>
            {canSupply&&<Button variant="secondary" disabled={busy||!moveOrders.length} onClick={()=>{setError('');setMoveTarget(moveTargets[0]?.id||'new');setMoveName('supply '+new Date().toLocaleString('ru-RU'));setMoving(true);}}>Перенести заказы ({moveOrders.length})</Button>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if(!canAssemble || actionRunning.current)return;
              const barcode = scan.trim();
              if(!barcode)return;
              setScan("");
              if (autoPrint && current.some(i => i.snapshot.skus.includes(barcode)
                && !i.printed && i.status === "Ожидает"
                && canPrintWithoutMarking(i.snapshot))) {
                void action(() => printAuto(barcode));
                return;
              }
              const item = current.find(
                (i) =>
                  i.snapshot.skus.includes(barcode) && !i.printed && i.status !== "Готов",
              );
              if (!item) {
                const message = current.some(i => i.snapshot.skus.includes(barcode))
                  ? "Для всех заказов с этим баркодом печать уже подтверждена. Для повторной печати или исправления КИЗ выберите нужный заказ в таблице."
                  : "Нет такого баркода среди заказов выбранной поставки";
                toast.error(message);
                setError(message);
                return;
              }
              if (!requiresKiz(item.snapshot) && !Array.isArray(item.snapshot.requiredMeta)) {
                toast.error("Требования к маркировке ещё не получены. Обновите данные заказа.");
                setError("Требования к маркировке ещё не получены. Обновите данные заказа.");
                return;
              }
              if (requiresKiz(item.snapshot)) {
                setTarget(item);
                setKiz("");
              } else void action(() => print(item));
            }}
          >
          <div className="live-scanner-heading">
            <label htmlFor="product-scan">Сканирование товара</label>
            <div className="live-auto-control" title="Один скан — все ожидающие заказы этого товара без КИЗ в выбранной поставке">
              <label htmlFor="assembly-auto">Авто</label>
              <button id="assembly-auto" type="button" role="switch" aria-checked={autoPrint}
                aria-label="Авто: печать всех стикеров товара без КИЗ в текущей поставке"
                disabled={busy || !canAssemble} className="live-auto-switch"
                onClick={() => setAutoPrint(value => !value)}><span /></button>
            </div>
          </div>
            <Input
              id="product-scan"
              ref={scanner}
              disabled={busy || !canAssemble}
              placeholder="Сканируйте баркод или введите вручную и нажмите Enter"
              value={scan}
              onKeyDown={e => scanKeyDown(e, setScan)}
              onChange={(e) => setScan(normalizeScannerText(e.target.value))}
            />
          </form>
          <div className="fulfillment-toolbar">
            <Input
              aria-label="Поиск в поставке"
              ref={searchField}
              placeholder="Поиск по таблице"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected([]); }}
            />
            <span>
              Собрано {current.filter((i) => i.status === "Готов").length} из{" "}
              {current.length}
            </span>
          </div>
          <div className="live-table-scroll">
            <table className="live-assembly-table">
              <colgroup>
                <col className="assembly-col-status" style={canSupply?{width:166}:undefined} />
                <col className="assembly-col-order" />
                <col />
                <col className="assembly-col-placement" />
                <col className="assembly-col-placement" />
                <col className="assembly-col-barcodes" />
                <col className="assembly-col-sticker" />
                <col className="assembly-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th><span className="live-assembly-choice">{canSupply&&<input type="checkbox" aria-label="Выбрать заказы для переноса" disabled={busy||!shown.length} checked={shown.length>0&&shown.slice(0,100).every(i=>moveOrders.includes(i.id))} onChange={e=>setMoveOrders(e.target.checked?shown.slice(0,100).map(i=>i.id):[])}/>}Статус</span></th>
                  <th>Номер заказа</th>
                  <th>Товар</th>
                  <th className="live-placement">Адрес</th>
                  <th className="live-placement">Код</th>
                  <th>Баркоды</th>
                  <th>Стикер</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td><span className="live-assembly-choice">{canSupply&&<input type="checkbox" aria-label={'Перенести заказ '+i.id} disabled={busy||moveOrders.length>=100&&!moveOrders.includes(i.id)} checked={moveOrders.includes(i.id)} onChange={e=>setMoveOrders(old=>e.target.checked?[...old,i.id]:old.filter(id=>id!==i.id))}/>}<AssemblyStatus status={i.status}/></span></td>
                    <td>{i.id}</td>
                    <td>{i.snapshot.article}</td>
                    <td className="live-placement">{i.address || "—"}</td>
                    <td className="live-placement">{i.cell || "—"}</td>
                    <td>{i.snapshot.skus.join(", ")}</td>
                    <td className="live-sticker-number">{i.sticker_text || "—"}</td>
                    <td>
                      {requiresKiz(i.snapshot) && (
                        <Button
                          variant="secondary"
                          disabled={busy || !canAssemble}
                          onClick={() => {
                            setTarget(i);
                            setKiz("");
                          }}
                        >
                          КИЗ
                        </Button>
                      )}{" "}
                      <Button
                        variant="secondary"
                        disabled={busy || !canAssemble}
                        onClick={() =>
                          requiresKiz(i.snapshot)
                            ? (setTarget(i), setKiz(""))
                            : void action(() => print(i))
                        }
                      >
                        Печать
                      </Button>
                    </td>
                  </tr>
                ))}
                {!current.length && (
                  <tr>
                    <td colSpan={8}>Выберите или создайте поставку</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {current.length > 0 && current.every((i) => i.status === "Готов") && (
            <footer className="live-delivery-footer">
              <div className="live-delivery-settings">
                <div className="live-delivery-options" role="group" aria-label="Способ передачи">
                  <Button variant="ghost" aria-pressed={deliveryTarget === "SC"} disabled={busy || !canSupply} onClick={() => setDeliveryTarget("SC")}>В СЦ</Button>
                  <Button variant="ghost" aria-pressed={deliveryTarget === "PVZ"} disabled={busy || !canSupply} onClick={() => setDeliveryTarget("PVZ")}>В ПВЗ</Button>
                </div>
                <div className="live-delivery-box-slot">
                  {deliveryTarget === "PVZ" && <div className="live-delivery-boxes">
                    <label htmlFor="delivery-boxes">Коробов для ПВЗ</label>
                    <Input id="delivery-boxes" type="number" min="1" max="1000" step="1" inputMode="numeric" placeholder="Кол-во" value={boxCount} disabled={busy || !canSupply} onChange={e => setBoxCount(e.target.value)}/>
                  </div>}
                </div>
              </div>
              <Button disabled={busy || !canSupply || (deliveryTarget === "PVZ" && !validBoxes)} onClick={() => setConfirm(true)}>
                <Truck size={16} aria-hidden="true"/>Передать в доставку
              </Button>
            </footer>
          )}
        </>
      )}
      <Dialog open={moving} onOpenChange={open=>{if(!busy)setMoving(open);}}>
        <DialogContent onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(focusScanner);}}>
          <DialogHeader><DialogTitle>Перенести заказы</DialogTitle></DialogHeader>
          <p>Выбрано: {moveOrders.length}. Перенос доступен в поставки этого же склада.</p>
          <label htmlFor="move-supply">Куда перенести</label>
          <select className="live-move-select" id="move-supply" value={moveTarget} disabled={busy} onChange={e=>setMoveTarget(e.target.value)}>
            {moveTargets.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}
            <option value="new">Создать новую поставку</option>
          </select>
          {moveTarget==='new'&&<><label htmlFor="move-name">Название новой поставки</label><Input id="move-name" maxLength={128} value={moveName} disabled={busy} onChange={e=>setMoveName(e.target.value)}/></>}
          <p className="text-sm text-muted-foreground">КИЗ, отметки печати и заметки выбранных заказов сохранятся.</p>
          {error&&<p role="alert" className="live-error">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setMoving(false)}>Отмена</Button><Button disabled={busy||!moveOrders.length||!moveTarget||moveTarget==='new'&&!moveName.trim()} onClick={()=>void action(transferOrders)}>{busy?'Переносим…':'Перенести'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={addingToSupply} onOpenChange={setAddingToSupply}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить заказы в поставку</DialogTitle></DialogHeader>
          <p>Выберите открытую поставку этого склада.</p>
          {openSupplies.map(s => <Button key={s.id} variant="secondary" disabled={busy || !canSupply} onClick={() => void action(() => addOrders(s.id))}>{s.name} · {s.id}</Button>)}
          {error && <p role="alert" className="live-error">{error}</p>}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!target}
        onOpenChange={(o) => {
          if (!o && !busy) setTarget(null);
        }}
      >
        <DialogContent onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(focusScanner);}}>
          <DialogHeader>
            <DialogTitle>КИЗ товара</DialogTitle>
          </DialogHeader>
          <p>
            Заказ № {target?.id} · {target?.snapshot.article}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if(!canAssemble)return;
              if (target) void action(() => print(target, kiz));
            }}
          >
            <Input
              autoFocus
              aria-label="КИЗ"
              placeholder="Отсканируйте КИЗ"
              value={kiz}
              onKeyDown={e => scanKeyDown(e, setKiz)}
              onChange={(e) => setKiz(normalizeScannerText(e.target.value))}
            />
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button disabled={busy || !kiz} type="submit">
                {busy ? "Отправляем и печатаем…" : "Сохранить и напечатать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Передать поставку в доставку?</DialogTitle>
          </DialogHeader>
          <p>
            Поставка {supply}. Заказов: {current.length}.
          </p>
          <p>Куда передаём: <strong>{deliveryTarget === "PVZ" ? "ПВЗ" : "СЦ"}</strong>{deliveryTarget === "PVZ" && <> · Коробов: <strong>{boxCount}</strong></>}.</p>
          <p>Поставка будет передана в доставку в Wildberries.</p>
          {error && <p role="alert" className="live-error">{error}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Отменить
            </Button>
            <Button
              disabled={busy || !canSupply || (deliveryTarget === "PVZ" && !validBoxes)}
              onClick={() =>
                void action(async () => {
                  await api(
                    base +
                      "/supplies/" +
                      encodeURIComponent(supply) +
                      "/deliver",
                    {destination: deliveryTarget, ...(deliveryTarget === "PVZ" ? {boxes: Number(boxCount)} : {})},
                  );
                  setConfirm(false);
                  onMode("supplies");
                  await load();
                  return await printShipping(supply);
                })
              }
            >
              {busy ? "Передаём…" : "Подтвердить передачу"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reprintSupply} onOpenChange={open => {if (!open) setReprintSupply(null);}}>
        <DialogContent>
          <DialogHeader><DialogTitle>Напечатать стикер ещё раз?</DialogTitle></DialogHeader>
          <p>{reprintSupply?.name}. Стикер уже отправлялся на принтер.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReprintSupply(null)}>Отменить</Button>
            <Button disabled={busy || !canSupply} onClick={() => {const id = reprintSupply.id; setReprintSupply(null); void action(() => printShipping(id,true));}}>Напечатать ещё раз</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AssemblyStatus({status}: {status: string}) {
  const kind = status === "Готов" ? "ready" : status === "Проверяется" ? "checking" : status.startsWith("Ошибка") ? "error" : "waiting";
  const Icon = kind === "ready" ? Check : kind === "checking" ? LoaderCircle : kind === "error" ? CircleAlert : Clock3;
  return <span className={`live-assembly-status live-assembly-status-${kind}`}><Icon size={12} aria-hidden="true"/>{status}</span>;
}

