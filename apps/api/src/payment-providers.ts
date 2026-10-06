import { Injectable, BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export interface ProviderResult {
 status:string; reference:string; amount:number; currency:string;
 phone?:string; email?:string; transactionId?:string;
}
export interface MobileMoneyGateway {
 readonly code:string; readonly recoverMissing:boolean;
 currency():string; sandbox():boolean; assertConfigured():void;
 submit(payment:any):Promise<{authorizationUrl?:string}>;
 status(payment:any):Promise<ProviderResult|null>;
}

@Injectable()
export class Flutterwave implements MobileMoneyGateway {
 readonly code='FLUTTERWAVE'; readonly recoverMissing=false;
 currency(){return 'RWF';}
 sandbox(){return (process.env.FLUTTERWAVE_MODE||'test')==='test';}
 assertConfigured(){
  const mode=process.env.FLUTTERWAVE_MODE||'test',key=process.env.FLUTTERWAVE_SECRET_KEY;
  if(!['test','live'].includes(mode)||!key||!key.startsWith('FLWSECK-')&&!key.startsWith('FLWSECK_TEST-')||key.startsWith('FLWSECK_TEST-')!==(mode==='test')){
   throw new ServiceUnavailableException('Configure the matching Flutterwave v3 secret key and payment mode.');
  }
 }
 private headers(){this.assertConfigured();return {'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`};}
 private assertPaymentMode(p:any){
  if(p.sandbox!==this.sandbox())throw new ServiceUnavailableException('This payment was created in a different Flutterwave mode. Reconcile it with its original credentials.');
 }
 async submit(p:any){
  this.assertPaymentMode(p);
  const r=await fetch('https://api.flutterwave.com/v3/charges?type=mobile_money_rwanda',{
   method:'POST',headers:this.headers(),signal:AbortSignal.timeout(15000),
   body:JSON.stringify({amount:p.amount,currency:p.provider_currency,tx_ref:p.reference,order_id:p.id,
    phone_number:p.phone,email:p.payer_email,fullname:p.payer_name,meta:{payment_id:p.id,order_id:p.order_id}})
  });
  // Only explicit validation failures permit a new attempt. Unknown outcomes stay pending.
  if(r.status===400||r.status===422)throw new BadRequestException('Flutterwave rejected the payment request. Check the wallet number or contact the shop.');
  if(!r.ok)throw new ServiceUnavailableException('Flutterwave payment submission is uncertain. Check payment before trying again.');
  const body:any=await r.json();
  if(body.status!=='success')throw new ServiceUnavailableException('Flutterwave payment submission is uncertain.');
  const authorization=body.meta?.authorization;
  if(authorization?.mode==='redirect'){
   const url=paymentAuthorizationUrl(authorization.redirect);
   if(!url)throw new ServiceUnavailableException('Flutterwave returned an unsupported confirmation address. Contact the shop and check payment.');
   return {authorizationUrl:url};
  }
  if(body.data?.id)return {};
  throw new ServiceUnavailableException('Flutterwave did not return payment confirmation details. Check payment.');
 }
 async status(p:any):Promise<ProviderResult|null>{
  this.assertPaymentMode(p);
  const r=await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(p.reference)}`,{headers:this.headers(),signal:AbortSignal.timeout(15000)});
  const body:any=await r.json().catch(()=>null);
  // An absent transaction never proves a timed-out charge was not accepted.
  if(r.status===404||r.status===400&&body?.status==='error'&&/^no transaction (?:was )?found/i.test(body.message||''))return null;
  if(!r.ok||body?.status!=='success'||!body.data)throw new ServiceUnavailableException('Flutterwave verification is unavailable. Payment remains pending.');
  const d=body.data;
  return {status:String(d.status).toUpperCase(),reference:d.tx_ref,amount:Number(d.amount),currency:d.currency,
   phone:d.customer?.phone_number||undefined,email:d.customer?.email,transactionId:d.id==null?undefined:String(d.id)};
 }
 verifyWebhook(hash:unknown){
  const secret=process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  if(!secret)throw new ServiceUnavailableException('Flutterwave webhook verification is not configured');
  if(typeof hash!=='string'||Buffer.byteLength(hash)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(hash),Buffer.from(secret)))throw new UnauthorizedException('Invalid payment webhook');
 }
}

// These hosts are published in Flutterwave's v3 Rwanda confirmation-page examples.
// The API returns the address; never accept a redirect address from the customer.
export function paymentAuthorizationUrl(value:unknown):string|null {
 if(typeof value!=='string')return null;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['checkout.flutterwave.com','ravemodal-dev.herokuapp.com'].includes(u.hostname)?u.href:null;}catch{return null;}
}

// Retained only to reconcile MTN requests created before the switch.
@Injectable()
export class Momo implements MobileMoneyGateway {
 readonly code='MOMO'; readonly recoverMissing=true;
 private cached?:{value:string;expires:number};
 private get base(){return process.env.MOMO_BASE_URL||'https://sandbox.momodeveloper.mtn.com';}
 private get env(){return process.env.MOMO_TARGET_ENVIRONMENT||'sandbox';}
 currency(){return this.env==='sandbox'?'EUR':'RWF';}
 sandbox(){return this.env==='sandbox';}
 assertConfigured(){if(!process.env.MOMO_SUBSCRIPTION_KEY||!process.env.MOMO_API_USER||!process.env.MOMO_API_KEY)throw new ServiceUnavailableException('Legacy MTN credentials are required to reconcile this payment. Please contact the shop.');}
 private async bearer(){
  this.assertConfigured();if(this.cached&&this.cached.expires>Date.now())return this.cached.value;
  const r=await fetch(`${this.base}/collection/token/`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':process.env.MOMO_SUBSCRIPTION_KEY!,Authorization:`Basic ${Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString('base64')}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new ServiceUnavailableException('Could not authenticate the legacy payment provider');
  const j:any=await r.json();this.cached={value:j.access_token,expires:Date.now()+(j.expires_in-60)*1000};return j.access_token;
 }
 async submit(p:any){
  const headers:Record<string,string>={'Content-Type':'application/json','Ocp-Apim-Subscription-Key':process.env.MOMO_SUBSCRIPTION_KEY!,'X-Target-Environment':this.env,'X-Reference-Id':p.reference,Authorization:`Bearer ${await this.bearer()}`};
  if(process.env.MOMO_CALLBACK_BASE)headers['X-Callback-Url']=`${process.env.MOMO_CALLBACK_BASE}/api/v1/payments/momo/callback/${p.reference}`;
  const r=await fetch(`${this.base}/collection/v1_0/requesttopay`,{method:'POST',headers,body:JSON.stringify({amount:String(p.amount),currency:p.provider_currency,externalId:p.id,payer:{partyIdType:'MSISDN',partyId:p.phone},payerMessage:'Maison Munezero order payment',payeeNote:'Maison Munezero'}),signal:AbortSignal.timeout(15000)});
  if(r.status===202||r.status===409)return {};
  if(r.status>=400&&r.status<500)throw new BadRequestException('Payment request rejected by provider');
  throw new ServiceUnavailableException('Payment submission is uncertain. Use Check payment; do not start another payment.');
 }
 async status(p:any):Promise<ProviderResult|null>{
  const r=await fetch(`${this.base}/collection/v1_0/requesttopay/${p.reference}`,{headers:{'Ocp-Apim-Subscription-Key':process.env.MOMO_SUBSCRIPTION_KEY!,'X-Target-Environment':this.env,Authorization:`Bearer ${await this.bearer()}`},signal:AbortSignal.timeout(15000)});
  if(r.status===404)return null;if(!r.ok)throw new ServiceUnavailableException('Legacy payment provider unavailable');const d:any=await r.json();
  return {status:d.status,reference:d.externalId,amount:Number(d.amount),currency:d.currency,phone:d.payer?.partyId,transactionId:d.financialTransactionId};
 }
}

@Injectable()
export class PaymentProviders {
 constructor(private flutterwave:Flutterwave,private momo:Momo){}
 current():MobileMoneyGateway{return this.flutterwave;}
 forPayment(p:any):MobileMoneyGateway{if(p.provider==='FLUTTERWAVE')return this.flutterwave;if(p.provider==='MOMO')return this.momo;throw new BadRequestException('This payment does not use a mobile-money provider');}
}
