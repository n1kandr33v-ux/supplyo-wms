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
 items.push({...item('107'),snapshot:{article:'Товар с КИЗ из optionalMeta',skus:['OPTIONAL-KIZ'],requiredMeta:[],optionalMeta:['sgtin','customs_declaration']}});
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
  else if(p.endsWith('/scan')){const id=p.split('/').at(-2);scanBodies.push(JSON.parse(req.postData()||'{}'));data={printJob:'supplyo-own-'+id+'-'+(++scanSeq),label:'preview-label'};}
  else if(p.endsWith('/printed')){if(individualAckFails>0){individualAckFails--;return req.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Acknowledgement failed'})});}const id=p.split('/').at(-2);items=items.map(i=>i.id===id?{...i,printed:true,status:'Готов'}:i);}
  return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 const clickText=async text=>{const h=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),text);await h.asElement().click();await h.dispose()};

 ackFails=false;
 const focused=()=>page.waitForFunction(()=>document.activeElement?.id==='product-scan'&&!document.querySelector('#product-scan').disabled);
 const scanWithoutClick=async text=>{await page.keyboard.type(text);await page.keyboard.press('Enter')};
 await clickText('Сборка');await page.waitForSelector('#product-scan');await focused();
 await scanWithoutClick('2049000000100');await focused();assert.equal(prints.length,1);assert.equal(await page.$eval('#product-scan',e=>e.value),'');
 await scanWithoutClick('2049000000100');await focused();assert.equal(prints.length,2,'second scan needs no click');
 await page.click('#assembly-auto');await page.$eval('#product-scan',e=>e.blur());
 await scanWithoutClick('2049000000100');await focused();assert.equal(prints.length,3);
 assert.equal(prints.at(-1).stickers.length,1,'global input preserves exact barcode without losing/doubling first digit');
 await page.click('#assembly-auto');
 await page.$eval('#product-scan',e=>e.blur());await scanWithoutClick('OPTIONAL-KIZ');
 await page.waitForSelector('input[aria-label="КИЗ"]');assert.equal(await page.$eval('input[aria-label="КИЗ"]',e=>e.value),'','product scan must not bleed into KIZ');
 await page.keyboard.type('010460123456789321ABCDEFGHIJKLM');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await focused();assert.equal(prints.length,4);
 await scanWithoutClick('2049000000100');await page.waitForSelector('input[aria-label="КИЗ"]');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await focused();
 await scanWithoutClick('NOT-A-BARCODE');await focused();assert.equal(await page.$eval('#product-scan',e=>e.value),'');
 await page.click('input[aria-label="Поиск в поставке"]');await page.type('input[aria-label="Поиск в поставке"]','товар');
 assert.equal(await page.$eval('input[aria-label="Поиск в поставке"]',e=>e.value),'товар','normal Russian search must not be intercepted');
 await page.click('input[aria-label="Поиск в поставке"]');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await new Promise(r=>setTimeout(r,4200));await focused();
 await page.click('[aria-label="Настройки"]');await page.waitForSelector('.profile-menu');
 await page.keyboard.type('abc');assert.equal(await page.$eval('#product-scan',e=>e.value),'','menu type-ahead must not become a scan');await page.keyboard.press('Escape');
 await clickText('Новые заказы');await page.waitForFunction(()=>!document.querySelector('#product-scan'));
 assert.deepEqual(errors,[]);
 console.log('Scanner focus: consecutive single/Auto scans without clicks, body scan with exact first character, KIZ submit/cancel, unknown barcode recovery, search typing/4-second idle and menu protection passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
