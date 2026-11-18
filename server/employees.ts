import type { Database } from "./database.ts";
import type { Access, ScopedStore } from "./access.ts";

export type WarehouseBinding = {storeId:string;warehouseId:string};
export type TeamWarehouse = {id:string;name:string;city:string;address:string;staff:string[];staffRights?:Record<string,string[]>;wmsScopes?:WarehouseBinding[]};
export type Membership = {id:string;ownerId:string;ownerName:string;warehouse:TeamWarehouse;permissions:string[];warehouseCount:number};
const encode=(parts:string[])=>Buffer.from(JSON.stringify(parts)).toString("base64url");
function decode(value:string):string[]{try{const parts=JSON.parse(Buffer.from(value,"base64url").toString());return Array.isArray(parts)&&parts.every(p=>typeof p==="string")?parts:[]}catch{return []}}
const rights=["view","assembly","supplies","stocks","manage"];

/** Membership is resolved from the saved warehouse on every request: no copied subscription or stale grants. */
export function createEmployees(db:Database,access:Access,getWarehouses:(s:ScopedStore)=>Promise<{id:string;name:string}[]>) {
  async function memberships(uid:string|null):Promise<Membership[]> {
    if(!uid)return [];
    const rows=(await db.query<{user_id:string;name:string;email:string;data:TeamWarehouse[]}>(`SELECT d.user_id,o.name,e.email,d.data FROM workspace_documents d
      JOIN users o ON o.id=d.user_id JOIN subscriptions sub ON sub.user_id=o.id JOIN users e ON e.id=$1
      WHERE d.kind='warehouses' AND d.user_id<>$1 AND sub.expires>$2 AND sub.cabinet_limit>0
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.data) w,jsonb_array_elements_text(w->'staff') AS staff_email(value) WHERE lower(staff_email.value)=lower(e.email))`,[uid,Date.now()])).rows;
    return rows.flatMap(row=>row.data.flatMap(warehouse=>{
      const email=warehouse.staff.find(email=>email.toLowerCase()===row.email.toLowerCase());
      if(!email)return [];
      const permissions=(warehouse.staffRights?.[email]||["view"]).filter(p=>rights.includes(p));
      return permissions.length?[{id:encode([row.user_id,warehouse.id]),ownerId:row.user_id,ownerName:row.name,warehouse,permissions,warehouseCount:row.data.length}]:[];
    }));
  }
  async function sources(ownerId:string) {
    const own=(await db.query<ScopedStore>("SELECT * FROM stores WHERE user_id=$1 AND status<>'removed'",[ownerId])).rows;
    const shared=(await db.query<ScopedStore & {route_id:string}>(`SELECT s.*,a.id route_id,a.warehouse_id scope,a.warehouse_name FROM client_access a JOIN stores s ON s.id=a.store_id
      WHERE a.fulfillment_id=$1 AND a.revoked IS NULL AND s.status<>'removed'`,[ownerId])).rows;
    return [...own.map(s=>({...s,route_id:s.id})),...shared];
  }
  async function bindings(member:Membership) {
    const stores=await sources(member.ownerId);
    if(member.warehouse.wmsScopes!==undefined) {
      return member.warehouse.wmsScopes.flatMap(binding=>{
        const store=stores.find(s=>s.route_id===binding.storeId);
        return store&&(!store.scope||store.scope===binding.warehouseId)?[{store,warehouseId:binding.warehouseId,name:store.warehouse_name||member.warehouse.name}]:[];
      });
    }
    // Legacy single-warehouse teams inherit each client grant within its own WB scope.
    // Source count must not revoke existing membership when another client is connected.
    // Own stores and ambiguous multi-warehouse teams still require explicit assignment.
    if(member.warehouseCount===1)
      return stores.flatMap(store=>store.scope?[{store,warehouseId:store.scope,name:store.warehouse_name||member.warehouse.name}]:[]);
    return [];
  }
  async function list(uid:string|null) {
    const result=[];
    for(const member of await memberships(uid))for(const binding of await bindings(member)) {
      const s=binding.store;
      result.push({id:"staff."+encode([member.id,s.route_id,binding.warehouseId]),cabinet_id:s.id,marketplace:s.marketplace,name:s.name,status:s.status,last_synced:s.last_synced,error:s.error,next_sync:s.next_sync,
        delegated:true,employee:true,warehouse_name:binding.name,team_id:member.id,team_name:member.warehouse.name,permissions:member.permissions});
    }
    return result;
  }
  access.setEmployeeResolver(async(uid,id)=>{
    const [memberId,storeId,warehouseId]=decode(id.slice(6));
    const member=(await memberships(uid)).find(m=>m.id===memberId);
    if(!member)return;
    const binding=(await bindings(member)).find(b=>b.store.route_id===storeId&&b.warehouseId===warehouseId);
    if(!binding)return;
    return {...binding.store,scope:warehouseId,warehouse_name:binding.name,permissions:member.permissions,employee:true};
  });
  async function options(uid:string) {
    const result=[];
    for(const s of await sources(uid)) {
      try{for(const w of s.scope?[{id:s.scope,name:s.warehouse_name!}]:await getWarehouses(s))result.push({storeId:s.route_id,warehouseId:w.id,label:(s.marketplace==='ozon'?'Ozon · ':'')+s.name+" · "+w.name,defaultAssigned:!!s.scope})}catch{/* Unverified/temporarily unavailable stores cannot be assigned. */}
    }
    return result;
  }
  async function dashboardScopes(uid:string|null) {
    const result=[];
    for(const member of await memberships(uid)) {
      if(!member.permissions.includes("view"))continue;
      for(const binding of await bindings(member))result.push({store_id:binding.store.id,warehouse_id:binding.warehouseId,warehouse_name:binding.name});
    }
    return result;
  }
  return {memberships,list,options,dashboardScopes};
}
export type Employees=ReturnType<typeof createEmployees>;
