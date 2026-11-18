const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(404).end();try{const target=file===root?path.join(root,'index.html'):file;res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 const now=Date.now();const rows=Array.from({length:101},(_,i)=>({id:'mark-'+i,posting_number:i===0||i===100?'123-1-1':'123-2-1',sku:'111',name:'Блузка',article:'blouse',barcodes:['0001234567890'],kiz:'010001234567890021ABC'+i+'\u001d91AB',assembled_at:now-3600000,expires_at:now+86400000}));
 await page.setRequestInterception(true);page.on('request',req=>{if(!req.url().includes('/api/'))return req.continue();const u=new URL(req.url()),p=u.pathname;calls.push({path:p,body:req.postData()});let d={};
 if(p==='/api/me')d={name:'Тест',email:'owner@preview.test',subscription:{active:false,expires:0,limit:0},employeeAccess:[]};
 if(p==='/api/stores')d={stores:[{id:'ozon-shop',name:'ИП Ozon',marketplace:'ozon',status:'ready',last_synced:'2026-11-12T08:00:00Z'}]};
 if(p.endsWith('/ozon/marks')){const filtered=rows.filter(r=>!u.searchParams.get('search')||r.article.includes(u.searchParams.get('search')));const pg=Number(u.searchParams.get('page')||1);d={rows:filtered.slice((pg-1)*100,pg*100),total:filtered.length,page:pg,pageSize:100,retentionDays:14};}
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
 });
 const origin='http://127.0.0.1:'+server.address().port;await page.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedMark=text},readText:async()=>window.copiedMark||''}})});
 await page.goto(origin+'/#app',{waitUntil:'networkidle0'});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='КИЗ Ozon').click());await page.waitForSelector('.ozon-marks-table tbody tr');
 assert.match(await page.$eval('.ozon-marks-info',e=>e.textContent),/Подписка не требуется/);assert.equal(await page.$eval('#active-store',e=>e.value),'ozon-shop');
 await page.click('button[aria-label="Скопировать КИЗ 123-1-1"]');await page.waitForFunction(async()=>!!await navigator.clipboard.readText());assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),rows[0].kiz);
 const downloads=path.resolve('tests/browser/artifacts/ozon-marks-download/'+Date.now());fs.mkdirSync(downloads,{recursive:true});await(await page.createCDPSession()).send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 await page.click('input[aria-label="Выбрать отправление 123-1-1"]');await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Excel · выбрано')).click());
 const deadline=Date.now()+6000;let files=[];while(Date.now()<deadline){files=fs.readdirSync(downloads).filter(f=>f.endsWith('.xlsx'));if(files.length)break;await new Promise(r=>setTimeout(r,100))}assert.equal(files.length,1);const{unzipSync,strFromU8}=require('fflate'),sheet=strFromU8(unzipSync(fs.readFileSync(path.join(downloads,files[0])))['xl/worksheets/sheet1.xml']);assert.ok(sheet.includes('ABC100_x001D_91AB'),'selected posting export spans pages');assert.ok(!sheet.includes('123-2-1'));
 await page.type('input[aria-label="Поиск КИЗ Ozon"]','missing');await page.waitForFunction(()=>document.querySelector('.ozon-marks-empty'));assert.ok(await page.$eval('.ozon-marks-empty',e=>e.textContent.includes('не найдены')));
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.ozon-marks-table tbody tr');assert.ok(await page.$('.ozon-client-marks'),'archive remains accessible after reload without subscription');
 await page.screenshot({path:'tests/browser/artifacts/ozon-client-marks-desktop.png'});await page.setViewport({width:390,height:900});await new Promise(r=>setTimeout(r,250));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'tests/browser/artifacts/ozon-client-marks-mobile.png'});
 assert.ok(!calls.some(c=>c.path.endsWith('/ozon/assembly')||c.path.endsWith('/fulfillment')),'free archive never calls paid assembly endpoints');assert.deepEqual(errors,[]);console.log('Unpaid Ozon client: card entry, owner archive, exact clipboard, selected posting XLSX across pages, search, reload and mobile passed');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
