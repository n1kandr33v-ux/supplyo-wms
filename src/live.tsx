const PlatformAdmin=lazy(()=>import('./platform-admin').then(m=>({default:m.PlatformAdmin})));
import {ChangePassword} from './change-password';
const OzonClientMarks=lazy(()=>import('./ozon-client-marks').then(m=>({default:m.OzonClientMarks})));
const OzonAssembly=lazy(()=>import('./ozon-assembly').then(m=>({default:m.OzonAssembly})));
const OzonOrders=lazy(()=>import("./ozon-orders").then(m=>({default:m.OzonOrders})));
import { lazy, Suspense } from "react";
const LiveWorkspace=lazy(()=>import("./live-workspace").then(module=>({default:module.LiveWorkspace})));
const AccessSettings=lazy(()=>import("./live-access").then(module=>({default:module.AccessSettings})));
const PrintAgentSettings=lazy(()=>import("./components/print-agent-settings").then(module=>({default:module.PrintAgentSettings})));
const LiveStocks=lazy(()=>import("./live-stocks").then(module=>({default:module.LiveStocks})));
const LiveDashboard=lazy(()=>import("./live-dashboard").then(module=>({default:module.LiveDashboard})));
import { Toaster, toast } from "sonner";
import { Warehouse, Calculator, Pencil, KeyRound, UserRoundPlus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  LogOut,
  Package,
  RefreshCw,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  Truck,
  UserRound,
  CreditCard,
} from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import { Landing } from "./landing";
import { Fulfillment } from "./live-fulfillment";
import { readSession, writeSession } from "./lib/session-state";
import { Auth } from "./auth";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import "./live.css";

