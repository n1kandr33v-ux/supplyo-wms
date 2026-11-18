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
 let items=[item('100'),item('101'),item('102'),item('103',['sgtin']),item('104',[],'s2'),item('105',[],'s1','Готов',true)];
 items.push({...item('106'),snapshot:{article:'Нет данных о маркировке',skus:['UNKNOWN']}});
 let calls=[],prints=[],errors=[],pending=null,ackFails=true,spooled=new Set();
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{
  const u=new URL(req.url()),p=u.pathname;
  if(u.port==='17891'){
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-WMS-Print-Agent','Access-Control-Allow-Methods':'POST,OPTIONS'};
   if(req.method()==='OPTIONS')return req.respond({status:204,headers});
   const body=JSON.parse(req.postData());prints.push(body);
   spooled.add(body.job_id);
   await new Promise(r=>setTimeout(r,180));
   return req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true})});
  }
  if(!p.startsWith('/api/'))return req.continue();
  calls.push(p);let data={};
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
  else if(p.endsWith('/scan')){const id=p.split('/').at(-2);data={printJob:'supplyo-own-'+id,label:'preview-label'};}
  else if(p.endsWith('/printed')){const id=p.split('/').at(-2);items=items.map(i=>i.id===id?{...i,printed:true,status:'Готов'}:i);}
  return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 const clickText=async text=>{const h=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),text);await h.asElement().click();await h.dispose()};
 await clickText('Сборка');await page.waitForSelector('#product-scan');
 assert.equal(await page.$eval('#assembly-auto',e=>e.getAttribute('aria-checked')),'false');
 const scan=async barcode=>{await page.click('#product-scan');await page.$eval('#product-scan',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.type('#product-scan',barcode);await page.keyboard.press('Enter')};
 await scan('2049000000100');await page.waitForFunction(()=>!document.querySelector('#product-scan').disabled);
 assert.equal(prints.length,1,'Auto off prints one sticker');assert.ok(!calls.some(p=>p.endsWith('/scan-auto')));
 await page.click('#assembly-auto');
 await scan('2049000000100');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-sonner-toast]')?.textContent.includes('Подготавливаем все стикеры'));
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Агент принял пакет')));
 assert.equal(calls.filter(p=>p.endsWith('/scan-auto')).length,1,'double Enter must not start another batch');
 assert.equal(prints.length,2,'one request for all Auto labels after one single print');
 assert.deepEqual(prints[1].stickers,[{file:'label-101'},{file:'label-102'}]);
 assert.equal(items.find(i=>i.id==='101').status,'Ожидает','no partial Ready on failed acknowledgement');
 assert.equal(items.find(i=>i.id==='102').status,'Ожидает');
 await page.click('#product-scan',{clickCount:3});await page.keyboard.press('Backspace');await scan('2049000000100');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Стикеры отправлены на принтер: 2')));
 assert.deepEqual(prints[1],prints[2],'retry must reuse the exact batch ID and payload');
 assert.equal(spooled.size,2,'agent deduplication must create only one Auto spool job');
 assert.equal(items.find(i=>i.id==='101').status,'Готов');assert.equal(items.find(i=>i.id==='102').status,'Готов');
 assert.equal(items.find(i=>i.id==='103').status,'Ожидает');assert.equal(items.find(i=>i.id==='104').status,'Ожидает');
 const pos=await page.$eval('[data-sonner-toaster]',e=>({x:e.getAttribute('data-x-position'),y:e.getAttribute('data-y-position'),r:e.getBoundingClientRect().right,b:e.getBoundingClientRect().bottom}));
 assert.equal(pos.x,'right');assert.equal(pos.y,'bottom');assert.ok(pos.r<=1440&&pos.b<=1100);
 await page.screenshot({path:'tests/browser/artifacts/auto-batch-preview.png',fullPage:true});
 await scan('2049000000100');await page.waitForSelector('[role="dialog"]');
 assert.ok((await page.$eval('[role="dialog"]',e=>e.innerText)).includes('КИЗ'),'KIZ still has its individual scan flow');
 await page.keyboard.press('Escape');await page.click('#product-scan',{clickCount:3});await page.keyboard.press('Backspace');await scan('UNKNOWN');
 await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Требования к маркировке'));
 assert.equal(prints.length,3,'unknown marking requirements must not print');
 for(const width of [686,1159]){await page.setViewport({width,height:900});assert.ok(await page.$eval('.live-scanner-heading',e=>e.scrollWidth<=e.clientWidth),'toggle must fit scanner header');}
 assert.deepEqual(errors,[]);
 const map=await browser.newPage();await map.setViewport({width:1600,height:1200});await map.goto('file:///'+path.resolve('docs/site-map/Supplyo-map-preview.html').replaceAll('\\','/')+'#10',{waitUntil:'load'});await map.screenshot({path:'docs/site-map/check-auto-batch.png',fullPage:true});
 console.log(JSON.stringify({ok:true,scenarios:['single','auto','double-enter','whole-batch-and-idempotent-ack-retry','KIZ','unknown-metadata','responsive'],printAttempts:prints.length}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
