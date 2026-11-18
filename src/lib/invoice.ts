export type PriceService={id:string;title:string;unit:string;rate:number};
export type InvoiceItem={serviceId:string;title:string;unit:string;quantity:number;rate:number};
// Integer milliunits × integer kopecks: decimal ties such as 1.005 × 9 must be 9.05.
function lineKopecks({quantity,rate}:Pick<InvoiceItem,'quantity'|'rate'>){
 if(!Number.isFinite(quantity)||!Number.isFinite(rate)||quantity<0||rate<0||quantity>1e9||rate>1e12)return 0n;
 return (BigInt(Math.round(quantity*1000))*BigInt(Math.round(rate*100))+500n)/1000n;
}
export const invoiceLine=(item:Pick<InvoiceItem,'quantity'|'rate'>)=>Number(lineKopecks(item))/100;
export const invoiceTotal=(items:Pick<InvoiceItem,'quantity'|'rate'>[])=>Number(items.reduce((sum,item)=>sum+lineKopecks(item),0n))/100;
