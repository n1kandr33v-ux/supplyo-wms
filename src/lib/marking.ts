import { normalizeScannerText } from './scanner-input.ts'
export type MarkingResult = { valid: true; code: string; identity: string } | { valid: false; message: string }
// GS1 identification (01/21), long 91+92 and compact 93 verification blocks.
// This checks structure only; authenticity/status require the marking provider API.
export function validateMarking(input: string): MarkingResult {
 const fail = (): MarkingResult => ({ valid:false, message:'Это не КИЗ. Отсканируйте код маркировки Data Matrix.' })
 const code=normalizeScannerText(input).replace(/^\](?:d2|Q3)/,'').replace(/[\r\n]+$/,'').replace(/^\u001d/,'')
 if(!code || /[^\x20-\x7e\x1d]/.test(code))return fail()
 const head=/^01(\d{14})21/.exec(code)
 if(!head)return fail()
 const gtin=head[1]; const sum=gtin.slice(0,-1).split('').reverse().reduce((n,d,i)=>n+Number(d)*(i%2===0?3:1),0)
 if((10-sum%10)%10!==Number(gtin[13]))return fail()
 const body=code.slice(18)
 for(const length of [13,6]){
  const serial=body.slice(0,length)
  if(serial.length!==length || !/^[\x21-\x7e]+$/.test(serial))continue
  const tail=body.slice(length)
  // Short identification is accepted for 13-character clothing serial numbers.
  if(length===13 && !tail)return {valid:true,code,identity:code}
  const long=/^[\x1d ]?91([\x21-\x7e]{4})[\x1d ]?92([\x21-\x7e]{44}|[\x21-\x7e]{88})$/.exec(tail)
  const compact=/^[\x1d ]?93([\x21-\x7e]{4})$/.exec(tail)
  const identity=code.slice(0,18+length)
  // Only restore separators at known, validated GS1 boundaries. Never strip
  // arbitrary spaces or change the serial number / cryptographic signature.
  if(long)return {valid:true,code:identity+'\x1d91'+long[1]+'\x1d92'+long[2],identity}
  if(compact)return {valid:true,code:identity+'\x1d93'+compact[1],identity}
 }
 return fail()
}
