export type DemoAccess={code:string;owner:string;cabinet:string;warehouse:string;used:boolean;revoked?:boolean}
const storageKey='supplyo-demo-access'
export function readDemoAccess():DemoAccess[]{try{return JSON.parse(localStorage.getItem(storageKey)||'[]')}catch{return []}}
export function saveDemoAccess(rows:DemoAccess[]){localStorage.setItem(storageKey,JSON.stringify(rows));window.dispatchEvent(new Event('supplyo-access-changed'))}
