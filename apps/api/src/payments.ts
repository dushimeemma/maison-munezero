import { Body, Controller, Get, Post, Param, Req, Injectable, ConflictException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { Db, Sql, one, audit, notify } from './db';
import { Actor, Allow, Public, sales, finance, parse, uuid, money, phone, text } from './security';
import { OrderService } from './orders';
@Injectable()
export class Momo {
 private cached?:{value:string;expires:number};
 private get base(){return process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';}
 private get env(){return process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox';}
 private get key(){if(!process.env.MOMO_SUBSCRIPTION_KEY)throw new ServiceUnavailableException('MoMo has not been configured. Please contact the shop.');return process.env.MOMO_SUBSCRIPTION_KEY;}
 currency(){return this.env==='sandbox'?'EUR':'RWF';}
 assertConfigured(){if(!process.env.MOMO_SUBSCRIPTION_KEY||!process.env.MOMO_API_USER||!process.env.MOMO_API_KEY)throw new ServiceUnavailableException('MoMo has not been configured. Please contact the shop.');}
 async bearer(){
  if(this.cached&&this.cached.expires>Date.now())return this.cached.value;
  const r=await fetch(`${this.base}/collection/token/`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':this.key,Authorization:`Basic ${Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString('base64')}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new ServiceUnavailableException('Could not authenticate the payment provider');
  const j:any=await r.json();this.cached={value:j.access_token,expires:Date.now()+(j.expires_in-60)*1000};return j.access_token;
 }
 async submit(p:any){
  const headers:Record<string,string>={'Content-Type':'application/json','Ocp-Apim-Subscription-Key':this.key,'X-Target-Environment':this.env,'X-Reference-Id':p.reference,Authorization:`Bearer ${await this.bearer()}`};
  if(process.env.MOMO_CALLBACK_BASE)headers['X-Callback-Url']=`${process.env.MOMO_CALLBACK_BASE}/api/v1/payments/momo/callback/${p.reference}`;
  const r=await fetch(`${this.base}/collection/v1_0/requesttopay`,{method:'POST',headers,body:JSON.stringify({amount:String(p.amount),currency:p.provider_currency,externalId:p.id,payer:{partyIdType:'MSISDN',partyId:p.phone},payerMessage:'Maison Munezero order payment',payeeNote:'Maison Munezero'}),signal:AbortSignal.timeout(15000)});
  if(r.status===202||r.status===409)return 'SENT';
  // Definitive validation failures cannot debit the wallet. Timeouts and 5xx remain uncertain.
  if(r.status>=400&&r.status<500)throw new BadRequestException('Payment request rejected by provider');
  throw new ServiceUnavailableException('Payment submission is uncertain. Use Check payment; do not start another payment.');
 }
 async status(reference:string){
  const r=await fetch(`${this.base}/collection/v1_0/requesttopay/${reference}`,{headers:{'Ocp-Apim-Subscription-Key':this.key,'X-Target-Environment':this.env,Authorization:`Bearer ${await this.bearer()}`},signal:AbortSignal.timeout(15000)});
  if(r.status===404)return null;if(!r.ok)throw new ServiceUnavailableException('Payment provider unavailable');return r.json() as Promise<any>;
 }
}
@Injectable()
export class PaymentService {
 constructor(private db:Db,private orders:OrderService,private momo:Momo){}
 async start(id:string,a:Actor,body:any,key:string){
  this.momo.assertConfigured();
  const d=parse(z.object({phone:phone,portion:z.enum(['DUE','BALANCE']).default('DUE')}).strict(),body);
  const p=await this.db.tx(async sql=>{
   const old=await this.orders.key(sql,a,key,'momo',{orderId:id,...d});if(old)return one(sql,'SELECT * FROM payments WHERE id=$1',[old]);
   const o=await this.orders.visible(sql,id,a,true);
   if(await one(sql,"SELECT id FROM returns WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED','RECEIVED')",[id]))throw new ConflictException('This order is under return review');
   if(a.role!=='CUSTOMER'&&!sales.includes(a.role))throw new BadRequestException('Payment is unavailable for your role');
   if(['CANCELLED','COMPLETED'].includes(o.status)||o.paid>=o.total)throw new ConflictException('No payment is due');
   const pending=await one(sql,"SELECT * FROM payments WHERE order_id=$1 AND status='PENDING'",[id]);
   if(pending)throw new ConflictException('A payment is already pending. Check its status first.');
   const amount=d.portion==='BALANCE'?o.total-o.paid:Math.max(o.deposit_due-o.paid,o.paid>=o.deposit_due?o.total-o.paid:0);
   const payment=await one(sql,'INSERT INTO payments(order_id,provider,amount,provider_currency,phone,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,'MOMO',amount,this.momo.currency(),d.phone,a.id]);
   await sql.query('UPDATE request_keys SET result_id=$4 WHERE user_id=$1 AND key=$2 AND scope=$3',[a.id,key,'momo',payment.id]);
   await audit(sql,a.id,'MOMO_REQUESTED',payment.id,{amount,orderId:id});return payment;
  });
  if(p.status!=='PENDING')return this.safe(p);
  if(p.submission==='NEW'){
   // Claim before external I/O. Repeated HTTP requests cannot submit twice.
   const claim=await one(this.db,"UPDATE payments SET submission='UNCERTAIN' WHERE id=$1 AND submission='NEW' RETURNING id",[p.id]);
   if(claim)try{await this.momo.submit(p);await this.db.query("UPDATE payments SET submission='SENT' WHERE id=$1",[p.id]);}
   catch(error){
    if(error instanceof BadRequestException)await this.db.query("UPDATE payments SET status='FAILED',failure='Provider rejected the request',checked_at=now() WHERE id=$1 AND status='PENDING'",[p.id]);
    else await this.db.query("UPDATE payments SET failure='Awaiting provider reconciliation. Do not pay again.' WHERE id=$1 AND status='PENDING'",[p.id]);
   }
  }return this.safe(await one(this.db,'SELECT * FROM payments WHERE id=$1',[p.id]));
 }
 safe(p:any){return {id:p.id,orderId:p.order_id,provider:p.provider,amount:p.amount,status:p.status,failure:p.failure,submission:p.submission,providerCurrency:p.provider_currency,sandbox:p.provider_currency==='EUR'};}
 async reconcile(reference:string){
  const p=await one(this.db,'SELECT * FROM payments WHERE reference=$1',[reference]);if(!p||p.status!=='PENDING')return p?this.safe(p):{ok:true};
  const result=await this.momo.status(reference);
  await this.db.query('UPDATE payments SET checked_at=now() WHERE id=$1',[p.id]);
  if(!result){
   // Recover a crash or timeout by retrying the identical provider UUID, never a new payment.
   if(['NEW','UNCERTAIN'].includes(p.submission)&&Date.now()-new Date(p.created_at).getTime()>30000){
    try{await this.db.query("UPDATE payments SET submission='UNCERTAIN' WHERE id=$1 AND status='PENDING'",[p.id]);await this.momo.submit(p);await this.db.query("UPDATE payments SET submission='SENT',failure=NULL WHERE id=$1 AND status='PENDING'",[p.id]);}
    catch(error){if(error instanceof BadRequestException)await this.db.query("UPDATE payments SET status='FAILED',failure='Provider rejected the request' WHERE id=$1 AND status='PENDING'",[p.id]);}
   }
   return this.safe(await one(this.db,'SELECT * FROM payments WHERE id=$1',[p.id]));
  }
  if(!['SUCCESSFUL','FAILED'].includes(result.status))return this.safe(p);
  // A callback is only a wake-up signal. Financial truth is fetched using our merchant credentials.
  if(String(result.externalId)!==p.id||Number(result.amount)!==p.amount||result.currency!==p.provider_currency||result.payer?.partyId!==p.phone)throw new ConflictException('Provider payment does not match this request');
  return this.db.tx(async sql=>{
   // Consistent lock order throughout payment creation, cash and reconciliation.
   const o=await one(sql,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[p.order_id]);
   const locked=await one(sql,'SELECT * FROM payments WHERE id=$1 FOR UPDATE',[p.id]);if(locked.status!=='PENDING')return this.safe(locked);
   if(result.status==='SUCCESSFUL'){
    if(o.status==='CANCELLED'||o.paid+p.amount>o.total)throw new ConflictException('Payment requires finance review');
    await this.apply(sql,o,p.amount,null);
   }
   const updated=await one(sql,'UPDATE payments SET status=$2,provider_transaction_id=$3,failure=$4,checked_at=now() WHERE id=$1 RETURNING *',[p.id,result.status,result.financialTransactionId||null,result.status==='FAILED'?'Payment was declined or failed':null]);
   await audit(sql,null,`MOMO_${result.status}`,p.id,{orderId:o.id,amount:p.amount});return this.safe(updated);
  });
 }
 async apply(sql:Sql,o:any,amount:number,actor:string|null){
  const paid=o.paid+amount;const status=o.status==='AWAITING_PAYMENT'&&paid>=o.deposit_due?'CONFIRMED':o.status;
  await sql.query('UPDATE orders SET paid=$2,status=$3,updated_at=now() WHERE id=$1',[o.id,paid,status]);
  await sql.query('INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,$2,$3,$4)',[o.id,status,`Payment received: ${amount} RWF`,actor]);
  await notify(sql,o.customer_id,`Payment received for MM-${o.number}`,`${amount} RWF received. Remaining balance: ${o.total-paid} RWF.`);
 }
 async cash(id:string,a:Actor,body:any,key:string){
  const d=parse(z.object({amount:money,receiptReference:text(100)}).strict(),body);
  return this.db.tx(async sql=>{
   const old=await this.orders.key(sql,a,key,'cash',{orderId:id,...d});if(old)return this.safe(await one(sql,'SELECT * FROM payments WHERE id=$1',[old]));
   const o=await this.orders.visible(sql,id,a,true);
   if(await one(sql,"SELECT id FROM returns WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED','RECEIVED')",[id]))throw new ConflictException('This order is under return review');
   if(['CANCELLED','COMPLETED'].includes(o.status)||d.amount>o.total-o.paid)throw new ConflictException('Amount exceeds balance or order is closed');
   if(await one(sql,"SELECT id FROM payments WHERE order_id=$1 AND status='PENDING'",[id]))throw new ConflictException('Reconcile the pending MoMo payment first');
   const p=await one(sql,"INSERT INTO payments(order_id,provider,amount,provider_currency,status,submission,provider_transaction_id,actor_id) VALUES($1,'CASH',$2,'RWF','SUCCESSFUL','SENT',$3,$4) RETURNING *",[id,d.amount,d.receiptReference,a.id]);
   await this.apply(sql,o,d.amount,a.id);await sql.query('UPDATE request_keys SET result_id=$4 WHERE user_id=$1 AND key=$2 AND scope=$3',[a.id,key,'cash',p.id]);
   await audit(sql,a.id,'CASH_RECORDED',p.id,{amount:d.amount,receiptReference:d.receiptReference});return this.safe(p);
  });
 }
}
@Controller('payments')
export class PaymentController {
 constructor(private service:PaymentService,private orders:OrderService,private db:Db){}
 @Post('orders/:id/momo') start(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.service.start(parse(uuid,id),r.actor,b,r.headers['idempotency-key']);}
 @Post('orders/:id/cash') @Allow(...sales) cash(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.service.cash(parse(uuid,id),r.actor,b,r.headers['idempotency-key']);}
 @Post(':id/check') async check(@Param('id') id:string,@Req() r:any){const p=await one(this.db,'SELECT * FROM payments WHERE id=$1',[parse(uuid,id)]);if(!p)throw new BadRequestException('Payment not found');await this.orders.visible(this.db,p.order_id,r.actor);return this.service.reconcile(p.reference);}
 @Post('momo/callback/:reference') @Public() async callback(@Param('reference') reference:string){
  // Never trust the posted status, amount or account. Reconciliation polls the provider.
  await this.service.reconcile(parse(uuid,reference));return {ok:true};
 }
 @Get() @Allow(...finance) list(){return this.db.query('SELECT p.*,o.number order_number FROM payments p JOIN orders o ON o.id=p.order_id ORDER BY p.created_at DESC LIMIT 500').then(r=>r.rows);}
}
