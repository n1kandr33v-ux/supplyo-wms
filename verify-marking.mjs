import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const {validateMarking:v}=await import('./src/lib/marking.ts');
const short='0104630634160304215kohL7wqqx2Sw';
assert(v(short).valid);assert(v(short+'\x1d91ee12\x1d92'+'A'.repeat(44)).valid);assert(v(short+'91ee1292'+'A'.repeat(88)).valid);assert(v(']d2'+short).valid);assert(v(short+'\x1d93abcd').valid);
for(const bad of ['2049000000100','hello',short.slice(0,-1),short+'91ee1292abc',short.replace('0304','0305'),short+' extra'])assert(!v(bad).valid,bad);
console.log('Marking validation: 11 checks passed');

