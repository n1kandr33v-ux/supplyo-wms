import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApp} from './app.ts';
import {invoiceTotal,invoiceLine} from '../src/lib/invoice.ts';
import {invoiceXlsx} from '../src/lib/invoice-xlsx.ts';
import {unzipSync,strFromU8} from 'fflate';

test('fulfillment price list is private/versioned; invoices retain snapshots and reject stale prices or forged totals',async()=>{
 const {app}=await createApp({key:randomBytes(32),worker:false,testPurchases:true});const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const post=(h:any,url:string,payload:any)=>app.inject({method:'POST',url,headers:h,payload});
 async function user(email:string){const r=await post(base,'/api/auth/register',{email,name:'Тестовый владелец',password:'Password-12345',phone:'+79991234567',consent:true});const headers={...base,cookie:String(r.headers['set-cookie']).split(';')[0]};await post(headers,'/api/subscription/test-purchase',{plan:'start'});return headers;}
 try{
  const owner=await user('invoice-owner@example.test'),other=await user('invoice-other@example.test');
  const read=async(h=owner)=>(await app.inject({url:'/api/workspace',headers:h})).json();
  const save=(kind:string,version:number,data:any,h=owner)=>post(h,'/api/workspace/'+kind,{version,data});
  assert.deepEqual((await read()).prices,{data:[],version:0});
  const prices=[{id:'pack',title:'Упаковка',unit:'шт.',rate:12.50},{id:'store',title:'Хранение',unit:'м³/день',rate:9.99}];
  assert.equal((await save('prices',0,prices)).statusCode,200);assert.deepEqual((await read(other)).prices.data,[]);
  assert.equal((await save('prices',0,[{id:'own-service',title:'Услуга другого ФФ',unit:'шт.',rate:77}],other)).statusCode,200);assert.deepEqual((await read()).prices.data,prices);assert.equal((await read(other)).prices.data[0].rate,77);
  assert.equal((await save('prices',0,prices)).statusCode,409);assert.equal((await save('prices',1,[{...prices[0],rate:-1}])).statusCode,400);
  assert.equal((await save('prices',1,[prices[0],prices[0]])).statusCode,400);
  const defaults=[{client:'ИП Клиент',serviceIds:['pack']}];
  assert.equal((await save('clientServices',0,defaults)).statusCode,200);
  assert.deepEqual((await read()).clientServices.data,defaults);
  assert.deepEqual((await read(other)).clientServices.data,[]);
  assert.equal((await save('clientServices',0,defaults)).statusCode,409);
  assert.equal((await save('clientServices',1,[...defaults,{client:'ип клиент',serviceIds:[]}])).statusCode,400);
  assert.equal((await save('clientServices',1,[{client:'ИП Клиент',serviceIds:[]}])).statusCode,200);
  assert.deepEqual((await read()).clientServices.data[0].serviceIds,[]);
  const w={id:'w',name:'Склад',city:'Казань',address:'Адрес',staff:[]};assert.equal((await save('warehouses',0,[w])).statusCode,200);
  const items=prices.map((p,i)=>({serviceId:p.id,title:p.title,unit:p.unit,rate:p.rate,quantity:i?1.125:100}));
  const invoice={id:'invoice',kind:'invoice',warehouseId:'w',date:'2026-11-15',title:'Услуги фулфилмента',person:'ИП Клиент',number:'СЧ-1',due:'2026-11-20',paid:false,quantity:1,rate:0,amount:invoiceTotal(items),invoiceItems:items};
  assert.equal(invoice.amount,1261.24);assert.equal((await save('accounting',0,[{...invoice,amount:1}])).statusCode,400);
  assert.equal((await save('accounting',0,[{...invoice,invoiceItems:[{...items[0],rate:1}],amount:100}])).statusCode,409);
  assert.equal((await save('accounting',0,[invoice])).statusCode,200);assert.deepEqual((await read()).accounting.data[0].invoiceItems,items);
  assert.equal((await save('prices',1,[{...prices[0],rate:30}])).statusCode,200);
  assert.equal((await read()).accounting.data[0].amount,1261.24,'price edits do not reprice saved invoices');
  // Old snapshots still allow quantity corrections after a price was removed/changed.
  const revisedItems=items.map(i=>({...i,quantity:2})),revised={...invoice,invoiceItems:revisedItems,amount:invoiceTotal(revisedItems)};
  assert.equal((await save('accounting',1,[revised])).statusCode,200);
  assert.equal((await save('accounting',2,[revised,{...invoice,id:'new-invoice'}])).statusCode,409,'new invoice must use current price list');
  const payment={...revised,id:'invoice-payment-invoice',kind:'income',title:'Оплата счёта СЧ-1'};
  assert.equal((await save('accounting',2,[{...revised,paid:true},payment])).statusCode,200);
  assert.deepEqual((await read(other)).accounting.data,[]);
 }finally{await app.close();}
});

test('Excel calculation has real OOXML, numeric quantities/prices, cached formulas and safe untrusted text',()=>{
 assert.equal(invoiceLine({quantity:1.005,rate:9}),9.05);
 assert.equal(invoiceLine({quantity:0.125,rate:0.04}),0.01);
 const items=[{serviceId:'a',title:'=HYPERLINK("https://example.test") & <услуга>',unit:'шт.',quantity:3,rate:12.5},{serviceId:'b',title:'Хранение',unit:'м³',quantity:1.125,rate:9.99}];
 const bytes=invoiceXlsx({number:'СЧ-1',date:'2026-11-15',due:'',person:'Клиент',title:'Услуги',amount:invoiceTotal(items),invoiceItems:items},'Казань');
 const files=unzipSync(bytes);assert.ok(files['[Content_Types].xml']);const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<f>ROUND\(D8\*E8,2\)<\/f><v>37.5<\/v>/);assert.match(sheet,/<f>SUM\(F8:F9\)<\/f><v>48.74<\/v>/);
 assert.match(sheet,/t="inlineStr"[^>]*><is><t[^>]*>=HYPERLINK/);assert.ok(sheet.includes('&amp; &lt;услуга&gt;'));
 assert.equal((sheet.match(/<f>/g)||[]).length,3,'only generated numeric calculations become formulas');
 const legacy=strFromU8(unzipSync(invoiceXlsx({number:'Старый',date:'2026-11-01',due:'',person:'Клиент',title:'Старый счёт',amount:500},'Склад'))['xl/worksheets/sheet1.xml']);assert.match(legacy,/<v>500<\/v>/);
});