async function liveApi(path: string, body?: unknown) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Supplyo-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}
type Store = {
  original_name?:string;custom_name?:string|null;
  marketplace?: "wb"|"ozon";
  id: string;
  name: string;
  status: string;
  last_synced: string | null;
  error: string | null;
  next_sync: number;
  delegated?: boolean;
  cabinet_id?: string;
  warehouse_name?: string;
  employee?: boolean;
  permissions?: string[];
  team_id?: string;
  team_name?: string;
};
type Order = {
  id: string;
  article: string;
  skus: string[];
  created_at: string;
  warehouse_id: string;
};
const views = ["admin", "dashboard", "orders", "stores", "subscription", "profile", "assembly", "supplies", "warehouses", "accounting", "access", "clients", "printing", "stocks", "ozon-marks"] as const;
type View = typeof views[number];
export function LiveRoot() {
  useEffect(()=>{const root=document.documentElement,wasDark=root.classList.contains("dark");root.classList.add("dark");return()=>{if(!wasDark)root.classList.remove("dark")}},[]);

  const [user, setUser] = useState<{
      admin?:{root:boolean;permissions:string[]};
      name: string;
      email: string;
      testPurchasesEnabled: boolean;
      employeeAccess?: {id:string;name:string;ownerName:string;permissions:string[]}[];
      subscription: { active: boolean; expires: number; limit: number; isTest?: boolean };
    } | null>(null),
    [loading, setLoading] = useState(true),
    [register, setRegister] = useState(location.hash === "#register");
  const [route, setRoute] = useState(location.hash);
  const [stores, setStores] = useState<Store[]>([]),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<View>("stores"),
    [collapsed, setCollapsed] = useState(
      () => window.matchMedia("(max-width: 960px)").matches,
    );
  const [marketFilter,setMarketFilter]=useState<'wb'|'ozon'>('wb');
  const marketChoice=useRef<'wb'|'ozon'|null>(null),lastMarketStore=useRef<Partial<Record<'wb'|'ozon',string>>>({});
  const [purchasePlan, setPurchasePlan] = useState<string | null>(null),
    [purchasing, setPurchasing] = useState(false);
  const [storeToEdit,setStoreToEdit]=useState<Store|null>(null),[replacementToken,setReplacementToken]=useState(''),[replacingKey,setReplacingKey]=useState(false),[keyError,setKeyError]=useState('');
  const [labelStore,setLabelStore]=useState<Store|null>(null),[labelName,setLabelName]=useState(''),[labelBusy,setLabelBusy]=useState(false),[labelError,setLabelError]=useState('');
  function editLabel(store:Store){setLabelStore(store);setLabelName(store.custom_name||'');setLabelError('');}
  const [storeToRemove,setStoreToRemove] = useState<Store|null>(null);
  const [removingStore,setRemovingStore] = useState(false);
  const [removeError,setRemoveError] = useState("");
  const [team,setTeam] = useState<string|undefined>();
  const viewContent = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!viewContent.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = viewContent.current.animate([{opacity:0.4},{opacity:1}], {
      duration:220, easing:"cubic-bezier(.2,.8,.2,1)",
    });
    return () => animation.cancel();
  }, [view, selected, team, loading, user?.email]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshNotification = useRef<{ id: string | number; storeId: string; lastSynced?: string | null } | null>(null);
  const [connectMarket,setConnectMarket]=useState<"wb"|"ozon">("wb"),[clientId,setClientId]=useState("");
  const [token, setToken] = useState(""),
    [connecting, setConnecting] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [result, setResult] = useState<{ orders: Order[]; total: number }>({
      orders: [],
      total: 0,
    });
  useEffect(() => {
    const query = window.matchMedia("(max-width: 960px)");
    const resize = () => setCollapsed(query.matches);
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  const loadStores = useCallback(async () => {
    const data = await liveApi("/stores");
    setStores(data.stores);
    setSelected((old) => data.stores.some((s:Store)=>s.id===old) ? old : (marketChoice.current?data.stores.find((s:Store)=>(s.marketplace||'wb')===marketChoice.current):(data.stores.find((s:Store)=>s.employee)||data.stores[0]))?.id || "");
    return data.stores as Store[];
  }, []);
  const authenticate = useCallback(async () => {
    const data = await liveApi("/me");
    const available = await loadStores();
    const saved = readSession<{view?: View; selected?: string; team?: string;market?:"wb"|"ozon"}>("supplyo-navigation-" + data.email);
    if (saved && views.includes(saved.view as View)) {
      setView(saved.view!);
      if(saved.market){marketChoice.current=saved.market;setMarketFilter(saved.market);if(!available.some(s=>s.id===saved.selected))setSelected(available.find(s=>(s.marketplace||'wb')===saved.market)?.id||'');}
      if (available.some(s => s.id === saved.selected)) setSelected(saved.selected!);
      setTeam(data.employeeAccess?.some((m: {id:string;permissions:string[]}) => m.id === saved.team && m.permissions.includes("manage")) ? saved.team : undefined);
    } else if (!data.subscription.active && data.employeeAccess?.length) {
      setSelected(available.find(s=>s.employee)?.id||"");setView("orders");
    }
    setUser(data);
  }, [loadStores]);
  useEffect(() => {
    void authenticate()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const hash = () => {
      setRegister(location.hash === "#register");
      setRoute(location.hash);
    };
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, [authenticate]);
  useEffect(() => {
    if (!user || loading) return;
    writeSession("supplyo-navigation-" + user.email, {view, selected, team,market:marketChoice.current||marketFilter});
  }, [user, loading, view, selected, team,marketFilter]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void Promise.all([loadStores(),liveApi("/me").then(data=>setUser(old=>JSON.stringify(old)===JSON.stringify(data)?old:data))]).catch(() => setError("Нет связи с сервером."));
    }, 3000);
    return () => clearInterval(timer);
  }, [user, loadStores]);
  const hasSubscription = !!user?.subscription.active;
  const currentPlan=({1:{id:'solo',name:'Соло'},5:{id:'start',name:'Старт'},25:{id:'business',name:'Бизнес'},50:{id:'pro',name:'Профи'}} as Record<number,{id:string;name:string}>)[user?.subscription.limit||0];
  const planName=currentPlan?.name||'Индивидуальный';
  const subscriptionDate=user?.subscription.expires?new Date(user.subscription.expires).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'';
  const usedCabinets=new Set(stores.map(s=>s.cabinet_id??s.id)).size;
  const hasEmployeeAccess=!!user?.employeeAccess?.length;
  const hasWmsAccess=hasSubscription||hasEmployeeAccess;
  const canManageTeam=!!team&&!!user?.employeeAccess?.some(m=>m.id===team&&m.permissions.includes("manage"));
  useEffect(() => {
    if (user && !hasWmsAccess && ["orders", "assembly", "supplies", "stocks", "clients", "warehouses", "accounting"].includes(view)) {
      setView("stores");
    }
  }, [user, hasWmsAccess, view]);
  const ownOzonStores=stores.filter(s=>s.marketplace==='ozon'&&!s.delegated&&!s.employee);
  const current = stores.find((store) => store.id === selected);
  const activeMarket=current?.marketplace|| (current?'wb':marketFilter);
  const marketStores=view==='ozon-marks'?ownOzonStores:stores.filter(s=>(s.marketplace||'wb')===activeMarket);
  useEffect(()=>{if(current){const market=current.marketplace||'wb';marketChoice.current=market;lastMarketStore.current[market]=current.id;setMarketFilter(market);}},[current?.id,current?.marketplace]);
  function switchMarket(market:'wb'|'ozon'){
    marketChoice.current=market;setMarketFilter(market);setSearch('');setPage(1);setResult({orders:[],total:0});setError('');
    const options=stores.filter(s=>(s.marketplace||'wb')===market);
    setSelected(options.find(s=>s.id===lastMarketStore.current[market])?.id||options[0]?.id||'');
  }
  useEffect(() => {
    if (error) toast.error(error, { id: "live-error", duration: 8000 });
  }, [error]);
  useEffect(() => {
    if (notice) toast.success(notice, { id: "live-notice" });
  }, [notice]);
  useEffect(() => {
    const pending = refreshNotification.current;
    if (!pending) return;
    const store = stores.find(s => s.id === pending.storeId);
    if (store?.status === "queued" && store.error) toast.loading(store.error, { id: pending.id });
    if (store?.status === "error") {
      toast.error("Не удалось обновить данные", { id: pending.id, duration: 8000 });
      refreshNotification.current = null;
    } else if (store?.last_synced && store.last_synced !== pending.lastSynced && store.status === "ready") {
      toast.success("Данные обновлены", { id: pending.id });
      refreshNotification.current = null;
    }
  }, [stores]);
  async function refreshStore() {
    setRefreshing(true);
    setError("");
    if (refreshNotification.current) toast.dismiss(refreshNotification.current.id);
    const id = toast.loading("Данные обновляются");
    refreshNotification.current = { id, storeId: selected, lastSynced: current?.last_synced };
    try {
      await liveApi(`/stores/${selected}/sync`, {});
      await loadStores();
    } catch (e) {
      toast.dismiss(id);
      refreshNotification.current = null;
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (!hasWmsAccess || !selected || view !== "orders" || current?.marketplace==='ozon') return;
    let active = true;
    const timer = setTimeout(() => {
      void liveApi(
        `/stores/${selected}/orders?page=${page}&search=${encodeURIComponent(search)}`,
      )
        .then((data) => {
          if (active) setResult(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selected, search, page, view, current?.last_synced, current?.marketplace, hasWmsAccess]);
  if (loading)
    return <main className="live-loading dark">Загружаем supply…</main>;
  if (!user && !["#login", "#register", "#app", "#account"].includes(route))
    return <Landing />;
  if (!user)
    return (
      <Auth
        key={String(register)}
        register={register}
        live
        onAuthenticated={authenticate}
      />
    );
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      const data = await liveApi("/stores", { token,marketplace:connectMarket,...(connectMarket==='ozon'?{clientId}: {}) });
      setToken("");setClientId("");
      setSelected(data.id);
      setNotice(hasSubscription
        ? `Проверяем ключ и загружаем заказы из ${connectMarket==='ozon'?'Ozon':'WB'}.`
        : "Проверяем API-ключ и подключаем магазин.");
      await loadStores();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  return (
    <div className={`live-shell dark ${collapsed ? "live-collapsed" : ""}`}>
      <Dialog open={!!labelStore} onOpenChange={open=>{if(!open&&!labelBusy)setLabelStore(null)}}><DialogContent className="live-client-name-dialog"><form onSubmit={async e=>{e.preventDefault();if(!labelStore||labelBusy)return;setLabelBusy(true);setLabelError('');try{await liveApi('/stores/'+labelStore.id+'/display-name',{name:labelName});await loadStores();setLabelStore(null);toast.success('Название клиента сохранено')}catch(e){setLabelError((e as Error).message)}finally{setLabelBusy(false)}}}><DialogHeader><DialogTitle>Название клиента</DialogTitle><DialogDescription>Название видно только в вашем аккаунте. Пустое поле вернёт название из Ozon.</DialogDescription></DialogHeader><div className="live-client-name-field"><label htmlFor="client-display-name">Клиент / магазин</label><Input autoFocus id="client-display-name" maxLength={150} disabled={labelBusy} placeholder="Например, ИП Филиппов" value={labelName} onChange={e=>setLabelName(e.target.value)}/><small className="live-label-original">Исходное название: {labelStore?.original_name||labelStore?.name}</small></div>{labelError&&<p role="alert" className="live-error">{labelError}</p>}<DialogFooter><Button type="button" variant="secondary" disabled={labelBusy} onClick={()=>setLabelStore(null)}>Отмена</Button><Button type="submit" disabled={labelBusy}>{labelBusy?'Сохраняем…':'Сохранить'}</Button></DialogFooter></form></DialogContent></Dialog>
      <Dialog open={!!storeToEdit} onOpenChange={open=>{if(!open&&!replacingKey){setStoreToEdit(null);setReplacementToken('');setKeyError('');}}}>
        <DialogContent onInteractOutside={e=>{if(replacingKey)e.preventDefault();}} onEscapeKeyDown={e=>{if(replacingKey)e.preventDefault();}}>
          <DialogHeader><DialogTitle>Заменить API-ключ</DialogTitle><DialogDescription>{storeToEdit?.name}. Новый ключ должен принадлежать тому же магазину. История, остатки и доступы сохранятся.</DialogDescription></DialogHeader>
          <form className="live-key-form" onSubmit={async e=>{e.preventDefault();if(!storeToEdit||replacingKey)return;setReplacingKey(true);setKeyError('');try{const d=await liveApi('/stores/'+storeToEdit.id+'/credential',{token:replacementToken.trim()});setStoreToEdit(null);setReplacementToken('');setNotice(d.unchanged?'Этот ключ уже используется магазином.':'API-ключ заменён. Данные магазина обновляются.');void loadStores().catch(()=>setError('Ключ сохранён, но список магазинов не обновился. Обновите страницу.'));}catch(e){setKeyError((e as Error).message);}finally{setReplacingKey(false);}}}>
            <label htmlFor="replacement-token">Новый API-ключ {storeToEdit?.marketplace==='ozon'?'Ozon':'Wildberries'}</label><Input id="replacement-token" type="password" autoComplete="off" maxLength={16000} value={replacementToken} disabled={replacingKey} onChange={e=>setReplacementToken(e.target.value)} placeholder="Вставьте новый API-ключ"/>
            {keyError&&<p className="live-error" role="alert">{keyError}</p>}
            <DialogFooter><Button type="button" variant="secondary" disabled={replacingKey} onClick={()=>{setStoreToEdit(null);setReplacementToken('');setKeyError('');}}>Отмена</Button><Button type="submit" disabled={replacingKey||replacementToken.trim().length<20}>{replacingKey?'Проверяем ключ…':'Проверить и заменить'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <aside className="live-sidebar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("dashboard");
          }}
          className="live-logo"
          aria-label="supply — главная"
        >
          <img src={`${import.meta.env.BASE_URL}brand-logo.png?v=20261110-2`} alt="supply" />
        </a>
        <nav aria-label="Разделы ВМС">
          {(
            [
              ["Новые заказы", Package, "orders"],
              ["Сборка", ScanLine, "assembly"],
              ["Поставки", Truck, "supplies"],
              ["Остатки", Boxes, "stocks"],
            ] as const
          ).map(([label, Icon, key]) => {
            const permission=key==="assembly"?"assembly":"view";
            const permitted=hasSubscription||stores.some(s=>s.employee&&s.permissions?.includes(permission));
            const available = permitted||(key==='supplies'&&ownOzonStores.length>0);
            return (
              <Tooltip.Provider key={key} delayDuration={180}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span
                      className="live-nav-slot"
                      tabIndex={available ? -1 : 0}
                    >
                      <button
                        aria-label={label}
                        aria-disabled={!available}
                        className={view === key||(key==='supplies'&&view==='ozon-marks') ? "selected" : ""}
                        onClick={() => {
                          if (available) {
                            if(key==='supplies'&&!permitted&&ownOzonStores.length){setSelected(ownOzonStores[0].id);setView('ozon-marks');return;}
                            if((!hasSubscription&&!current?.employee)||(current?.permissions&&!current.permissions.includes(permission))){const allowed=stores.find(s=>s.permissions?.includes(permission));if(allowed)setSelected(allowed.id)}
                            setView(key);
                          }
                        }}
                      >
                        <Icon size={19} />
                        <span className="live-nav-label">{label}</span>
                      </button>
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="subscription-tooltip"
                      side="right"
                      sideOffset={12}
                    >
                      {!hasWmsAccess&&!(key==='supplies'&&ownOzonStores.length)
                        ? "Нет доступа. Для работы в ВМС подключите подписку."
                        : !permitted&&!(key==='supplies'&&ownOzonStores.length) ? "Нет прав на этот раздел. Обратитесь к администратору склада." : available ? label : "Раздел ещё не подключён к серверу."}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            );
          })}
        </nav>
        <div className="live-bottom">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={
                  ["stores", "subscription", "access", "clients", "printing"].includes(view) ? "selected" : ""
                }
                aria-label="Настройки"
              >
                <Settings size={19} />
                <span className="live-nav-label">Настройки</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="profile-menu dark"
                side="right"
                align="end"
                sideOffset={16}
              >
                <DropdownMenu.Item
                  className="profile-menu-item"
                  onSelect={() => setView("stores")}
                >
                  <Boxes size={16} />
                  Магазины
                </DropdownMenu.Item>
                <DropdownMenu.Item className="profile-menu-item" onSelect={()=>setView("access")}><KeyRound size={16}/>Доступ фулфилменту</DropdownMenu.Item>
                {hasSubscription && <DropdownMenu.Item className="profile-menu-item" onSelect={()=>setView("clients")}><UserRoundPlus size={16}/>Клиенты</DropdownMenu.Item>}
                <DropdownMenu.Item className="profile-menu-item" onSelect={()=>setView("printing")}><Printer size={16}/>Печать этикеток</DropdownMenu.Item>
                <DropdownMenu.Item
                  className="profile-menu-item"
                  onSelect={() => setView("subscription")}
                >
                  <CreditCard size={16} />
                  Подписка
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="live-profile" aria-label="Меню профиля">
                <span className="live-avatar">{user.name.slice(0, 1)}</span>
                  <span className="live-profile-info">
                    <strong>Мой аккаунт</strong>
                    <small>{user.email}</small>
                  </span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="profile-menu dark"
                side="right"
                align="end"
                sideOffset={16}
              >
                {hasSubscription && <>
                  <DropdownMenu.Item className="profile-menu-item" onSelect={()=>{setTeam(undefined);setView("warehouses")}}><Warehouse size={16}/>Склады и сотрудники</DropdownMenu.Item>
                  <DropdownMenu.Item className="profile-menu-item" onSelect={()=>setView("accounting")}><Calculator size={16}/>Учёт</DropdownMenu.Item>
                  <DropdownMenu.Separator className="profile-menu-separator"/>
                </>}
                {user.employeeAccess?.filter(m=>m.permissions.includes("manage")).map(m=><DropdownMenu.Item key={m.id} className="profile-menu-item" onSelect={()=>{setTeam(m.id);setView("warehouses")}}><Warehouse size={16}/>{m.name} · сотрудники</DropdownMenu.Item>)}
                {!!user.admin?.permissions.length&&<DropdownMenu.Item className="profile-menu-item" onSelect={()=>setView("admin")}><Settings size={16}/>Админ-панель</DropdownMenu.Item>}
                <DropdownMenu.Item
                  className="profile-menu-item"
                  onSelect={() => setView("profile")}
                >
                  <UserRound size={16} />
                  Профиль
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="profile-menu-item"
                  onSelect={async () => {
                    await liveApi("/auth/logout", {});
                    setUser(null);
                    setStores([]);
                    setSelected("");
                    setResult({ orders: [], total: 0 });
                    location.hash = "login";
                  }}
                >
                  <LogOut size={16} />
                  Выйти
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </aside>
      <button
        className="live-toggle"
        aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
      <div className="live-main">
        <header>
          Рабочее пространство <span>WMS</span>
        </header>
        <main ref={viewContent}>
          <Toaster theme="dark" position="bottom-right" closeButton visibleToasts={3}
            toastOptions={{ className: "live-toast", duration: 4500 }} />
          <Dialog open={!!storeToRemove} onOpenChange={open=>{if(!open&&!removingStore)setStoreToRemove(null)}}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Удалить магазин?</DialogTitle>
                <DialogDescription>{storeToRemove?.name}. Отключим магазин от supply, остановим обновление и отзовём связанные доступы. История поставок и учёт сохранятся.</DialogDescription>
              </DialogHeader>
              {removeError&&<p role="alert" className="text-destructive">{removeError}</p>}
              <DialogFooter>
                <Button variant="outline" disabled={removingStore} onClick={()=>setStoreToRemove(null)}>Отменить</Button>
                <Button variant="destructive" disabled={removingStore} onClick={async()=>{
                  if(!storeToRemove||removingStore)return;
                  setRemovingStore(true);setRemoveError("");
                  try {
                    await liveApi(`/stores/${storeToRemove.id}/remove`,{confirm:true});
                    if(refreshNotification.current?.storeId===storeToRemove.id){toast.dismiss(refreshNotification.current.id);refreshNotification.current=null;}
                    await loadStores();setStoreToRemove(null);toast.success("Магазин удалён");
                  } catch(e){setRemoveError((e as Error).message);}
                  finally{setRemovingStore(false);}
                }}>{removingStore?"Удаляем…":"Удалить магазин"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={purchasePlan !== null}
            onOpenChange={(open) => {
              if (!open && !purchasing) setPurchasePlan(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Тестовая покупка подписки</DialogTitle>
                <DialogDescription>
                  Активировать тариф «
                  {
                    {
                      solo: "Соло",
                      start: "Старт",
                      business: "Бизнес",
                      pro: "Профи",
                    }[purchasePlan ?? ""]
                  }
                  » на 30 дней? Деньги не списываются. После активации можно
                  подключить настоящий API-ключ WB.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={purchasing}
                  onClick={() => setPurchasePlan(null)}
                >
                  Отменить
                </Button>
                <Button
                  disabled={purchasing}
                  onClick={async () => {
                    if (purchasing || !purchasePlan) return;
                    setPurchasing(true);
                    setError("");
                    try {
                      await liveApi("/subscription/test-purchase", {
                        plan: purchasePlan,
                      });
                      await authenticate();
                      setPurchasePlan(null);
                      setView("stores");
                      setNotice(
                        "Тестовая подписка активна. Подключите магазин Wildberries.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                      setPurchasePlan(null);
                    } finally {
                      setPurchasing(false);
                    }
                  }}
                >
                  {purchasing ? "Активируем…" : "Активировать без оплаты"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {error && (
            <div className="live-error" role="alert">
              {error}
              <button aria-label="Закрыть" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {(hasWmsAccess||view==='ozon-marks') && stores.length > 0 &&
            ["orders", "assembly", "supplies", "stocks", "ozon-marks"].includes(view) && (
              <div className="live-picker">
                {view!=='ozon-marks'&&<div className="market-toggle" role="group" aria-label="Маркетплейс">{(['wb','ozon'] as const).map(m=><button type="button" key={m} aria-pressed={activeMarket===m} onClick={()=>switchMarket(m)}>{m==='wb'?'WB':'Ozon'}</button>)}</div>}
                <label htmlFor="active-store">Кабинет</label>
                <div className="live-cabinet-control"><select
                  id="active-store"
                  disabled={!marketStores.length}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {!marketStores.length&&<option value="">Нет подключённых магазинов</option>}
                  {marketStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.delegated?" · "+s.warehouse_name:""}
                    </option>
                  ))}
                </select>{current?.marketplace==='ozon'&&!current.employee&&<Button variant="ghost" size="icon" aria-label="Изменить название клиента" title="Изменить название клиента" onClick={()=>editLabel(current)}><Pencil size={16}/></Button>}</div>
                {view !== "stocks"&&view!=="ozon-marks" && <><span className="live-last">
                  {!selected?"":current?.status === "error"
                      ? current.error || "Не удалось обновить данные"
                    : current?.last_synced
                      ? `Обновлено ${new Date(current.last_synced).toLocaleString("ru-RU")}`
                      : "Ожидаем загрузку"}
                </span>
                <Button
                  variant="secondary"
                  disabled={refreshing || !selected}
                  onClick={() => void refreshStore()}
                >
                  <RefreshCw size={16} />
                  Обновить
                </Button></>}
              </div>
            )}
          {(view==='ozon-marks'||view==='supplies')&&current?.marketplace==='ozon'&&!current.delegated&&!current.employee&&<nav className="ozon-marks-tabs" aria-label="Разделы поставок Ozon">{hasWmsAccess&&<Button variant={view==='supplies'?'default':'ghost'} onClick={()=>setView('supplies')}>Отгрузки</Button>}<Button variant={view==='ozon-marks'?'default':'ghost'} onClick={()=>setView('ozon-marks')}>КИЗ</Button></nav>}
          {view==='ozon-marks'?(current?.marketplace==='ozon'&&!current.delegated&&!current.employee?<Suspense fallback={<p role="status">Загружаем КИЗ…</p>}><OzonClientMarks key={selected} storeId={selected}/></Suspense>:<section className="live-card"><h1>Коды маркировки Ozon</h1><p>Выберите свой магазин Ozon.</p>{ownOzonStores.map(s=><Button key={s.id} onClick={()=>setSelected(s.id)}>{s.name}</Button>)}</section>):hasWmsAccess&&!selected&&['orders','assembly','supplies','stocks'].includes(view)?<section className="live-card live-market-empty"><h1>{activeMarket==='ozon'?'Ozon':'Wildberries'}</h1><p>Нет подключённых магазинов {activeMarket==='ozon'?'Ozon':'Wildberries'}.</p><Button onClick={()=>{setConnectMarket(activeMarket);setView('stores');}}>Подключить магазин</Button></section>:view === "dashboard" ? (
            <Suspense fallback={<p role="status">Загружаем обзор…</p>}><LiveDashboard /></Suspense>
          ) : current?.marketplace==='ozon'&&hasWmsAccess&&selected&&['orders','assembly','supplies'].includes(view) ? (
            view==='assembly'?<Suspense fallback={<p role="status">Загружаем сборку…</p>}><OzonAssembly key={selected} storeId={selected} version={current.last_synced||''} permissions={current.permissions}/></Suspense>:view==='orders'?<Suspense fallback={<p role="status">Загружаем Ozon…</p>}><OzonOrders key={selected} permissions={current.permissions} storeId={selected} account={user.email} version={current.last_synced||''}/></Suspense>:<Suspense fallback={<p role="status">Загружаем отгрузки…</p>}><OzonOrders key={selected+'deliveries'} deliveries permissions={current.permissions} storeId={selected} account={user.email} version={current.last_synced||''}/></Suspense>
          ) : view === "stocks" && hasWmsAccess ? (
            <Suspense fallback={<p role="status">Загружаем остатки…</p>}><LiveStocks key={selected} storeId={selected||undefined} marketplace={current?.marketplace}/></Suspense>
          ) : (view === "assembly" || view === "supplies" || view === "orders") &&
          hasWmsAccess &&
          selected ? (
            <Fulfillment
              accountKey={user.email}
              permissions={current?.permissions}
              storeId={selected}
              key={selected}
              storeVersion={current?.last_synced ?? ""}
              mode={view}
              onMode={setView}
            />
          ) : view === "printing" ? (
            <div className="live-print-settings"><Suspense fallback={<p role="status">Загружаем настройки печати…</p>}><PrintAgentSettings /></Suspense></div>
          ) : (view === "access" || (view === "clients" && hasSubscription)) ? (
            <Suspense fallback={<p role="status">Загружаем раздел…</p>}><AccessSettings key={view} mode={view as "access"|"clients"} stores={stores} onStoresChanged={async()=>{await loadStores()}} onOpen={id=>{setSelected(id);setView("orders")}} /></Suspense>
          ) : (view === "warehouses" || view === "accounting") && (hasSubscription || (view==="warehouses" && canManageTeam)) ? (
            <Suspense fallback={<p role="status">Загружаем раздел…</p>}><LiveWorkspace key={user.email+":"+view+":"+team} section={view} team={view==="warehouses"?team:undefined} /></Suspense>
          ) : view === "admin" ? (
            user.admin?.permissions.length?<Suspense fallback={<p>Загружаем админ-панель…</p>}><PlatformAdmin access={user.admin}/></Suspense>:<p>Нет доступа к админ-панели.</p>
          ) : view === "profile" ? (
            <section className="live-card live-account">
              <h1>Об аккаунте</h1>
              <div className="live-detail">
                <span>ФИО</span>
                <strong>{user.name}</strong>
              </div>
              <div className="live-detail">
                <span>Электронная почта</span>
                <strong>{user.email}</strong>
              </div>
              {user.employeeAccess?.map(m=><div className="live-detail" key={m.id}><span>Доступ к складу</span><strong>{m.name} · по подписке организации</strong></div>)}
              <ChangePassword/>
              <h2>Моя подписка</h2>
              {user.subscription.limit>0&&<div className="live-detail"><span>Тариф</span><strong>{planName}{user.subscription.isTest?' · тестовая подписка':''}</strong></div>}
              <div className="live-detail"><span>Статус</span><strong>{hasSubscription?'Активна':user.subscription.expires?'Истекла':'Не подключена'}</strong></div>
              {!!subscriptionDate&&<div className="live-detail"><span>{hasSubscription?'Действует до':'Действовала до'}</span><strong>{subscriptionDate}</strong></div>}
              {user.subscription.limit>0&&<div className="live-detail"><span>Кабинеты</span><strong>{usedCabinets} из {user.subscription.limit}</strong></div>}
              <Button onClick={() => setView("subscription")}>
                {hasSubscription ? "Моя подписка" : "Выбрать подписку"}
              </Button>
            </section>
          ) : view === "subscription" ? (
            <>
              <h1>Подписка</h1>
              <section className="live-card">
                <h2>
                  {hasSubscription ? `Ваш тариф — ${planName}` : user.subscription.expires ? "Подписка истекла" : "Выберите подписку"}
                </h2>
                <p>
                  {hasSubscription
                    ? `${user.subscription.isTest?'Тестовая подписка активна. ':'Подписка активна. '}Кабинеты: ${usedCabinets} из ${user.subscription.limit}. Действует до ${subscriptionDate}.`
                    : "Магазин можно подключить без подписки. Работа с заказами доступна после её активации."}
                </p>
              </section>
              <div className="live-plan-grid">
                {[
                  ["Соло", "1 кабинет", "1 990", "solo"],
                  ["Старт", "До 5 кабинетов", "4 990", "start"],
                  ["Бизнес", "До 25 кабинетов", "8 990", "business"],
                  ["Профи", "До 50 кабинетов", "14 990", "pro"],
                ].map(([name, limit, price, id]) => (
                  <section className={`live-card${hasSubscription&&currentPlan?.id===id?' live-current-plan':''}`} key={name}>
                    <div className="live-plan-heading"><h2>{name}</h2>{hasSubscription&&currentPlan?.id===id&&<span className="live-plan-badge">Ваш тариф</span>}</div>
                    <p>{limit}</p>
                    <strong>{price} ₽ / месяц</strong>
                    {(user.testPurchasesEnabled||hasSubscription&&currentPlan?.id===id)&&<footer><Button disabled={hasSubscription&&currentPlan?.id===id} variant={hasSubscription&&currentPlan?.id===id?'secondary':'default'} onClick={()=>setPurchasePlan(id)}>{hasSubscription&&currentPlan?.id===id?'Текущий тариф':'Попробовать тариф'}</Button></footer>}
                  </section>
                ))}
              </div>
              <p className="live-subtitle">
                {user.testPurchasesEnabled
                  ? "Тестовая покупка: без оплаты и списания денег. Подписка активируется на 30 дней для проверки подключения WB."
                  : "Оплата пока не подключена."}
              </p>
            </>
          ) : view === "stores" ? (
            <>
              <h1>Магазины</h1>
              <p className="live-subtitle">
                Подключите свой магазин Wildberries или Ozon.
              </p>
              <div className="live-store-grid">
                {stores.filter(s=>!s.delegated).map((store) => (
                  <section className="live-card" key={store.id}>
                    <div className="live-store-heading">
                      <Boxes size={21} />
                      <h2>{store.name}</h2>
                      <span>{store.marketplace==='ozon'?'Ozon':'Wildberries'}</span>
                    </div>
                    <p className="live-store-status">
                      {{
                        pending: "Ожидает подключения",
                        syncing: "Данные обновляются…",
                        queued: "Ожидает повторного запроса",
                        ready: "Подключён",
                        error: "Требуется проверка ключа",
                      }[store.status] || store.status}
                    </p>
                    {store.error && <p role="status">{store.error}</p>}
                    <small>
                      {store.last_synced
                        ? `Обновлено ${new Date(store.last_synced).toLocaleString("ru-RU")}`
                        : store.status === "ready"
                          ? "API-ключ проверен"
                          : "Проверяем подключение"}
                    </small>
                    <footer>
                      <Button
                        variant="secondary"
                        disabled={!hasSubscription}
                        onClick={() => {
                          setSelected(store.id);
                          setSearch("");
                          setPage(1);
                          setView("orders");
                        }}
                      >
                        Открыть заказы
                      </Button>
                      {store.marketplace==='ozon'&&!store.employee&&<Button variant="secondary" onClick={()=>editLabel(store)}><Pencil size={16}/>Название клиента</Button>}
                      {store.marketplace==='ozon'&&!store.employee&&<Button variant="secondary" onClick={()=>{setSelected(store.id);setView('ozon-marks')}}>КИЗ Ozon</Button>}
                      <Button variant="secondary" onClick={()=>setView("access")}><KeyRound size={16}/>Выдать доступ</Button>
                      <Button variant="secondary" onClick={()=>{setStoreToEdit(store);setReplacementToken('');setKeyError('');}}><KeyRound size={16}/>Заменить ключ</Button>
                      <Button variant="ghost" className="live-store-remove" aria-label={"Удалить магазин "+store.name} onClick={()=>{setRemoveError("");setStoreToRemove(store)}}><Trash2 size={16}/>Удалить</Button>
                    </footer>
                  </section>
                ))}
              </div>
                <section className="live-card live-connect">
                  <h2>
                    <Plus size={19} />
                    Подключить магазин
                  </h2>
                  <p>
                    {connectMarket==='ozon'?'Укажите Client ID и API-ключ Ozon с доступом к информации о кабинете, складам, FBS-заказам и их сборке. Название магазина загрузится из Ozon.':'Вставьте персональный API-ключ WB с доступом к заказам FBS. Название магазина загрузится из WB.'}
                  </p>
                  <form onSubmit={connect}>
                    <label htmlFor="connect-market">Маркетплейс</label><select id="connect-market" disabled={connecting} value={connectMarket} onChange={e=>{setConnectMarket(e.target.value as 'wb'|'ozon');setToken('');setClientId('');setNotice('');}}><option value="wb">Wildberries</option><option value="ozon">Ozon</option></select>
                    {connectMarket==='ozon'&&<><label htmlFor="ozon-client-id">Client ID Ozon</label><Input id="ozon-client-id" inputMode="numeric" autoComplete="off" maxLength={30} disabled={connecting} value={clientId} onChange={e=>setClientId(e.target.value.replace(/\D/g,''))} placeholder="Client ID из кабинета Ozon"/></>}
                    <label htmlFor="live-token">API-ключ {connectMarket==='ozon'?'Ozon':'Wildberries'}</label>
                    <Input
                      id="live-token"
                      disabled={connecting}
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Вставьте API-ключ"
                      maxLength={16000}
                    />
                    <Button
                      type="submit"
                      disabled={connecting || token.trim().length < 20 || connectMarket==='ozon'&&!clientId.trim()}
                    >
                      {connecting ? "Подключаем…" : "Подключить магазин"}
                    </Button>
                  </form>
                  {connectMarket==='ozon'&&<p className="text-sm text-muted-foreground"><a href="https://docs.ozon.ru/api/seller/" target="_blank" rel="noreferrer">Где взять Client ID и API-ключ Ozon</a></p>}
                  {notice && <p role="status">{notice}</p>}
                  {!hasSubscription && (
                    <div className="mt-5">
                      <p>Подключение магазина доступно без подписки. Для работы с заказами и сборкой выберите подписку.</p>
                      <Button variant="secondary" onClick={() => setView("subscription")}>
                        Выбрать подписку
                      </Button>
                    </div>
                  )}
                </section>
            </>
          ) : (
            <>
              <div className="live-picker">
                <label htmlFor="live-store">Кабинет</label>
                <select
                  id="live-store"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setSearch("");
                    setPage(1);
                    setResult({ orders: [], total: 0 });
                  }}
                  disabled={!stores.length}
                >
                  <option value="" disabled>
                    Подключите магазин
                  </option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="live-last">
                  {refreshing || current?.status === "syncing"
                    ? "Данные обновляются…"
                    : current?.status === "queued" ||
                        current?.status === "pending"
                      ? Number(current.next_sync) > Date.now()
                        ? `Обновление в очереди до ${new Date(Number(current.next_sync)).toLocaleTimeString("ru-RU")}`
                        : "Обновление в очереди…"
                      : current?.status === "error"
                        ? "Не удалось обновить данные"
                        : current?.last_synced
                          ? `Данные обновлены ${new Date(current.last_synced).toLocaleString("ru-RU")}`
                          : ""}
                </span>
                <Button
                  variant="secondary"
                  disabled={
                    !selected ||
                    refreshing ||
                    ["syncing", "queued", "pending"].includes(
                      current?.status ?? "",
                    )
                  }
                  onClick={() => void refreshStore()}
                >
                  <RefreshCw size={16} />
                  Обновить
                </Button>
              </div>
              <section className="live-card live-orders">
                <h1>Новые заказы</h1>
                {!stores.length ? (
                  <div className="live-empty">
                    <Package size={30} />
                    <p>Подключите первый магазин Wildberries или Ozon.</p>
                    <Button onClick={() => setView("stores")}>
                      Подключить магазин
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      aria-label="Поиск заказа"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Номер заказа, артикул или баркод"
                    />
                    <div className="live-table-wrap">
                      <table
                        className={
                          result.orders.length ? undefined : "live-table-empty"
                        }
                      >
                        <thead>
                          <tr>
                            <th>Номер заказа</th>
                            <th>Артикул продавца</th>
                            <th>Баркоды</th>
                            <th>Склад WB, ID</th>
                            <th>Дата и время</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.orders.map((o) => (
                            <tr key={o.id}>
                              <td>{o.id}</td>
                              <td>{o.article || "—"}</td>
                              <td>
                                {o.skus.map((code) => (
                                  <div key={code}>{code}</div>
                                ))}
                              </td>
                              <td>{o.warehouse_id || "—"}</td>
                              <td>
                                {new Date(o.created_at).toLocaleString("ru-RU")}
                              </td>
                            </tr>
                          ))}
                          {!result.orders.length && (
                            <tr>
                              <td colSpan={5} className="live-empty">
                                {current?.last_synced
                                  ? "Новых заказов по этому запросу нет"
                                  : "Ждём первую загрузку заказов"}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {current?.error && <p role="status">{current.error}</p>}
                    <footer>
                      {result.total > 50 && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={page === 1}
                            onClick={() => setPage(page - 1)}
                          >
                            Назад
                          </Button>
                          <span>Страница {page}</span>
                          <Button
                            variant="secondary"
                            disabled={page * 50 >= result.total}
                            onClick={() => setPage(page + 1)}
                          >
                            Далее
                          </Button>
                        </>
                      )}
                    </footer>
                  </>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
