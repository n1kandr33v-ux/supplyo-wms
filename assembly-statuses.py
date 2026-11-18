from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace('requiresKiz?:boolean;kiz?:string}',"requiresKiz?:boolean;kiz?:string;assemblyStatus?:'waiting'|'checking'|'ready'|'error'|'kiz-error'}")
pos=s.index('function restore()')
s=s[:pos]+'''const statusLabels={waiting:'Ожидает',checking:'Проверяется',ready:'Готов',error:'Ошибка','kiz-error':'Ошибка КИЗ'} as const
function orderStatus(item:Item){return item.assemblyStatus??(item.ready?'ready':'waiting')}
'''+s[pos:]
s=s.replace("(status==='Все статусы'||i.ready===(status==='Готово'))", "(status==='Все статусы'||statusLabels[orderStatus(i)]===status)")
s=s.replace("values={['Все статусы','К сборке','Готово']}","values={['Все статусы','Ожидает','Проверяется','Готов','Ошибка','Ошибка КИЗ']}")
s=s.replace("className={i.ready?'status-ready':'status-wait'}>{i.ready&&<Check size={12}/>} {i.ready?'Готово':'К сборке'}", "className={`status-${orderStatus(i)}`}>{orderStatus(i)==='ready'&&<Check size={12}/>} {statusLabels[orderStatus(i)]}")
s=s.replace("function startPrint(_item:Item){setActionItem(null);", "function startPrint(item:Item){update(item.id,{assemblyStatus:'error',ready:false});setActionItem(null);")
s=s.replace("if(!result.valid){setKizError(result.message)","if(!result.valid){update(actionItem.id,{assemblyStatus:'kiz-error',ready:false});setKizError(result.message)")
s=s.replace("if(duplicate){setKizError(","if(duplicate){update(actionItem.id,{assemblyStatus:'kiz-error',ready:false});setKizError(")
s=s.replace("update(actionItem.id,{kiz:result.code});", "update(actionItem.id,{kiz:result.code,assemblyStatus:'checking',ready:false});")
s=s.replace("setActionMode('kiz');setKizError('');setKizValue('')","update(item.id,{assemblyStatus:'waiting',ready:false});setActionMode('kiz');setKizError('');setKizValue('')")
p.write_text(s,encoding='utf-8')
