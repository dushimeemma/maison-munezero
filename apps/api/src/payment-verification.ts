import { ProviderResult } from './payment-providers';

// Financial identity comes from the authenticated provider lookup and our unique
// merchant reference, not the provider's reusable customer-profile contacts.
// https://developer.flutterwave.com/docs/transaction-verification
export function paymentMismatchFields(p:any,result:ProviderResult):string[]{
 const fields:string[]=[];
 if(result.reference!==(p.provider==='MOMO'?p.id:p.reference))fields.push('reference');
 if(!Number.isFinite(result.amount)||result.amount!==p.amount)fields.push('amount');
 if(result.currency!==p.provider_currency)fields.push('currency');
 if(p.provider==='MOMO'&&result.phone!==p.phone)fields.push('phone');
 if(result.status==='SUCCESSFUL'&&(!result.transactionId||!result.transactionId.trim()))fields.push('transactionId');
 return fields;
}
