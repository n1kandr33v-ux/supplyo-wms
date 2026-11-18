const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const root=path.resolve('dist');
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(404).end();return}const target=file===root?path.join(root,'index.html'):file;try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});


 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:393,height:852,isMobile:true,hasTouch:true});await page.setRequestInterception(true);
 let authenticated=false,offline=false;const calls=[];const notes=[{id:'existing',item_id:'1002',author_name:'Анна',text:'На верхней полке',created_at:Date.now()}];let dropNote=true;const noteIds=[];
 page.on('request',async req=>{
 if(!req.url().includes('/api/'))return req.continue();const p=new URL(req.url()).pathname;calls.push([req.method(),p]);let data={},status=200;
 if(offline)return req.abort('internetdisconnected');
 if(p==='/api/auth/login'){if(JSON.parse(req.postData()).password==='correct-password'){authenticated=true;data={ok:true};}else{status=400;data={error:'Неверная почта или пароль'};}}
 else if(p==='/api/me'){if(!authenticated){status=401;data={error:'Войдите в аккаунт'};}else data={name:'Иван',email:'picker@example.test'};}
 else if(p==='/api/auth/logout'){authenticated=false;data={ok:true};}
 else if(p==='/api/stores')data={stores:[{id:'own',name:'ИП Филиппов Е. В.',status:'ready'},{id:'empty',name:'Другой магазин',status:'ready'}]};
 else if(p.endsWith('/mobile-notes')){if(req.method()==='POST'){const body=JSON.parse(req.postData());if(body.action==='delete'){const n=notes.findIndex(n=>n.id===body.id);if(n>=0)notes.splice(n,1);return req.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});}noteIds.push(body.id);let note=notes.find(n=>n.id===body.id);if(!note){note={id:body.id,item_id:body.itemId,author_name:'Иван',text:body.text,created_at:Date.now(),can_delete:true};notes.push(note);}if(dropNote){dropNote=false;return req.abort('internetdisconnected');}data={note};}else data={notes};}
 else if(p.endsWith('/fulfillment'))data=p.includes('/empty/')?{supplies:[],items:[]}:{supplies:[{id:'s1',name:'Основная поставка',closed:false},{id:'s2',name:'Вторая поставка',closed:false},{id:'old',closed:true}],items:[{id:'1002',supply_id:'s1',snapshot:{article:'Диффузор для стайлера',skus:['2057077336172']},status:'Ожидает',printed:false,cell:'Ф-22',sticker_text:'5970566 8793'},{id:'1001',supply_id:'s1',snapshot:{article:'Диффузор для стайлера',skus:['2057077336172']},status:'Готов',printed:true,cell:'Ф-22',sticker_text:'5971130 5377'},{id:'1003',supply_id:'s1',snapshot:{article:'LED-маска',skus:['2048076031090']},status:'Готов',printed:true,cell:'Ф-10',address:'A-1-1'}]};
 return req.respond({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/?mobile=1#mobile',{waitUntil:'networkidle0'});
 assert.ok(await page.$('#m-email'));await page.screenshot({path:'tests/browser/artifacts/mobile-login.png',fullPage:true});
 await page.type('#m-email','picker@example.test');await page.type('#m-password','wrong');await page.click('.m-primary');await page.waitForSelector('.m-error');assert.match(await page.$eval('.m-error',e=>e.textContent),/Неверная/);
 await page.$eval('#m-password',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.type('#m-password','correct-password');await page.click('.m-primary');await page.waitForSelector('.m-shop');assert.equal((await page.$$('.m-shop')).length,2);await page.screenshot({path:'tests/browser/artifacts/mobile-stores.png',fullPage:true});

 await page.click('.m-shop');await page.waitForSelector('.m-pick-v2');assert.equal((await page.$$('.m-pick-v2')).length,2,'all orders visible regardless of website status');
 assert.ok(!(await page.$eval('.m-pick-list',e=>e.textContent)).includes('Диффузор'),'product name only in notes');
 const marked=()=>page.$eval('.m-progress-panel strong',e=>e.textContent.trim());assert.equal(await marked(),'0 / 3');
 const cards=await page.$$('.m-pick-v2'),rect=await cards[1].boundingBox();const x=rect.x+rect.width/2,y=rect.y+30;
 await page.touchscreen.tap(x,y);assert.equal(await marked(),'0 / 3','one tap does nothing');await new Promise(r=>setTimeout(r,80));await page.touchscreen.tap(x,y);assert.equal(await marked(),'2 / 3');assert.equal((await page.$$('.m-picked')).length,1);
 await new Promise(r=>setTimeout(r,350));await page.touchscreen.tap(x,y);await page.touchscreen.tap(x,y);assert.equal(await marked(),'0 / 3','next double tap removes mark');
 await page.touchscreen.tap(x,y);await page.touchscreen.tap(x,y);assert.equal(await marked(),'2 / 3');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.m-pick-v2');assert.equal(await marked(),'2 / 3','marks persist on this phone after reload');

 await page.$$eval('.m-pick-v2',es=>es[1].scrollIntoView({block:'center'}));await new Promise(r=>setTimeout(r,150));const before=await marked();const card=await (await page.$$('.m-pick-v2'))[1].boundingBox();const client=await page.createCDPSession();
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:card.x+card.width-20,y:card.y+25}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:card.x+card.width-50,y:card.y+25}]});
 await new Promise(r=>setTimeout(r,50));const shift=await page.$$eval('.m-pick-v2',es=>new DOMMatrix(getComputedStyle(es[1]).transform).m41);assert.ok(shift< -5,'card follows partial swipe');
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,350));assert.equal(await page.$$eval('.m-pick-v2',es=>new DOMMatrix(getComputedStyle(es[1]).transform).m41),0,'partial swipe settles back');assert.ok(!await page.$('[role=dialog]'));

 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:card.x+card.width-20,y:card.y+25}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:card.x+30,y:card.y+26}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForSelector('[role="dialog"]');assert.equal(await marked(),before,'swipe does not toggle');
 assert.match(await page.$eval('[role="dialog"]',e=>e.textContent),/Диффузор для стайлера/);assert.match(await page.$eval('[role="dialog"]',e=>e.textContent),/Анна/);
 await page.type('#m-note-text','Коробка справа');await page.click('[aria-label="Отправить заметку"]');await page.waitForSelector('.m-note-form .m-error');assert.equal(await page.$eval('#m-note-text',e=>e.value),'Коробка справа');
 await page.click('[aria-label="Отправить заметку"]');await page.waitForFunction(()=>document.querySelector('#m-note-text')?.value==='');assert.equal(noteIds.length,2);assert.equal(noteIds[0],noteIds[1],'retry retains id');assert.equal(notes.filter(n=>n.text==='Коробка справа').length,1);
 await page.click('[aria-label="Удалить заметку"]');await page.click('.m-note-confirm button:first-child');assert.equal(notes.length,2,'cancel preserves note');await page.click('[aria-label="Удалить заметку"]');await page.click('.m-note-confirm-delete');await page.waitForFunction(()=>!document.querySelector('.m-note-confirm'));assert.equal(notes.length,1);assert.ok(!(await page.$eval('[role="dialog"]',e=>e.textContent)).includes('Коробка справа'));await page.screenshot({path:'tests/browser/artifacts/mobile-v2-notes.png',fullPage:true});await page.click('[aria-label="Закрыть заметки"]');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 assert.equal(await marked(),before);assert.equal(await page.$eval('.m-note-badge span',e=>e.textContent),'1');assert.ok(!(await page.$eval('.m-pick-list',e=>e.textContent)).includes('Отмечено'),'no visible check caption');const geometry=await page.$eval('.m-picked',e=>({height:e.getBoundingClientRect().height,badge:e.querySelector('.m-note-badge').getBoundingClientRect().top,row:e.querySelector('.m-pick-secondary').getBoundingClientRect().top}));console.log(geometry);await page.screenshot({path:'tests/browser/artifacts/mobile-compact-preview.png',fullPage:true});assert.ok(geometry.height<=140,'compact card');assert.ok(Math.abs(geometry.badge-geometry.row)<2,'badge on barcode row');await page.screenshot({path:'tests/browser/artifacts/mobile-v2-cards.png',fullPage:true});
 await page.select('#m-supply','s2');await page.waitForFunction(()=>document.querySelector('.m-progress-panel strong')?.textContent.trim()==='0 / 0');await page.select('#m-supply','s1');await page.waitForFunction(()=>document.querySelector('.m-progress-panel strong')?.textContent.trim()==='2 / 3');
 await page.setViewport({width:320,height:740,isMobile:true,hasTouch:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(!calls.some(([method,path])=>method==='POST'&&!path.endsWith('/mobile-notes')&&!path.startsWith('/api/auth/')),'phone never posts to website fulfillment endpoints');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);assert.equal(await page.$eval('.m-swipe-shell',e=>getComputedStyle(e).animationName),'none');assert.equal(await page.$eval('.m-tabs',e=>getComputedStyle(e,'::before').transitionDuration),'0s');
 assert.deepEqual(errors,[]);console.log('Mobile v2: single/double taps, undo, no jumps, local persistence, supply isolation, left swipe, shared notes retry/badge, narrow layout and no desktop mutations passed');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
