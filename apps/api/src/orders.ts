import { Body, Controller, Get, Post, Param, Req, Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { Db, Sql, one, audit, notify } from './db';
import { Actor, Allow, management, sales, finance, parse, uuid, phone, text, digest } from './security';
const checkout=z.object({items:z.array(z.object({variantId:uuid,quantity:z.number().int().min(1).max(50)}).strict()).min(1).max(50),fulfilment:z.enum(['DELIVERY','PICKUP','IN_SHOP']),zoneId:z.string().max(30).optional(),address:z.string().max(500).optional(),customerName:text(100),customerPhone:phone,notes:z.string().max(2000).optional(),customerId:uuid.optional(),channel:z.enum(['ONLINE','SHOP']).default('ONLINE')}).strict();
export const orderTransitions:Record<string,string[]>={AWAITING_PAYMENT:['CONFIRMED','CANCELLED'],CONFIRMED:['READY','IN_PRODUCTION'],IN_PRODUCTION:['READY'],READY:['OUT_FOR_DELIVERY','COMPLETED'],OUT_FOR_DELIVERY:['COMPLETED'],COMPLETED:[],CANCELLED:[]};
@Injectable()
export class OrderService {
 constructor(public db:Db){}
 async visible(sql:Sql,id:string,a:Actor,lock=false){
  const o=await one(sql,`SELECT * FROM orders WHERE id=$1 ${lock?'FOR UPDATE':''}`,[parse(uuid,id)]);if(!o)throw new NotFoundException();
  if(a.role==='CUSTOMER' && o.customer_id!==a.id)throw new ForbiddenException();
  if(a.role==='DRIVER' && !(await one(sql,'SELECT id FROM deliveries WHERE order_id=$1 AND driver_id=$2',[id,a.id])))throw new ForbiddenException();
  if(a.role==='DESIGNER'||a.role==='TAILOR'){
   if(!(await one(sql,`SELECT id FROM bespoke WHERE order_id=$1 AND ${a.role==='DESIGNER'?'designer_id':'tailor_id'}=$2`,[id,a.id])))throw new ForbiddenException();
  }return o;
 }
 async key(sql:Sql,a:Actor,key:string,scope:string,body:any){
  parse(uuid,key);const hash=digest(JSON.stringify(body));
  await sql.query('INSERT INTO request_keys(user_id,key,scope,hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[a.id,key,scope,hash]);
  const previous=await one(sql,'SELECT * FROM request_keys WHERE user_id=$1 AND key=$2 AND scope=$3 FOR UPDATE',[a.id,key,scope]);
  if(previous.hash!==hash)throw new ConflictException('This request key was already used for different data');return previous.result_id as string|null;
 }
 async place(body:any,a:Actor,key:string){
  if(process.env.NODE_ENV==='production'&&a.role==='CUSTOMER'&&!(await one(this.db,'SELECT id FROM users WHERE id=$1 AND email_verified',[a.id])))throw new ForbiddenException('Verify your email from Account before ordering');
  const d=parse(checkout,body);
  if(d.channel==='SHOP'&&!sales.includes(a.role))throw new ForbiddenException();
  if(d.channel==='ONLINE'&&d.fulfilment==='IN_SHOP')throw new BadRequestException('Choose shop pickup or delivery');
  if(d.customerId && !sales.includes(a.role))throw new ForbiddenException();
  if(d.fulfilment==='DELIVERY'&&(!d.zoneId||!d.address?.trim()))throw new BadRequestException('Choose a delivery zone and enter an address');
  return this.db.tx(async sql=>{
   const old=await this.key(sql,a,key,'checkout',d);if(old)return this.detail(old,a,sql);
   const s=(await one(sql,'SELECT data FROM settings WHERE id=1')).data;
   const zone=s.deliveryZones.find((v:any)=>v.id===d.zoneId);if(d.fulfilment==='DELIVERY'&&!zone)throw new BadRequestException('Delivery zone unavailable');
   const merged=new Map<string,number>();for(const i of d.items)merged.set(i.variantId,(merged.get(i.variantId)||0)+i.quantity);
   if([...merged.values()].some(v=>v>50))throw new BadRequestException('Maximum 50 per variant');
   // Product edits and checkout take product locks first; sorted locks avoid cross-cart deadlocks.
   await sql.query('SELECT p.id FROM products p WHERE p.id IN (SELECT product_id FROM variants WHERE id=ANY($1::uuid[])) ORDER BY p.id FOR UPDATE',[[...merged.keys()]]);
   const vs=(await sql.query(`SELECT v.*,p.name,p.price,p.active FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=ANY($1::uuid[]) ORDER BY v.id FOR UPDATE OF v`,[[...merged.keys()]])).rows;
   if(vs.length!==merged.size)throw new BadRequestException('An item is unavailable');
   let subtotal=0;for(const v of vs){const qty=merged.get(v.id)!;if(!v.active||v.stock<qty)throw new ConflictException(`Insufficient stock for ${v.name} (${v.size}, ${v.color})`);subtotal+=v.price*qty;}
   const tax=Math.round(subtotal*s.taxBasisPoints/10000),fee=d.fulfilment==='DELIVERY'?zone.fee:0,total=subtotal+tax+fee;
   if(total<=0||total>100000000)throw new BadRequestException('Order amount is outside supported limits');
   const customerId=d.channel==='SHOP'?(d.customerId||null):a.id;
   if(customerId&&!(await one(sql,'SELECT id FROM users WHERE id=$1 AND active',[customerId])))throw new BadRequestException('Customer is unavailable');
   const o=await one(sql,`INSERT INTO orders(customer_id,placed_by,customer_name,customer_phone,channel,fulfilment,subtotal,tax,delivery_fee,total,deposit_due,zone_id,address,notes,pickup_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14) RETURNING *`,[customerId,a.id,d.customerName,d.customerPhone,d.channel,d.fulfilment,subtotal,tax,fee,total,d.fulfilment==='DELIVERY'?d.zoneId:null,d.fulfilment==='DELIVERY'?d.address:null,d.notes||null,String(randomInt(100000,1000000))]);
   for(const v of vs){const qty=merged.get(v.id)!;await sql.query('UPDATE variants SET stock=stock-$2 WHERE id=$1',[v.id,qty]);await sql.query('INSERT INTO order_items(order_id,variant_id,product_name,sku,size,color,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[o.id,v.id,v.name,v.sku,v.size,v.color,qty,v.price]);await sql.query('INSERT INTO stock_moves(variant_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)',[v.id,-qty,`Reserved for MM-${o.number}`,a.id]);}
   await sql.query('INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,$2,$3,$4)',[o.id,o.status,'Order placed; stock reserved',a.id]);
   if(d.fulfilment==='DELIVERY')await sql.query('INSERT INTO deliveries(order_id) VALUES($1)',[o.id]);
   await sql.query('UPDATE request_keys SET result_id=$4 WHERE user_id=$1 AND key=$2 AND scope=$3',[a.id,key,'checkout',o.id]);
   await audit(sql,a.id,'ORDER_PLACED',o.id);await notify(sql,customerId,`Order MM-${o.number} placed`,`Total: ${total} RWF. Please complete payment.`);
   return this.detail(o.id,a,sql);
  });
 }
 async detail(id:string,a:Actor,sql:Sql=this.db){
  const o=await this.visible(sql,id,a);
  const items=(await sql.query('SELECT * FROM order_items WHERE order_id=$1',[id])).rows;
  const history=(await sql.query('SELECT status,note,created_at FROM order_history WHERE order_id=$1 ORDER BY created_at',[id])).rows;
  const payments=(await sql.query('SELECT id,provider,amount,status,failure,created_at FROM payments WHERE order_id=$1 ORDER BY created_at DESC',[id])).rows;
  const delivery=await one(sql,'SELECT d.*,u.name driver_name FROM deliveries d LEFT JOIN users u ON u.id=d.driver_id WHERE order_id=$1',[id]);
  if(a.role==='DRIVER')delete o.pickup_code;
  return {...o,items,history,payments,delivery};
 }
 async transition(id:string,a:Actor,body:any){
  const d=parse(z.object({status:z.enum(['CANCELLED','IN_PRODUCTION','READY','COMPLETED']),note:text(1000),pickupCode:z.string().max(20).optional()}).strict(),body);
  return this.db.tx(async sql=>{
   const o=await this.visible(sql,id,a,true);
   if(await one(sql,"SELECT id FROM returns WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED','RECEIVED')",[id]))throw new ConflictException('This order is under return review');
   if(a.role==='CUSTOMER'&&(d.status!=='CANCELLED'||o.status!=='AWAITING_PAYMENT'))throw new ForbiddenException();
   if(a.role!=='CUSTOMER'&&!sales.includes(a.role)&&!['DESIGNER','TAILOR'].includes(a.role))throw new ForbiddenException();
   if(['DESIGNER','TAILOR'].includes(a.role)&&!['IN_PRODUCTION','READY'].includes(d.status))throw new ForbiddenException();
   if(!orderTransitions[o.status].includes(d.status))throw new ConflictException('This status transition is unavailable');
   if(d.status==='CANCELLED'){
    const pending=await one(sql,"SELECT id FROM payments WHERE order_id=$1 AND status='PENDING'",[id]);
    if(o.paid>0||pending)throw new ConflictException('Paid or pending-payment orders require payment reconciliation and a return/refund review');
    const items=(await sql.query('SELECT variant_id,quantity FROM order_items WHERE order_id=$1 AND variant_id IS NOT NULL ORDER BY variant_id',[id])).rows;
    for(const i of items){await sql.query('UPDATE variants SET stock=stock+$2 WHERE id=$1',[i.variant_id,i.quantity]);await sql.query('INSERT INTO stock_moves(variant_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)',[i.variant_id,i.quantity,`Cancellation MM-${o.number}`,a.id]);}
    await sql.query("UPDATE bespoke SET status='CANCELLED',updated_at=now() WHERE order_id=$1",[id]);
   }else{
    if(o.paid<o.deposit_due)throw new ConflictException('Deposit has not been received');
    if(d.status==='COMPLETED'){
     if(o.fulfilment==='DELIVERY')throw new BadRequestException('The assigned driver must confirm delivery');
     if(o.paid<o.total)throw new ConflictException('Balance must be fully paid');
     if(o.fulfilment==='PICKUP' && d.pickupCode!==o.pickup_code)throw new BadRequestException('Invalid collection code');
    }
    await sql.query('UPDATE bespoke SET status=$2,updated_at=now() WHERE order_id=$1',[id,d.status]);
   }
   await sql.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1',[id,d.status]);
   await sql.query('INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,$2,$3,$4)',[id,d.status,d.note,a.id]);
   await audit(sql,a.id,`ORDER_${d.status}`,id);await notify(sql,o.customer_id,`Order MM-${o.number}: ${d.status.replaceAll('_',' ')}`,d.note);
   return this.detail(id,a,sql);
  });
 }
}
@Controller('orders')
export class OrderController {
 constructor(private orders:OrderService,private db:Db){}
 @Post() place(@Body() b:any,@Req() r:any){return this.orders.place(b,r.actor,r.headers['idempotency-key']);}
 @Get() async list(@Req() r:any){
  const a:Actor=r.actor;let where='true',args:any[]=[];
  if(a.role==='CUSTOMER'){where='o.customer_id=$1';args=[a.id];}
  if(a.role==='DRIVER'){where='EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.driver_id=$1)';args=[a.id];}
  if(a.role==='DESIGNER'||a.role==='TAILOR'){where=`EXISTS(SELECT 1 FROM bespoke b WHERE b.order_id=o.id AND b.${a.role==='DESIGNER'?'designer_id':'tailor_id'}=$1)`;args=[a.id];}
  return (await this.db.query(`SELECT o.* FROM orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT 300`,args)).rows;
 }
 @Get(':id') detail(@Param('id') id:string,@Req() r:any){return this.orders.detail(id,r.actor);}
 @Post(':id/status') status(@Param('id') id:string,@Req() r:any,@Body() b:any){return this.orders.transition(id,r.actor,b);}
}
