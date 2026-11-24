import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
export function BarcodeCamera({onCode,onClose}:{onCode:(value:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),[error,setError]=useState('');const callbacks=useRef({onCode,onClose});callbacks.current={onCode,onClose};
 useEffect(()=>{
  let cancelled=false,found=false,controls:{stop:()=>void}|undefined;
  const preview=video.current;
  function stop(){controls?.stop();const stream=preview?.srcObject as MediaStream|null;stream?.getTracks().forEach(track=>track.stop());if(preview)preview.srcObject=null}
  const hidden=()=>{if(document.hidden){stop();callbacks.current.onClose()}};document.addEventListener('visibilitychange',hidden);
  void (async()=>{try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Камера недоступна. Откройте supply по HTTPS в браузере или установите новую версию приложения.');
   const {BrowserMultiFormatReader}=await import('@zxing/browser');if(cancelled)return;
   const reader=new BrowserMultiFormatReader();
   const started=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},preview!,result=>{
    if(!result||cancelled||found)return;found=true;stop();callbacks.current.onCode(result.getText());
   });controls=started;if(cancelled||found)stop();
  }catch(e){if(cancelled)return;const err=e as Error;setError(err.name==='NotAllowedError'?'Нет доступа к камере. Разрешите камеру для supply в настройках приложения или браузера.':err.name==='NotFoundError'?'Камера не найдена. Введите баркод вручную.':err.name==='NotReadableError'?'Камера занята другим приложением. Закройте его и повторите.':err.message||'Не удалось открыть камеру.');stop()}})();
  return()=>{cancelled=true;document.removeEventListener('visibilitychange',hidden);stop()};
 },[]);
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog.Portal><Dialog.Overlay className="m-notes-overlay"/><Dialog.Content className="m-camera"><div className="m-title-row"><Dialog.Title>Сканировать баркод</Dialog.Title><Dialog.Close className="m-icon" aria-label="Закрыть камеру"><X size={22}/></Dialog.Close></div><Dialog.Description>Наведите заднюю камеру на штрихкод товара. После распознавания камера закроется.</Dialog.Description><video ref={video} muted playsInline autoPlay aria-label="Камера сканера"/>{error&&<p role="alert" className="m-error">{error}</p>}<button className="m-secondary" onClick={onClose}>Ввести вручную</button></Dialog.Content></Dialog.Portal></Dialog.Root>
}
