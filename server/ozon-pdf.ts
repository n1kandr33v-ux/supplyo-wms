import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
export type PrintSticker={file:string;width_mm:number;height_mm:number};
const exec=promisify(execFile);
export async function renderOzonPdf(pdf:Buffer):Promise<PrintSticker[]>{
 if(pdf.length>16*1024*1024||pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Некорректный PDF этикетки Ozon.');
 const prefix=join(tmpdir(),'supply-ozon-label-'),dir=await mkdtemp(prefix);
 try{
  const input=join(dir,'label.pdf');await writeFile(input,pdf,{mode:0o600});
  const options={timeout:30000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,LC_ALL:'C',LANG:'C'}};
  const info=await exec(process.env.SUPPLY_PDFINFO||'pdfinfo',[input],options);
  const count=Number(/^Pages:\s*(\d+)/m.exec(info.stdout)?.[1]);if(!Number.isSafeInteger(count)||count<1||count>20)throw Error('Некорректное количество страниц этикетки Ozon.');
  // Bound resource use before rasterization as well as after it.
  const box=await exec(process.env.SUPPLY_PDFINFO||'pdfinfo',['-f','1','-l',String(count),'-box',input],options);
  const sizes=[...box.stdout.matchAll(/(?:Page\s+\d+\s+size:|Page size:)\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/g)];
  if(!sizes.length||sizes.some(m=>Number(m[1])>700||Number(m[2])>700))throw Error('Размер PDF не соответствует этикетке.');
  await exec(process.env.SUPPLY_PDFTOPPM||'pdftoppm',['-r','300','-png','-cropbox',input,join(dir,'page')],options);
  const files=(await readdir(dir)).filter(f=>/^page-\d+\.png$/.test(f)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));if(files.length!==count)throw Error('Получены не все страницы этикетки.');
  const boxes=[...box.stdout.matchAll(/Page\s+(\d+)\s+CropBox:\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/g)];
  const rotations=new Map([...box.stdout.matchAll(/Page\s+(\d+)\s+rot:\s*(-?\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]));
  if(boxes.length!==count)throw Error('Не определены размеры всех страниц.');
  const pages:PrintSticker[]=[];
  for(const file of files){const png=await readFile(join(dir,file));if(png.length>3*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Некорректное изображение этикетки.');const width=png.readUInt32BE(16),height=png.readUInt32BE(20),pageNumber=pages.length+1,bounds=boxes.find(m=>Number(m[1])===pageNumber)!;let w=(Number(bounds[4])-Number(bounds[2]))*25.4/72,h=(Number(bounds[5])-Number(bounds[3]))*25.4/72;if(Math.abs(rotations.get(pageNumber)||0)%180===90)[w,h]=[h,w];if(Math.abs(width*25.4/300-w)>0.3||Math.abs(height*25.4/300-h)>0.3)throw Error('Размер страницы не совпадает с изображением.');if(width>3000||height>3000||w<20||h<20||w>220||h>220)throw Error('Неподдерживаемый размер этикетки Ozon.');pages.push({file:png.toString('base64'),width_mm:Math.round(w*100)/100,height_mm:Math.round(h*100)/100});}
  if(pages.reduce((n,p)=>n+p.file.length,0)>32*1024*1024)throw Error('Слишком большой пакет этикеток.');
  return pages;
 }finally{const target=resolve(dir);if(!target.startsWith(resolve(tmpdir())+sep+'supply-ozon-label-'))throw Error('Invalid temporary label directory');await rm(target,{recursive:true,force:true});}
}
