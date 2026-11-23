export function formatFullName(value:string){
 return value.replace(/[^\p{L}\p{M}\s\-']/gu,'').replace(/\s+/g,' ').split(' ').map(part=>part.toLocaleLowerCase('ru-RU').replace(/(^|[-'])\p{L}/gu,char=>char.toLocaleUpperCase('ru-RU'))).join(' ');
}
export function fullNameError(value:string){
 const parts=value.trim().split(/\s+/);
 return value.length>150||parts.length!==3||parts.some(part=>!/^\p{L}[\p{L}\p{M}]*(?:[-']\p{L}[\p{L}\p{M}]*)*$/u.test(part)||part.replace(/[-']/g,'').length<2)?'Укажите полностью фамилию, имя и отчество — три слова.':'';
}
export function emailError(value:string){
 const email=value.trim();
 return email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(email)||email.split('@')[0].startsWith('.')||email.split('@')[0].endsWith('.')||email.split('@')[0].includes('..')?'Введите корректную почту, например name@example.ru.':'';
}
export function phoneDigits(value:string){
 let digits=value.replace(/\D/g,'');
 if(value.trim().startsWith('+7')||(digits.length!==10&&(digits.startsWith('7')||digits.startsWith('8'))))digits=digits.slice(1);
 return digits.slice(0,10);
}
export function formatPhone(value:string){
 const digits=phoneDigits(value);if(!digits)return value?'+7':'';
 let result='+7 ('+digits.slice(0,3);
 if(digits.length>=3)result+=')';
 if(digits.length>3)result+=' '+digits.slice(3,6);
 if(digits.length>6)result+='-'+digits.slice(6,8);
 if(digits.length>8)result+='-'+digits.slice(8,10);
 return result;
}
export function phoneError(value:string){return /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(value)?'':'Введите номер полностью: +7 (999) 123-45-67.'}
