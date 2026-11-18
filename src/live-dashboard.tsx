import { useEffect, useState } from "react";
import { Package, ScanLine, Boxes, Warehouse } from "lucide-react";
import "./live-dashboard.css";

type WarehouseSummary = {
  marketplace?: string;ozon_ready?:number;ozon_total?:number;
  store_id: string;
  warehouse_id: string;
  warehouse_name: string;
  store_name: string;
  fulfillments: string[];
  last_synced: string | null;
  new_orders: number;
  assembly_orders: number;
  ready_orders: number;
  supplies_count: number;
};

export function LiveDashboard() {
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/dashboard", { credentials: "same-origin" });
        if (!response.ok) throw Error("Не удалось загрузить обзор складов.");
        const data = await response.json();
        if (active) { setWarehouses(data.warehouses); setError(""); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="live-dashboard">
    <h1>Обзор</h1>
    <p className="live-subtitle">Подключённые склады</p>
    {error && <p className="live-error" role="alert">{error}</p>}
    {loading ? <p role="status">Загружаем склады…</p> : warehouses.length === 0 ? (
      <section className="live-card dashboard-empty"><Warehouse size={28} aria-hidden="true" /><h2>Нет подключённых складов</h2></section>
    ) : <div className="dashboard-warehouses">{warehouses.map(warehouse => {
      const fulfillments = warehouse.fulfillments.map(name => name.trim()).filter(Boolean);
      return (
      <section className="live-card dashboard-warehouse" key={warehouse.store_id+":"+warehouse.warehouse_id}>
        <div className="dashboard-warehouse-heading"><Warehouse size={20} aria-hidden="true" /><div><h2>{warehouse.store_name}</h2><p>{warehouse.marketplace==='ozon'?'Ozon · ':''}{warehouse.warehouse_name}</p></div></div>
        {fulfillments.length > 0 && <p className="dashboard-fulfillments">Фулфилмент: {fulfillments.join(", ")}</p>}
        <dl className="dashboard-metrics">
          <div><dt><Package size={16} aria-hidden="true" />{warehouse.marketplace==='ozon'?'К сборке':'Новые заказы'}</dt><dd>{warehouse.new_orders}</dd></div>
          <div><dt><ScanLine size={16} aria-hidden="true" />{warehouse.marketplace==='ozon'?'К отгрузке':'На сборке'}</dt><dd>{warehouse.marketplace==='ozon'?warehouse.ozon_ready:warehouse.assembly_orders}</dd>{warehouse.marketplace!=='ozon'&&<small>Готово {warehouse.ready_orders} из {warehouse.assembly_orders}</small>}</div>
          <div><dt><Boxes size={16} aria-hidden="true" />{warehouse.marketplace==='ozon'?'Отправлений':'Количество поставок'}</dt><dd>{warehouse.marketplace==='ozon'?warehouse.ozon_total:warehouse.supplies_count}</dd></div>
        </dl>
        <footer>{warehouse.last_synced ? `Обновлено ${new Date(warehouse.last_synced).toLocaleString("ru-RU")}` : "Ожидаем загрузку данных"}</footer>
      </section>
    );})}</div>}
  </div>;
}
