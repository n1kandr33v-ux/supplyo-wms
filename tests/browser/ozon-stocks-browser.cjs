const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(404).end();try{const target=file===root?path.join(root,'index.html'):file;res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));

 let cell='',address='',internal=null;
 await page.setRequestInterception(true);page.on('request',req=>{if(!req.url().includes('/api/'))return req.continue();const u=new URL(req.url()),p=u.pathname;calls.push({path:p,body:req.postData()});let d={};
 if(p==='/api/me')d={name:'Тест',email:'owner@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:5},employeeAccess:[]};
 if(p==='/api/stores')d={stores:[{id:'ozon-shop',name:'ИП Ozon',marketplace:'ozon',status:'ready',last_synced:'2026-11-17T08:00:00Z'}]};
 if(p.endsWith('/warehouses'))d={warehouses:[{id:'47',name:'Казань'}],scoped:false};
 if(p.endsWith('/ozon/postings'))d={postings:[],total:0};
 if(p.endsWith('/ozon/stocks'))d={items:[{product_id:'1',sku:'100',title:'Товар без заказов',article:'art',barcodes:['001234'],amount:5,reserved:3,cell,address,version:0,internal}],total:1,summary:{quantity:5,internal_quantity:internal?.quantity||0,unknown:0},sync:{status:'ready',synced_at:Date.now()},canEdit:true};
 if(p.endsWith('/publish-preview'))d={id:'preview',count:1,quantity:12,skipped:52};if(p.endsWith('/publish'))d={ok:true,count:1};
 if(p.endsWith('/placement')){const b=JSON.parse(req.postData());cell=b.cell;address=b.address;d={version:1}}
 if(p==='/api/internal-stock'){const b=JSON.parse(req.postData());internal={id:'internal',quantity:b.quantity,version:0,title:'Товар без заказов'};d={id:'internal'}}
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
 await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Остатки').click());await page.waitForFunction(()=>document.querySelector('.stock-table')?.textContent.includes('Товар без заказов'));
 assert.ok(await page.$eval('.stock-table',e=>e.textContent.includes('Остаток на Ozon')&&e.textContent.includes('001234')));
 await page.evaluate(()=>document.querySelectorAll('.stock-table .internal-value')[0].click());await page.waitForSelector('[role=dialog] input');await page.type('[role=dialog] input','Ф-22');await page.type('[role=dialog] label:nth-of-type(2) input','А-1-1');await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Сохранить').click());await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));await page.waitForFunction(()=>document.querySelector('.stock-table')?.textContent.includes('Ф-22'));
 await page.evaluate(()=>[...document.querySelectorAll('.internal-value')].find(b=>b.textContent==='Не задано').click());await page.waitForSelector('[role=dialog] input');await page.type('[role=dialog] input','12');await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Сохранить').click());await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(internal.quantity,12);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Передать остатки на Ozon').click());await page.waitForSelector('[role=dialog]');assert.equal(calls.filter(c=>c.path.endsWith('/publish')).length,0);assert.ok(await page.$eval('[role=dialog]',e=>e.textContent.includes('52')));await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Подтвердить').click());await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(calls.filter(c=>c.path.endsWith('/publish')).length,1);
 await page.screenshot({path:'tests/browser/artifacts/ozon-stocks-preview.png',fullPage:true});await page.setViewport({width:686,height:900});await new Promise(r=>setTimeout(r,250));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.ok(!calls.some(c=>c.path.includes('/supplies/')));console.log('Ozon catalog without orders, real stock columns, placement, internal quantity and narrow layout passed');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
