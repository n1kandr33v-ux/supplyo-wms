const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(404).end();try{const target=file===root?path.join(root,'index.html'):file;res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 let scans=0,saved=false,passed=false,finished=false,finish=null;
 const rows=()=>[{posting:'123-1-1',sku:'111',offer_id:'Блузка',name:'Блузка женская',quantity:2,ready:passed?2:0,barcodes:['4670469736947'],scanit:'ii123',hasKiz:true,units:passed?[{id:'one',ordinal:0,state:'ready',hasKiz:true},{id:'two',ordinal:1,state:'ready',hasKiz:true}]:saved?[{id:'one',ordinal:0,state:'checking',hasKiz:true}]:[]},{posting:'123-1-1',sku:'222',offer_id:'Расчёска',name:'Расчёска',quantity:1,ready:scans>=2?1:0,barcodes:['comb-barcode'],units:scans>=2?[{id:'plain',state:'ready'}]:[]}];
 await page.setRequestInterception(true);page.on('request',req=>{if(!req.url().includes('/api/'))return req.continue();const u=new URL(req.url()),p=u.pathname;calls.push({path:p,body:req.postData()});let d={};
 if(p==='/api/me')d={name:'Тест',email:'owner@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:5},employeeAccess:[]};
 if(p==='/api/stores')d={stores:[{id:'ozon-shop',name:'ИП Ozon',marketplace:'ozon',status:'ready',last_synced:'2026-11-12T08:00:00Z'}]};
 if(p.endsWith('/warehouses'))d={warehouses:[{id:'47',name:'Казань'}],scoped:false};
 if(p.endsWith('/ozon/assembly'))d={rows:finished?[]:rows().map(r=>({...r,postingStatus:finish?.state==='done'?'awaiting_deliver':'awaiting_packaging'})),total:finished?0:1,quantity:finished?0:3,ready:finished?0:(passed?2:0)+(scans>=2?1:0),finish};
 if(p.endsWith('/assembly/scan')){scans++;d=scans===1?{unit:'one',posting:'123-1-1',name:'Блузка',needsKiz:true}:{unit:'plain',posting:'123-1-1',needsKiz:false};}
 if(p.endsWith('/one/kiz')){saved=true;d={ok:true};}
 if(p.endsWith('/assembly/finish')){finish={state:'checking'};d={ok:true};}
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Сборка').click());await page.waitForSelector('#ozon-assembly-scan');assert.equal(await page.$$eval('.ozon-assembly-table tbody tr',r=>r.length),3);assert.ok(!await page.$eval('.ozon-assembly-table thead',e=>e.textContent.includes('Кол-во')));
 assert.ok(await page.$eval('#ozon-assembly-auto',e=>e.disabled));await page.select('#ozon-assembly-warehouse','47');await page.waitForFunction(()=>!document.querySelector('#ozon-assembly-auto').disabled);await page.click('#ozon-assembly-auto');assert.equal(await page.$eval('#ozon-assembly-auto',e=>e.getAttribute('aria-checked')),'true');
 await page.type('#ozon-assembly-scan','4670469736947');await page.keyboard.press('Enter');await page.waitForSelector('[role=dialog] input[aria-label="КИЗ"]');assert.ok(await page.$eval('[role=dialog]',e=>e.textContent.includes('КИЗ товара')));await page.type('[aria-label="КИЗ"]','010467046973694721AAAAAAAAAAAA1');await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 await page.waitForFunction(()=>document.activeElement?.id==='ozon-assembly-scan');assert.ok(await page.$eval('.ozon-assembly-table',e=>e.textContent.includes('Проверяется')));assert.ok(!await page.$eval('.ozon-assembly-table',e=>e.textContent.includes('ТН ВЭД')||e.textContent.includes('маркируемый')));
 await page.type('#ozon-assembly-scan','comb-barcode');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.fulfillment-toolbar')?.textContent.includes('Собрано 1 из 3'));assert.ok(!await page.$('[role=dialog]'));
 passed=true;await page.evaluate(()=>[...document.querySelectorAll('.ozon-assembly-table .live-supply-link')][0].click());await page.waitForFunction(()=>document.querySelector('.fulfillment-toolbar')?.textContent.includes('Собрано 3 из 3'));
 await page.screenshot({path:'tests/browser/artifacts/ozon-assembly-preview.png',fullPage:true});
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Завершить сборку в Ozon').click());await page.waitForSelector('[role=dialog]');await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Завершить сборку').click());await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 assert.ok(calls.filter(c=>c.path.endsWith('/assembly/scan')).every(c=>JSON.parse(c.body).auto===true));assert.equal(calls.filter(c=>c.path.endsWith('/assembly/finish')).length,1);assert.ok(!calls.some(c=>/\/items\/|\/supplies\/|\/fulfillment$/.test(c.path)),'Ozon stays isolated from WB operations');
 finish={state:'done'};await page.reload({waitUntil:'networkidle0'});await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Сборка').click());await page.waitForFunction(()=>document.querySelector('.ozon-assembly-table')?.textContent.includes('Ожидает печати'));assert.ok(await page.$eval('.ozon-assembly-table',e=>[...e.querySelectorAll('button')].some(b=>b.textContent==='Печать')));
 await page.setViewport({width:686,height:900});await new Promise(r=>setTimeout(r,250));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('Ozon scanner automatic KIZ prompt/save, checking state, next plain scan, focus return, hidden diagnostics, completion confirmation and narrow layout passed');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
