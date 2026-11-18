const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const root=path.resolve('dist');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(404).end();return}
  try{const target=file===root?path.join(root,'index.html'):file;res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch{res.writeHead(404).end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1100});
 const item=(id,meta=[],supply='s1',status='Ожидает',printed=false)=>({id,supply_id:supply,snapshot:{article:'Блузка жаккард',skus:['2049000000100'],requiredMeta:meta},status,printed});
 let items=[item('100',['sgtin'],'s1','Проверяется',true),item('101',['sgtin']),item('102',['sgtin']),item('103',['sgtin'],'s1','Ошибка КИЗ',true),item('104',[],'s2')];
 items.push({...item('106'),snapshot:{article:'Нет данных о маркировке',skus:['UNKNOWN']}});
 items.push({...item('107'),snapshot:{article:'Товар с КИЗ из optionalMeta',skus:['OPTIONAL-KIZ'],requiredMeta:[],optionalMeta:['sgtin','customs_declaration']}});
 let failNextFulfillment=false;
 let calls=[],prints=[],errors=[],pending=null,ackFails=true,spooled=new Set(),scanSeq=0,individualAckFails=0,scanBodies=[];
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{
  const u=new URL(req.url()),p=u.pathname;
  if(u.port==='17891'){
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-WMS-Print-Agent','Access-Control-Allow-Methods':'POST,OPTIONS'};
   if(req.method()==='OPTIONS')return req.respond({status:204,headers});
   const body=JSON.parse(req.postData());prints.push(body);
   const duplicate=spooled.has(body.job_id);spooled.add(body.job_id);
   await new Promise(r=>setTimeout(r,180));
   return req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,duplicate})});
  }
  if(!p.startsWith('/api/'))return req.continue();
  calls.push(p);if(p.endsWith('/fulfillment')&&failNextFulfillment){failNextFulfillment=false;return req.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Refresh temporarily failed'})});}let data={};
  if(p==='/api/me')data={name:'Проверка Авто',email:'auto@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:10},employeeAccess:[]};
  else if(p==='/api/stores')data={stores:[{id:'own',name:'ИП Тестовый А. А.',status:'ready',last_synced:'2026-11-10T12:00:00Z'}]};
  else if(p.endsWith('/warehouses'))data={warehouses:[{id:'47',name:'Казань'}]};
  else if(p.endsWith('/orders'))data={orders:[],total:0};
  else if(p.endsWith('/fulfillment'))data={supplies:[{id:'s1',name:'Основная поставка',closed:false,warehouse_id:'47'},{id:'s2',name:'Другая поставка',closed:false,warehouse_id:'47'}],items};
  else if(p.endsWith('/scan-auto')){
   await new Promise(r=>setTimeout(r,180));
   pending ||= {printJob:'supplyo-auto-test-batch-0001',jobs:items.filter(i=>i.supply_id==='s1'&&!i.printed&&i.status==='Ожидает'&&Array.isArray(i.snapshot.requiredMeta)&&!i.snapshot.requiredMeta.length&&i.snapshot.skus.includes(JSON.parse(req.postData()).barcode)).map(i=>({orderId:i.id,label:'label-'+i.id}))};
   data=pending;
  }
  else if(p.includes('/print-batches/')&&p.endsWith('/printed')){
   if(ackFails){ackFails=false;return req.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Сервер временно недоступен'})});}
   const ids=new Set(pending.jobs.map(j=>j.orderId));items=items.map(i=>ids.has(i.id)?{...i,printed:true,status:'Готов'}:i);
   data={ok:true,count:ids.size};
  }
  else if(p.endsWith('/scan')){const id=p.split('/').at(-2);scanBodies.push(JSON.parse(req.postData()||'{}'));data={printJob:'supplyo-own-'+id+'-'+(++scanSeq),label:'preview-label'};}
  else if(p.endsWith('/printed')){if(individualAckFails>0){individualAckFails--;return req.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Acknowledgement failed'})});}const id=p.split('/').at(-2);items=items.map(i=>i.id===id?{...i,printed:true,status:i.snapshot.requiredMeta?.includes('sgtin')?'Проверяется':'Готов'}:i);}
  return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 const clickText=async text=>{const h=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),text);await h.asElement().click();await h.dispose()};


 ackFails=false;
 const focused=()=>page.waitForFunction(()=>document.activeElement?.id==='product-scan'&&!document.querySelector('#product-scan').disabled);
 const scan=async()=>{await focused();await page.keyboard.type('2049000000100');await page.keyboard.press('Enter');};
 await clickText('Сборка');await focused();
 await scan();await page.waitForSelector('input[aria-label="КИЗ"]');assert.match(await page.$eval('[role="dialog"]',e=>e.textContent),/Заказ № 101/,'skip printed checking order');
 failNextFulfillment=true;await page.keyboard.type('010460123456789321ABCDEFGHIJKLM');await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await focused();assert.equal(items.find(i=>i.id==='101').status,'Проверяется');
 await scan();await page.waitForSelector('input[aria-label="КИЗ"]');assert.match(await page.$eval('[role="dialog"]',e=>e.textContent),/Заказ № 102/,'next scan selects next unprinted item while previous KIZ is checking');
 individualAckFails=1;await page.keyboard.type('010460123456789321ABCDEFGHIJKLM');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[role="dialog"] button[type="submit"]')?.disabled===false);await new Promise(r=>setTimeout(r,300));assert.equal(items.find(i=>i.id==='102').printed,false,'failed acknowledgement is retryable');
 const lastJob=prints.at(-1).job_id;await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await focused();assert.equal(prints.at(-1).job_id,lastJob,'retry uses same print job');
 const count=prints.length;await scan();await focused();assert.ok(!await page.$('[role="dialog"]'),'all printed checking/error orders must not reopen');assert.equal(prints.length,count);assert.ok(!calls.some(p=>p.includes('/items/100/scan')||p.includes('/items/103/scan')||p.includes('/items/104/scan')));
 await page.evaluate(()=>{const row=[...document.querySelectorAll('.live-assembly-table tbody tr')].find(r=>r.children[1]?.textContent==='100');[...row.querySelectorAll('button')].find(b=>b.textContent==='Печать').click();});await page.waitForSelector('[role="dialog"]');assert.match(await page.$eval('[role="dialog"]',e=>e.textContent),/Заказ № 100/,'explicit reprint remains available');await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('Duplicate KIZ products: skip printed pending/error, next unprinted selection, same-job acknowledgement retry, exhausted barcode and explicit reprint passed');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
