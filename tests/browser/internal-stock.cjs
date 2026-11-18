const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const root=path.resolve('dist');const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(404).end();const target=file===root?path.join(root,'index.html'):file;try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setViewport({width:1600,height:1000});const errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));
  const rows=[{chrt_id:'1',title:'Нарядная блузка с объёмными рукавами',article:'блузка',size:'42–44',barcodes:['2046436169551','4670469730129'],amount:15,cell:'Г25-46',address:'A-1-1',version:1,internal:{id:'i1',quantity:8,version:1}},{chrt_id:'2',title:'Платье с длинным рукавом',article:'платье',size:'46–48',barcodes:['2044735823075'],amount:0,cell:'Г58-62',address:'A-1-2',version:1,internal:null}];let own=[];
  await page.setRequestInterception(true);page.on('request',req=>{if(!req.url().includes('/api/'))return req.continue();const u=new URL(req.url()),p=u.pathname,body=req.postData()?JSON.parse(req.postData()):null;let data={};if(body)mutations.push({p,body});
   if(p==='/api/me')data={name:'Тест',email:'owner@preview.test',subscription:{active:true,expires:Date.now()+86400000,limit:10},employeeAccess:[]};
   else if(p==='/api/stores')data={stores:[{id:'own',name:'ИП Тестовый А. А.',status:'ready',marketplace:'wb'}]};
   else if(p==='/api/internal-stock/warehouses')data={warehouses:[{id:'physical',name:'Казань',team:''}]};
   else if(p.endsWith('/warehouses'))data={warehouses:[{id:'47',name:'Казань'}],scoped:true};
   else if(p.endsWith('/stocks'))data={items:rows,total:2,summary:{quantity:15,positions:1,unknown:0},sync:{status:'ready',synced_at:new Date().toISOString()},canEdit:true};
   else if(p==='/api/internal-stock'&&body){if(body.source){rows[1].internal={id:'i2',quantity:body.quantity,version:1};data={id:'i2'}}else{own.push({id:'own1',title:body.title,article:body.article,barcodes:body.barcodes,cell:body.cell,address:body.address,quantity:body.quantity,version:1});data={id:'own1'}}}
   else if(p==='/api/internal-stock')data={items:own,total:own.length,quantity:own.reduce((s,i)=>s+i.quantity,0),deficits:0,canEdit:true};
   else if(p==='/api/internal-stock/i1'&&body){assert.equal(body.version,1);rows[0].internal={id:'i1',quantity:body.quantity,version:2};data={ok:true};}
   else if(p.endsWith('/history'))data={movements:[{delta:8,balance:8,kind:'manual',reference:'Начальный остаток',created_at:new Date().toISOString()}]};
   else if(p.endsWith('/publish-preview'))data={id:'preview',count:2,quantity:14,skipped:0};
   else if(p.endsWith('/publish'))data={ok:true,count:2};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#app',{waitUntil:'networkidle0'});
  await page.evaluate(()=>[...document.querySelectorAll('.live-sidebar button')].find(b=>b.textContent.trim()==='Остатки').click());
  await page.waitForSelector('.stock-table tbody .internal-value');
  const arrows=await page.$$eval('select',es=>es.map(e=>{const s=getComputedStyle(e);return {appearance:s.appearance,position:s.backgroundPosition,size:s.backgroundSize,padding:s.paddingRight,image:s.backgroundImage}}));
  assert.ok(arrows.length>=2);for(const a of arrows){assert.equal(a.appearance,'none');assert.equal(a.size,'16px 16px');assert.equal(a.padding,'40px');assert.match(a.position,/50%/);assert.match(a.image,/svg/);}
  // Detached native selects inside common lazy-loaded layouts/portals share the same arrow.
  const contexts=await page.evaluate(()=>{const names=['stock-toolbar','access-fields','live-connect','ozon-order-filters','fulfillment','supply-mobile'];return names.map(name=>{const box=document.createElement('div');box.className=name;box.innerHTML='<select><option>Выберите склад</option></select>';document.body.append(box);const e=box.firstChild,s=getComputedStyle(e),result={name,appearance:s.appearance,size:s.backgroundSize,padding:s.paddingRight,position:s.backgroundPosition};box.remove();return result})});
  for(const a of contexts){assert.equal(a.appearance,'none',a.name);assert.equal(a.size,'16px 16px',a.name);assert.equal(a.padding,'40px',a.name);assert.match(a.position,/50%/,a.name);}
  await page.select('select[aria-label="Наличие товаров"]','all');assert.equal(await page.$eval('select[aria-label="Наличие товаров"]',e=>e.value),'all');
  assert.deepEqual(await page.$$eval('.stock-table th',es=>es.map(e=>e.textContent)),['Товар','Баркоды','Код','Адрес','Остаток на WB','На складе']);
  await page.click('.internal-value');await page.waitForSelector('[role=dialog] form');
  await page.$eval('[role=dialog] input',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'10');e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.type('[role=dialog] label:nth-of-type(2) input','Приёмка');await page.click('[role=dialog] button[type=submit]');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  assert.equal(mutations.find(m=>m.p==='/api/internal-stock/i1').body.quantity,10);
  await page.click('.internal-history');await page.waitForSelector('[role=dialog]');assert.match(await page.$eval('[role=dialog]',e=>e.textContent),/Начальный остаток/);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  const unknown=await page.$$('.internal-value');await unknown[1].click();await page.waitForSelector('[role=dialog] input');await page.type('[role=dialog] input','4');await page.click('[role=dialog] button[type=submit]');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  const click=async text=>page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t).click(),text);
  await click('Передать остатки на WB');await page.waitForSelector('[role=dialog]');assert.equal(mutations.filter(m=>m.p.endsWith('/publish')).length,0);await click('Подтвердить');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(mutations.filter(m=>m.p.endsWith('/publish')).length,1);
  assert.equal(await page.$('.stock-mode'),null);assert.ok(!(await page.evaluate(()=>document.body.textContent)).includes('Без маркетплейса'));
  fs.mkdirSync('tests/browser/artifacts',{recursive:true});await page.screenshot({path:'tests/browser/artifacts/internal-stock.png',fullPage:true});
  await page.setViewport({width:1024,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,mutations:mutations.map(m=>m.p),screenshots:['tests/browser/artifacts/internal-stock.png']}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
