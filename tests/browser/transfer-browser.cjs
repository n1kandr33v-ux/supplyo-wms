const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const root=path.resolve('dist');
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(404).end();return}const target=file===root?path.join(root,'index.html'):file;try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});

 let moves=[],fail=true;
 const fixtures={supplies:[{id:'s1',name:'Исходная',closed:false,warehouse_id:'47'},{id:'s2',name:'Существующая',closed:false,warehouse_id:'47'},{id:'foreign',name:'Другой склад',closed:false,warehouse_id:'49'},{id:'closed',name:'Закрытая',closed:true,warehouse_id:'47'}],items:[{id:'901',supply_id:'s1',snapshot:{article:'Товар',skus:['123'],requiredMeta:[],warehouseId:47},status:'Готов',printed:true,address:'А-1-1',cell:'Г25-46'}]};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{
 if(!req.url().includes('/api/'))return req.continue();const p=new URL(req.url()).pathname;let data={};
 if(p.endsWith('/move')){const body=JSON.parse(req.postData());moves.push(body);if(fail){fail=false;return req.respond({status:500,contentType:'application/json',body:JSON.stringify({error:'Временная ошибка'})});}const id=body.targetSupply||'new-supply';if(!body.targetSupply)fixtures.supplies.push({id,name:body.newName,warehouse_id:'47',closed:false});for(const item of fixtures.items)if(body.orders.includes(item.id))item.supply_id=id;return req.respond({status:200,contentType:'application/json',body:JSON.stringify({id,moved:body.orders.length})});}
 if(p==='/api/me')data={name:'Тест',email:'owner@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:10},employeeAccess:[]};
 if(p==='/api/stores')data={stores:[{id:'own',name:'ИП Тестовый А. А.',status:'ready'}]};
 if(p.endsWith('/warehouses'))data={warehouses:[{id:'47',name:'Казань'}],scoped:true};
 if(p.endsWith('/orders'))data={orders:[{id:'900',article:'Блузка',skus:['2049000000100'],warehouse_id:'47',created_at:new Date().toISOString()}],total:1};
 if(p.endsWith('/fulfillment'))data=fixtures;
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 const click=async text=>{const h=await page.evaluateHandle(t=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()===t),text);await h.asElement().click();await h.dispose()};
 await click('Сборка');await page.waitForSelector('input[aria-label="Перенести заказ 901"]');await page.click('input[aria-label="Перенести заказ 901"]');
 const button=async label=>page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t).click(),label);
 await button('Перенести заказы (1)');await page.waitForSelector('#move-supply');assert.deepEqual(await page.$$eval('#move-supply option',es=>es.map(e=>e.value)),['s2','new']);
 await page.screenshot({path:'tests/browser/artifacts/transfer-existing-preview.png',fullPage:true});await button('Перенести');await page.waitForFunction(()=>document.querySelector('[role=dialog] [role=alert]')?.textContent==='Временная ошибка');await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='Перенести')?.disabled);await button('Перенести');
 await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(moves.length,2);assert.equal(moves[0].operationId,moves[1].operationId);assert.deepEqual(moves[1].orders,['901']);assert.equal(moves[1].targetSupply,'s2');
 await page.waitForFunction(()=>document.querySelector('select[aria-label="Поставка"]')?.value==='s2');await page.click('input[aria-label="Перенести заказ 901"]');await button('Перенести заказы (1)');await page.waitForSelector('#move-supply');await page.select('#move-supply','new');await page.waitForSelector('#move-name');await page.$eval('#move-name',e=>e.value='');await page.type('#move-name','Моя новая поставка');
 await page.screenshot({path:'tests/browser/artifacts/transfer-new-preview.png',fullPage:true});await button('Перенести');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(moves.length,3);assert.equal(moves[2].newName,'Моя новая поставка');assert.notEqual(moves[1].operationId,moves[2].operationId);
 await page.waitForFunction(()=>document.querySelector('select[aria-label="Поставка"]')?.value==='new-supply');assert.ok(await page.$eval('.live-assembly-table tbody',e=>e.textContent.includes('Готов')));assert.deepEqual(errors,[]);console.log('Assembly transfer existing/new, warehouse filtering, retry token and preserved ready state passed');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
