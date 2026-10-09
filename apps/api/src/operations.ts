import { Body, Controller, Get, Post, Patch, Param, Req, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { Db, one, audit, notify, notifyRoles, notifyOrderTeam } from './db';
import { Actor, Allow, management, sales, finance, parse, uuid, money, phone, text, roles } from './security';
import { OrderService } from './orders';
@Controller()
export class OperationsController {
 constructor(private db:Db,private orders:OrderService){}
 @Get('users') @Allow(...management) users(){return this.db.query('SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY name LIMIT 500').then(r=>r.rows);}
 @Post('users') @Allow('SUPER_ADMIN') async createUser(@Req() r:any,@Body() body:any){
  const d=parse(z.object({name:text(100),email:z.string().email().transform(v=>v.toLowerCase()),phone:phone,role:z.enum(roles),password:z.string().min(12).max(72)}).strict(),body);
  const pass=await hash(d.password,12);return this.db.tx(async sql=>{const u=await one(sql,'INSERT INTO users(name,email,phone,role,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,phone,role,active',[d.name,d.email,d.phone,d.role,pass]);await audit(sql,r.actor.id,'USER_CREATED',u.id,{role:u.role});return u;});
 }
 @Patch('users/:id') @Allow('SUPER_ADMIN') async updateUser(@Req() r:any,@Param('id') id:string,@Body() body:any){
  const d=parse(z.object({role:z.enum(roles),active:z.boolean()}).strict(),body);parse(uuid,id);if(id===r.actor.id)throw new BadRequestException('You cannot change your own role or deactivate yourself');
  return this.db.tx(async sql=>{
   const u=await one(sql,'SELECT * FROM users WHERE id=$1 FOR UPDATE',[id]);if(!u)throw new NotFoundException();
   const result=await one(sql,'UPDATE users SET role=$2,active=$3 WHERE id=$1 RETURNING id,name,email,role,active',[id,d.role,d.active]);await sql.query('DELETE FROM sessions WHERE user_id=$1',[id]);await audit(sql,r.actor.id,'USER_ACCESS_UPDATED',id,d);return result;
  });
 }
 @Get('deliveries') @Allow(...sales,'DRIVER') deliveries(@Req() r:any){const driver=r.actor.role==='DRIVER';return this.db.query(`SELECT d.*,o.number,o.customer_name,o.customer_phone,o.address,o.status order_status,o.total,o.paid,o.zone_id,u.name driver_name FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN users u ON u.id=d.driver_id WHERE ${driver?'d.driver_id=$1':'true'} ORDER BY o.created_at DESC LIMIT 300`,driver?[r.actor.id]:[]).then(r=>r.rows);}
 @Post('deliveries/:id/assign') @Allow(...management) async assignDriver(@Req() r:any,@Param('id') id:string,@Body() body:any){
  const d=parse(z.object({driverId:uuid}).strict(),body);
  return this.db.tx(async sql=>{
   const delivery=await one(sql,'SELECT order_id FROM deliveries WHERE id=$1',[parse(uuid,id)]);if(!delivery)throw new NotFoundException();const o=await one(sql,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[delivery.order_id]);
   const prior=await one(sql,'SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[id]);if(!['READY','OUT_FOR_DELIVERY'].includes(o.status)||prior.status==='DELIVERED')throw new ConflictException('Prepare the order before assigning delivery');
   if(!(await one(sql,"SELECT id FROM users WHERE id=$1 AND active AND role='DRIVER'",[d.driverId])))throw new BadRequestException('Select an active driver');
   const updated=await one(sql,"UPDATE deliveries SET driver_id=$2,status='ASSIGNED',assigned_at=now(),proof=NULL WHERE id=$1 RETURNING *",[id,d.driverId]);
   await sql.query("UPDATE orders SET status='READY',updated_at=now() WHERE id=$1",[o.id]);await sql.query("INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,'READY',$2,$3)",[o.id,'Delivery driver assigned or reassigned',r.actor.id]);
   await audit(sql,r.actor.id,'DRIVER_ASSIGNED',id,{driverId:d.driverId});await notify(sql,d.driverId,`Delivery MM-${o.number} assigned`,o.address,{orderId:o.id});return updated;
  });
 }
 @Post('deliveries/:id/status') @Allow('DRIVER') async deliveryStatus(@Req() r:any,@Param('id') id:string,@Body() body:any){
  const d=parse(z.object({status:z.enum(['PICKED_UP','DELIVERED','FAILED']),proof:text(1000),collectionCode:z.string().max(20).optional()}).strict(),body);
  return this.db.tx(async sql=>{
   const raw=await one(sql,'SELECT order_id FROM deliveries WHERE id=$1',[parse(uuid,id)]);if(!raw)throw new NotFoundException();const o=await one(sql,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[raw.order_id]);const del=await one(sql,'SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[id]);if(del.driver_id!==r.actor.id)throw new ForbiddenException();
   if(d.status==='PICKED_UP'&&(del.status!=='ASSIGNED'||o.status!=='READY'))throw new ConflictException('Delivery is not ready for pickup');
   if(d.status!=='PICKED_UP'&&del.status!=='PICKED_UP')throw new ConflictException('Pick up the order first');
   if(o.paid<o.total)throw new ConflictException('Full payment is required before dispatch');
   if(await one(sql,"SELECT id FROM returns WHERE order_id=$1 AND status IN ('REQUESTED','APPROVED','RECEIVED')",[o.id]))throw new ConflictException('This order is under return review');
   if(d.status==='DELIVERED'&&d.collectionCode!==o.pickup_code)throw new BadRequestException('Ask the customer for the collection code');
   const status=d.status==='DELIVERED'?'COMPLETED':d.status==='FAILED'?'READY':'OUT_FOR_DELIVERY';
   const updated=await one(sql,'UPDATE deliveries SET status=$2,proof=$3,delivered_at=CASE WHEN $2=\'DELIVERED\' THEN now() ELSE NULL END WHERE id=$1 RETURNING *',[id,d.status,d.proof]);
   await sql.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1',[o.id,status]);if(status==='COMPLETED')await sql.query("UPDATE bespoke SET status='COMPLETED',updated_at=now() WHERE order_id=$1",[o.id]);
   await sql.query('INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,$2,$3,$4)',[o.id,status,d.proof,r.actor.id]);await audit(sql,r.actor.id,`DELIVERY_${d.status}`,id);await notify(sql,o.customer_id,`Delivery MM-${o.number}: ${d.status.toLowerCase().replaceAll('_',' ')}`,d.proof,{orderId:o.id});await notifyOrderTeam(sql,o.id,r.actor.id,`Delivery MM-${o.number}: ${d.status.toLowerCase().replaceAll('_',' ')}`,d.proof);return updated;
  });
 }
 @Post('returns') @Allow('CUSTOMER') async requestReturn(@Req() r:any,@Body() body:any){
  const d=parse(z.object({orderId:uuid,reason:text(3000)}).strict(),body);
  return this.db.tx(async sql=>{const o=await this.orders.visible(sql,d.orderId,r.actor,true);if(o.paid===0||!['CONFIRMED','READY','COMPLETED'].includes(o.status))throw new ConflictException('This order is not eligible for review');
   if(await one(sql,"SELECT id FROM payments WHERE order_id=$1 AND status='PENDING'",[o.id]))throw new ConflictException('Check the pending payment first');
   const s=(await one(sql,'SELECT data FROM settings WHERE id=1')).data;if(o.status==='COMPLETED'&&Date.now()-new Date(o.updated_at).getTime()>s.returnsDays*86400000)throw new ConflictException('The return request period has ended');
   const rt=await one(sql,'INSERT INTO returns(order_id,customer_id,reason) VALUES($1,$2,$3) RETURNING *',[o.id,r.actor.id,d.reason]);await audit(sql,r.actor.id,'RETURN_REQUESTED',rt.id);await notify(sql,r.actor.id,'Return review requested','The team will review your request, including custom garment eligibility.',{orderId:o.id});await notifyRoles(sql,finance,r.actor.id,`Return requested for MM-${o.number}`,d.reason,o.id);return rt;
  });
 }
 @Get('returns') @Allow('CUSTOMER',...finance) returns(@Req() r:any){return this.db.query(`SELECT r.*,o.number order_number,o.paid FROM returns r JOIN orders o ON o.id=r.order_id WHERE ${r.actor.role==='CUSTOMER'?'r.customer_id=$1':'true'} ORDER BY r.created_at DESC LIMIT 300`,r.actor.role==='CUSTOMER'?[r.actor.id]:[]).then(r=>r.rows);}
 @Post('returns/:id/status') @Allow(...finance) async returnStatus(@Req() r:any,@Param('id') id:string,@Body() body:any){
  const d=parse(z.object({status:z.enum(['APPROVED','REJECTED','RECEIVED','REFUNDED']),amount:money.optional(),refundReference:z.string().max(200).optional()}).strict(),body);
  return this.db.tx(async sql=>{const rt=await one(sql,'SELECT * FROM returns WHERE id=$1 FOR UPDATE',[parse(uuid,id)]);if(!rt)throw new NotFoundException();const o=await one(sql,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[rt.order_id]);
   const transitions:Record<string,string[]>={REQUESTED:['APPROVED','REJECTED'],APPROVED:['RECEIVED','REFUNDED'],RECEIVED:['REFUNDED'],REJECTED:[],REFUNDED:[]};if(!transitions[rt.status].includes(d.status))throw new ConflictException('Invalid return status');
   if(d.status==='APPROVED'&&(!d.amount||d.amount>o.paid))throw new BadRequestException('Approval requires an amount no greater than the amount paid');
   if(d.status==='REFUNDED'&&!d.refundReference?.trim())throw new BadRequestException('Record the confirmed external refund reference');
   // This records a refund verified by finance; it does not pretend to send money through the collection API.
   const updated=await one(sql,'UPDATE returns SET status=$2,amount=COALESCE($3,amount),refund_reference=COALESCE($4,refund_reference),reviewed_by=$5 WHERE id=$1 RETURNING *',[id,d.status,d.status==='APPROVED'?d.amount:null,d.status==='REFUNDED'?d.refundReference:null,r.actor.id]);
   if(d.status==='REFUNDED'&&o.status!=='COMPLETED'){
    await sql.query("UPDATE orders SET status='CANCELLED',updated_at=now() WHERE id=$1",[o.id]);
    await sql.query("UPDATE bespoke SET status='CANCELLED',updated_at=now() WHERE order_id=$1",[o.id]);
    await sql.query("INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,'CANCELLED','Cancelled after finance verified refund; inspect goods before restocking',$2)",[o.id,r.actor.id]);
   }
   await audit(sql,r.actor.id,`RETURN_${d.status}`,id,{amount:updated.amount,reference:updated.refund_reference});await notify(sql,o.customer_id,`Return ${d.status.toLowerCase()}`,`Order MM-${o.number}. Contact the shop for details.`,{orderId:o.id});return updated;
  });
 }
 @Get('notifications') notifications(@Req() r:any){return this.db.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[r.actor.id]).then(r=>r.rows);}
 @Get('notifications/unread-count') async unreadCount(@Req() r:any){return {count:(await one(this.db,'SELECT count(*)::integer count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[r.actor.id])).count};}
 @Post('notifications/read-all') async readAll(@Req() r:any){await this.db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[r.actor.id]);return {ok:true};}
 @Post('notifications/:id/read') async read(@Req() r:any,@Param('id') id:string){await this.db.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2',[parse(uuid,id),r.actor.id]);return {ok:true};}
 @Get('reports') @Allow(...finance) async reports(){
  const sales=await one(this.db,"SELECT COALESCE(sum(amount),0)::bigint gross FROM payments WHERE status='SUCCESSFUL'");
  const refunds=await one(this.db,"SELECT COALESCE(sum(amount),0)::bigint refunds FROM returns WHERE status='REFUNDED'");
  return {gross:Number(sales.gross),refunds:Number(refunds.refunds),net:Number(sales.gross)-Number(refunds.refunds),orders:(await this.db.query('SELECT status,count(*)::integer count FROM orders GROUP BY status')).rows,lowStock:(await this.db.query('SELECT v.*,p.name FROM variants v JOIN products p ON p.id=v.product_id WHERE v.stock<=5 AND p.active ORDER BY v.stock LIMIT 100')).rows,daily:(await this.db.query("SELECT created_at::date AS \"day\",sum(amount)::bigint amount FROM payments WHERE status='SUCCESSFUL' AND created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1")).rows};
 }
 @Get('audit') @Allow('SUPER_ADMIN') audit(){return this.db.query('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500').then(r=>r.rows);}
}
