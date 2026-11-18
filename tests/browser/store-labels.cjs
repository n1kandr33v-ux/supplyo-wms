const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(404).end();try{const target=file===root?path.join(root,'index.html'):file;res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 let includeOzon=false,label='';const shops=()=>[{id:'wb-shop',name:'ИП WB · Казань',marketplace:'wb',status:'ready',last_synced:'2026-11-17T08:00:00Z'},...(includeOzon?[{id:'ozon-shop',name:label||'Ozon · 123',custom_name:label||null,original_name:'Ozon · 123',marketplace:'ozon',status:'ready',last_synced:'2026-11-17T08:00:00Z'}]:[])];
 await page.setRequestInterception(true);page.on('request',req=>{if(!req.url().includes('/api/'))return req.continue();const u=new URL(req.url()),p=u.pathname;calls.push({path:p,body:req.postData()});let d={};
 if(p==='/api/me')d={name:'Тест',email:'owner@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:5},employeeAccess:[]};
 if(p.endsWith('/display-name')){label=JSON.parse(req.postData()).name;d={ok:true};}
 if(p==='/api/stores')d={stores:shops()};
 if(p.endsWith('/warehouses'))d={warehouses:[{id:'47',name:'Казань'}],scoped:false};
 if(p.endsWith('/fulfillment'))d={supplies:[],items:[]};
 if(p.endsWith('/orders'))d={orders:[],total:0};
 if(p.endsWith('/ozon/postings'))d={postings:[],total:0,page:1};
 if(p.endsWith('/ozon/assembly'))d={rows:[],total:0,quantity:0,ready:0};
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Новые заказы').click());await page.waitForSelector('.market-toggle');
 assert.equal(await page.$eval('#active-store',e=>e.value),'wb-shop');
 const choose=async label=>page.evaluate(label=>[...document.querySelectorAll('.market-toggle button')].find(b=>b.textContent===label).click(),label);
 await choose('Ozon');await page.waitForSelector('.live-market-empty');assert.match(await page.$eval('.live-market-empty',e=>e.textContent),/Ozon/);assert.equal(await page.$eval('#active-store',e=>e.disabled),true);
 await new Promise(r=>setTimeout(r,3400));assert.ok(await page.$('.live-market-empty'),'background refresh must not switch back to WB');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.live-market-empty');assert.equal(await page.$eval('.market-toggle button[aria-pressed=true]',e=>e.textContent),'Ozon');
 includeOzon=true;await page.waitForFunction(()=>document.querySelector('#active-store')?.value==='ozon-shop');assert.equal(await page.$$eval('#active-store option',o=>o.length),1);
 await page.click('button[aria-label="Изменить название клиента"]');await page.waitForSelector('#client-display-name');await page.type('#client-display-name','ИП Филиппов');await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Сохранить').click());await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(await page.$eval('#active-store option',e=>e.textContent.trim()),'ИП Филиппов');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#active-store');assert.equal(await page.$eval('#active-store option',e=>e.textContent.trim()),'ИП Филиппов');
 await choose('WB');await page.waitForFunction(()=>document.querySelector('#active-store')?.value==='wb-shop');assert.equal(await page.$$eval('#active-store option',o=>o.length),1);
 await choose('Ozon');await page.waitForFunction(()=>document.querySelector('#active-store')?.value==='ozon-shop');await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Сборка').click());await page.waitForSelector('.ozon-assembly');
 await choose('WB');await page.waitForSelector('.fulfillment:not(.ozon-assembly)');
 await choose('Ozon');await page.waitForSelector('.ozon-assembly');
 fs.mkdirSync('tests/browser/artifacts',{recursive:true});await page.screenshot({path:'tests/browser/artifacts/market-switch-desktop.png',fullPage:true});
 for(const width of [1024,390]){await page.setViewport({width,height:900});await new Promise(r=>setTimeout(r,250));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow at '+width);const boxes=await page.$$eval('.live-picker>*',els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(!(a.w&&b.w&&a.h&&b.h&&Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1),'picker controls do not overlap at '+width+' '+JSON.stringify({i,j,a,b}));}}
 await page.screenshot({path:'tests/browser/artifacts/market-switch-mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log('WB/Ozon filtered switch, empty state, persistence, polling, assembly isolation and responsive layout passed');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
