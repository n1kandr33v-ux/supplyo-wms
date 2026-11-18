import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scannerKey, normalizeScannerText, insertScanText} from '../src/lib/scanner-input.ts';
import {validateMarking} from '../src/lib/marking.ts';

const english = '01046704697319662153"WhLG*!pW3&91EE1292T+xqUty4+a+6HsVRiREjfAVCU3vE6hfRnSbtdB1nNWA=';
const russian = '01046704697319662153ЭЦрДП*!зЦ3?91УУ1292Е+чйГен4+ф+6РыМКшКУоаФМСГ3мУ6раКтЫиевИ1тТЦФ=';
const canonical = english.slice(0,31)+'\x1d'+english.slice(31,37)+'\x1d'+english.slice(37);
test('scanner converts the complete Russian-layout sample without corrupting English',()=>{
  assert.equal(normalizeScannerText(russian),english);
  assert.equal(normalizeScannerText(english),english);
  assert.equal(normalizeScannerText('2049000000100'),'2049000000100');
  const event=(key:string,code:string,shiftKey=false,ctrlKey=false)=>({key,code,shiftKey,ctrlKey,altKey:false,metaKey:false});
  assert.equal(scannerKey(event('Э','Quote',true)),'"');
  assert.equal(scannerKey(event('?','Digit7',true)),'&');
  assert.equal(scannerKey(event('№','Digit3',true)),'#');
  assert.equal(scannerKey(event('ж','Semicolon')), ';');
  assert.equal(scannerKey(event('Ц','KeyW',true)), 'W');
  assert.equal(scannerKey(event('F8','F8')),'\x1d');
  assert.equal(scannerKey(event(']','BracketRight',false,true)),'\x1d');
  assert.equal(scannerKey(event('v','KeyV',false,true)),null);
  assert.equal(scannerKey(event('Enter','Enter')),null);
  assert.equal(insertScanText('abcd',1,3,'X'),'aXd');
});
test('KIZ restores only validated GS1 boundaries for scanner and phone formats',()=>{
  for(const input of [english,russian,canonical,english.slice(0,31)+' '+english.slice(31,37)+' '+english.slice(37),']d2'+canonical+'\r\n']){
    const result=validateMarking(input);
    assert.equal(result.valid,true);
    if(result.valid){assert.equal(result.code,canonical);assert.equal(result.identity,english.slice(0,31));}
  }
  for(const input of [english.replace('04670469731966','04670469731967'),english.slice(0,-1),english.slice(0,25)+' '+english.slice(26),'4601234567890']){
    assert.equal(validateMarking(input).valid,false);
  }
  const short=validateMarking(english.slice(0,31));
  assert.equal(short.valid,true);
  if(short.valid)assert.equal(short.code,english.slice(0,31));
});
