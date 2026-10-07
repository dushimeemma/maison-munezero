import { Body, Controller, Get, Post, Param, Req, Injectable, ConflictException, BadRequestException, HttpCode, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Db, Sql, one, audit, notify } from './db';
import { Actor, Allow, Public, sales, finance, parse, uuid, money, phone, text } from './security';
import { OrderService } from './orders';
import { Flutterwave, FlutterwaveUnavailable, PaymentProviders, paymentAuthorizationUrl } from './payment-providers';
export { Flutterwave, Momo } from './payment-providers';
@Injectable()
export class PaymentService {
 private readonly logger=new Logger(PaymentService.name);
 constructor(private db:Db,private orders:OrderService,private providers:PaymentProviders){}
 async start(id:string,a:Actor,body:any,key:string){
  const gateway=this.providers.current();gateway.assertConfigured();
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
   const payer=await one(sql,'SELECT email FROM users WHERE id=$1',[o.customer_id||a.id]);
   const payment=await one(sql,'INSERT INTO payments(order_id,provider,amount,provider_currency,phone,actor_id,payer_email,payer_name,sandbox) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,gateway.code,amount,gateway.currency(),d.phone,a.id,payer.email,o.customer_name,gateway.sandbox()]);
   await sql.query('UPDATE request_keys SET result_id=$4 WHERE user_id=$1 AND key=$2 AND scope=$3',[a.id,key,'momo',payment.id]);
   await audit(sql,a.id,`${gateway.code}_REQUESTED`,payment.id,{amount,orderId:id});return payment;
  });
  await this.submitNew(p);
  return this.safe(await one(this.db,'SELECT * FROM payments WHERE id=$1',[p.id]));
 }
 private async submitNew(p:any){
  if(p.status!=='PENDING'||p.submission!=='NEW')return;
  // Claim durably before I/O, so concurrent retries cannot submit another charge.
  const claim=await one(this.db,"UPDATE payments SET submission='UNCERTAIN' WHERE id=$1 AND submission='NEW' AND status='PENDING' RETURNING id",[p.id]);
  if(claim)await this.submitClaimed(p);
 }
 private async submitClaimed(p:any){
  try{
   const result=await this.providers.forPayment(p).submit(p);
   await this.db.query("UPDATE payments SET submission='SENT',authorization_url=$2,failure=NULL WHERE id=$1 AND status='PENDING'",[p.id,result.authorizationUrl||null]);
  }catch(error){
   if(error instanceof BadRequestException)await this.db.query("UPDATE payments SET status='FAILED',failure='Provider rejected the request',checked_at=now() WHERE id=$1 AND status='PENDING'",[p.id]);
   else{
    const diagnostic=error instanceof FlutterwaveUnavailable?error:undefined;
    this.logger.warn(JSON.stringify({event:'PAYMENT_SUBMISSION_UNCERTAIN',paymentId:p.id,provider:p.provider,code:diagnostic?.code||'UNKNOWN',httpStatus:diagnostic?.httpStatus,confirmation:diagnostic?.confirmation}));
    await this.db.query('UPDATE payments SET failure=$2 WHERE id=$1 AND status=\'PENDING\'',[p.id,diagnostic?.message||'Awaiting provider reconciliation. Do not pay again.']);
   }
  }
 }
 safe(p:any){return {id:p.id,orderId:p.order_id,provider:p.provider,amount:p.amount,status:p.status,failure:p.failure,submission:p.submission,providerCurrency:p.provider_currency,sandbox:p.sandbox,authorizationUrl:p.status==='PENDING'?paymentAuthorizationUrl(p.authorization_url):null};}
 async reconcile(reference:string){
  const p=await one(this.db,'SELECT * FROM payments WHERE reference=$1',[reference]);if(!p||p.status!=='PENDING')return p?this.safe(p):{ok:true};
  // Record failed verification attempts too, so unavailable legacy requests cannot monopolise polling.
  await this.db.query('UPDATE payments SET checked_at=now() WHERE id=$1',[p.id]);
  const gateway=this.providers.forPayment(p);
  if(p.submission==='NEW'){await this.submitNew(p);return this.safe(await one(this.db,'SELECT * FROM payments WHERE id=$1',[p.id]));}
  const result=await gateway.status(p);
  if(!result){
   // Only legacy MTN guarantees safe resubmission with the identical provider UUID.
   // Flutterwave timeouts remain pending for verification or merchant review.
   if(gateway.recoverMissing&&p.submission==='UNCERTAIN'&&Date.now()-new Date(p.created_at).getTime()>30000)await this.submitClaimed(p);
   return this.safe(await one(this.db,'SELECT * FROM payments WHERE id=$1',[p.id]));
  }
  if(!['SUCCESSFUL','FAILED'].includes(result.status))return this.safe(p);
  // A callback is only a wake-up signal. Financial truth is fetched using our merchant credentials.
  const phoneMatches=(v:string)=>v.replace(/^\+/, '').replace(/^0/,'250')===p.phone;
  if(result.reference!==(p.provider==='MOMO'?p.id:p.reference)||result.amount!==p.amount||result.currency!==p.provider_currency||
   p.provider==='MOMO'&&result.phone!==p.phone||p.provider==='FLUTTERWAVE'&&(result.email?.toLowerCase()!==p.payer_email?.toLowerCase()||result.phone!=null&&!phoneMatches(result.phone))||
   result.status==='SUCCESSFUL'&&!result.transactionId)throw new ConflictException('Provider payment does not match this request');
  return this.db.tx(async sql=>{
   // Consistent lock order throughout payment creation, cash and reconciliation.
   const o=await one(sql,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[p.order_id]);
   const locked=await one(sql,'SELECT * FROM payments WHERE id=$1 FOR UPDATE',[p.id]);if(locked.status!=='PENDING')return this.safe(locked);
   if(result.status==='SUCCESSFUL'){
    if(o.status==='CANCELLED'||o.paid+p.amount>o.total)throw new ConflictException('Payment requires finance review');
    await this.apply(sql,o,p.amount,null);
   }
   const updated=await one(sql,'UPDATE payments SET status=$2,provider_transaction_id=$3,failure=$4,checked_at=now() WHERE id=$1 RETURNING *',[p.id,result.status,result.transactionId||null,result.status==='FAILED'?'Payment was declined or failed':null]);
   await audit(sql,null,`${p.provider}_${result.status}`,p.id,{orderId:o.id,amount:p.amount});return this.safe(updated);
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
   if(await one(sql,"SELECT id FROM payments WHERE order_id=$1 AND status='PENDING'",[id]))throw new ConflictException('Reconcile the pending mobile-money payment first');
   const p=await one(sql,"INSERT INTO payments(order_id,provider,amount,provider_currency,status,submission,provider_transaction_id,actor_id) VALUES($1,'CASH',$2,'RWF','SUCCESSFUL','SENT',$3,$4) RETURNING *",[id,d.amount,d.receiptReference,a.id]);
   await this.apply(sql,o,d.amount,a.id);await sql.query('UPDATE request_keys SET result_id=$4 WHERE user_id=$1 AND key=$2 AND scope=$3',[a.id,key,'cash',p.id]);
   await audit(sql,a.id,'CASH_RECORDED',p.id,{amount:d.amount,receiptReference:d.receiptReference});return this.safe(p);
  });
 }
}
@Controller('payments')
export class PaymentController {
 constructor(private service:PaymentService,private orders:OrderService,private db:Db,private flutterwave:Flutterwave){}
 @Post('orders/:id/mobile-money') startMobileMoney(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.service.start(parse(uuid,id),r.actor,b,r.headers['idempotency-key']);}
 // Compatibility route: new requests now use Flutterwave.
 @Post('orders/:id/momo') start(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.service.start(parse(uuid,id),r.actor,b,r.headers['idempotency-key']);}
 @Post('orders/:id/cash') @Allow(...sales) cash(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.service.cash(parse(uuid,id),r.actor,b,r.headers['idempotency-key']);}
 @Post(':id/check') async check(@Param('id') id:string,@Req() r:any){const p=await one(this.db,'SELECT * FROM payments WHERE id=$1',[parse(uuid,id)]);if(!p)throw new BadRequestException('Payment not found');await this.orders.visible(this.db,p.order_id,r.actor);return this.service.reconcile(p.reference);}
 @Post('flutterwave/webhook') @Public() @HttpCode(200) async flutterwaveWebhook(@Req() r:any,@Body() body:any){
  this.flutterwave.verifyWebhook(r.headers['verif-hash']);
  if(body?.event==='charge.completed'&&typeof body.data?.tx_ref==='string'){
   const parsed=uuid.safeParse(body.data.tx_ref);
   if(parsed.success){
    const payment=await one(this.db,"SELECT id FROM payments WHERE reference=$1 AND provider='FLUTTERWAVE'",[parsed.data]);
    if(payment)await this.service.reconcile(parsed.data);
   }
  }
  return {ok:true};
 }
 @Post('momo/callback/:reference') @Public() async callback(@Param('reference') reference:string){
  // Never trust the posted status, amount or account. Reconciliation polls the provider.
  const parsed=parse(uuid,reference);
  if(await one(this.db,"SELECT id FROM payments WHERE reference=$1 AND provider='MOMO'",[parsed]))await this.service.reconcile(parsed);
  return {ok:true};
 }
 @Get() @Allow(...finance) list(){return this.db.query('SELECT p.*,o.number order_number FROM payments p JOIN orders o ON o.id=p.order_id ORDER BY p.created_at DESC LIMIT 500').then(r=>r.rows);}
}
