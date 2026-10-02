import { Body, Controller, Get, Post, Patch, Param, Req, Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { Db, Sql, one, audit, notify } from './db';
import { Actor, Allow, management, studio, parse, uuid, money, text, optionalUrl } from './security';
import { OrderService } from './orders';
@Injectable()
export class StudioService {
 constructor(private db:Db){}
 async visible(sql:Sql,id:string,a:Actor,lock=false){
  const b=await one(sql,`SELECT * FROM bespoke WHERE id=$1 ${lock?'FOR UPDATE':''}`,[parse(uuid,id)]);if(!b)throw new NotFoundException();
  if(a.role==='CUSTOMER'&&b.customer_id!==a.id)throw new ForbiddenException();
  if(a.role==='DESIGNER'&&b.designer_id!==a.id)throw new ForbiddenException();
  if(a.role==='TAILOR'&&b.tailor_id!==a.id)throw new ForbiddenException();
  if(![...studio,'CUSTOMER'].includes(a.role))throw new ForbiddenException();return b;
 }
}
@Controller('bespoke')
export class StudioController {
 constructor(private db:Db,private studio:StudioService,private orders:OrderService){}
 @Post() @Allow('CUSTOMER',...management) async create(@Req() r:any,@Body() body:any){
  const d=parse(z.object({title:text(150),garment:text(100),occasion:z.string().max(100).optional(),budget:money.optional(),dueDate:z.string().date().optional(),description:text(5000),referenceUrl:optionalUrl}).strict(),body);
  if(d.dueDate&&new Date(d.dueDate)<new Date(new Date().toISOString().slice(0,10)))throw new BadRequestException('Requested date must be in the future');
  return this.db.tx(async sql=>{const b=await one(sql,'INSERT INTO bespoke(customer_id,title,garment,occasion,budget,due_date,description,reference_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[r.actor.id,d.title,d.garment,d.occasion||null,d.budget||null,d.dueDate||null,d.description,d.referenceUrl||null]);await audit(sql,r.actor.id,'BESPOKE_REQUESTED',b.id);await notify(sql,r.actor.id,'Your design request is with the atelier','Our team will review it and prepare a quotation.');return b;});
 }
 @Get() @Allow('CUSTOMER',...studio) async list(@Req() r:any){const a:Actor=r.actor;const where=a.role==='CUSTOMER'?'b.customer_id=$1':a.role==='DESIGNER'?'b.designer_id=$1':a.role==='TAILOR'?'b.tailor_id=$1':'true';return this.db.query(`SELECT b.*,u.name customer_name FROM bespoke b JOIN users u ON u.id=b.customer_id WHERE ${where} ORDER BY b.created_at DESC LIMIT 300`,where==='true'?[]:[a.id]).then(r=>r.rows);}
 @Get(':id') @Allow('CUSTOMER',...studio) detail(@Param('id') id:string,@Req() r:any){return this.studio.visible(this.db,id,r.actor);}
 @Post(':id/assign') @Allow(...management) async assign(@Param('id') id:string,@Req() r:any,@Body() body:any){
  const d=parse(z.object({designerId:uuid,tailorId:uuid.optional()}).strict(),body);
  return this.db.tx(async sql=>{const b=await this.studio.visible(sql,id,r.actor,true);if(['COMPLETED','CANCELLED'].includes(b.status))throw new ConflictException('Design job is closed');
   if(!(await one(sql,"SELECT id FROM users WHERE id=$1 AND role='DESIGNER' AND active",[d.designerId])))throw new BadRequestException('Select an active designer');
   if(d.tailorId&&!(await one(sql,"SELECT id FROM users WHERE id=$1 AND role='TAILOR' AND active",[d.tailorId])))throw new BadRequestException('Select an active tailor');
   await sql.query('UPDATE bespoke SET designer_id=$2,tailor_id=$3,updated_at=now() WHERE id=$1',[id,d.designerId,d.tailorId||null]);await audit(sql,r.actor.id,'BESPOKE_ASSIGNED',id,d);await notify(sql,d.designerId,'Design job assigned',b.title);if(d.tailorId)await notify(sql,d.tailorId,'Tailoring job assigned',b.title);return this.studio.visible(sql,id,r.actor);
  });
 }
 @Post(':id/quote') @Allow(...management,'DESIGNER') async quote(@Param('id') id:string,@Req() r:any,@Body() body:any){
  const d=parse(z.object({amount:money,notes:text(4000),dueDate:z.string().date()}).strict(),body);
  if(new Date(d.dueDate)<new Date())throw new BadRequestException('Promised date must be in the future');
  return this.db.tx(async sql=>{const b=await this.studio.visible(sql,id,r.actor,true);if(!['REQUESTED','QUOTED'].includes(b.status))throw new ConflictException('Quote already accepted or job closed');
   await sql.query("UPDATE bespoke SET quote=$2,quote_notes=$3,due_date=$4,status='QUOTED',updated_at=now() WHERE id=$1",[id,d.amount,d.notes,d.dueDate]);await audit(sql,r.actor.id,'BESPOKE_QUOTED',id,{amount:d.amount});await notify(sql,b.customer_id,'Your design quotation is ready',`${b.title}: ${d.amount} RWF, before applicable tax and delivery. Please review and accept in the app.`);return this.studio.visible(sql,id,r.actor);
  });
 }
 @Post(':id/accept') @Allow('CUSTOMER') async accept(@Param('id') id:string,@Req() r:any,@Body() body:any){
  if(process.env.NODE_ENV==='production'&&!(await one(this.db,'SELECT id FROM users WHERE id=$1 AND email_verified',[r.actor.id])))throw new ForbiddenException('Verify your email from Account before accepting a quote');
  const d=parse(z.object({fulfilment:z.enum(['DELIVERY','PICKUP']),zoneId:z.string().max(30).optional(),address:z.string().max(500).optional()}).strict(),body);
  return this.db.tx(async sql=>{const b=await this.studio.visible(sql,id,r.actor,true);if(b.order_id)return this.orders.detail(b.order_id,r.actor,sql);if(b.status!=='QUOTED'||!b.quote)throw new ConflictException('A quotation is required');
   const s=(await one(sql,'SELECT data FROM settings WHERE id=1')).data;const customer=await one(sql,'SELECT name,phone FROM users WHERE id=$1',[r.actor.id]);
   const zone=s.deliveryZones.find((v:any)=>v.id===d.zoneId);if(d.fulfilment==='DELIVERY'&&(!zone||!d.address?.trim()))throw new BadRequestException('Delivery zone and address are required');
   const tax=Math.round(b.quote*s.taxBasisPoints/10000),fee=d.fulfilment==='DELIVERY'?zone.fee:0,total=b.quote+tax+fee,deposit=Math.ceil((b.quote+tax)*s.depositPercent/100)+fee;
   if(total>100000000)throw new BadRequestException('Quotation total exceeds supported limit');
   const o=await one(sql,"INSERT INTO orders(customer_id,placed_by,customer_name,customer_phone,channel,fulfilment,subtotal,tax,delivery_fee,total,deposit_due,zone_id,address,notes,pickup_code) VALUES($1,$1,$2,$3,'BESPOKE',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",[r.actor.id,customer.name,customer.phone,d.fulfilment,b.quote,tax,fee,total,deposit,d.zoneId||null,d.address||null,b.quote_notes,String(randomInt(100000,1000000))]);
   await sql.query('INSERT INTO order_items(order_id,product_name,quantity,unit_price) VALUES($1,$2,1,$3)',[o.id,b.title,b.quote]);
   await sql.query("UPDATE bespoke SET order_id=$2,status='ACCEPTED',updated_at=now() WHERE id=$1",[id,o.id]);
   await sql.query('INSERT INTO order_history(order_id,status,note,actor_id) VALUES($1,$2,$3,$4)',[o.id,o.status,'Custom quotation accepted',r.actor.id]);if(d.fulfilment==='DELIVERY')await sql.query('INSERT INTO deliveries(order_id) VALUES($1)',[o.id]);
   await audit(sql,r.actor.id,'BESPOKE_ACCEPTED',id,{orderId:o.id});await notify(sql,r.actor.id,'Quotation accepted',`Please pay the ${deposit} RWF deposit to start production.`);return this.orders.detail(o.id,r.actor,sql);
  });
 }
 @Patch(':id/measurements') @Allow(...studio) async measure(@Param('id') id:string,@Req() r:any,@Body() body:any){
  const fields=['bust','waist','hip','shoulder','sleeve','length','inseam','neck','chest'];const shape:Record<string,z.ZodType>={};for(const f of fields)shape[f]=z.number().min(0).max(300).optional();shape.notes=z.string().max(2000).optional();shape.unit=z.literal('cm');
  const d=parse(z.object(shape).strict(),body);
  return this.db.tx(async sql=>{const b=await this.studio.visible(sql,id,r.actor,true);if(['COMPLETED','CANCELLED'].includes(b.status))throw new ConflictException('Job is closed');await sql.query('UPDATE bespoke SET measurements=$2,updated_at=now() WHERE id=$1',[id,JSON.stringify(d)]);await audit(sql,r.actor.id,'MEASUREMENTS_UPDATED',id);return this.studio.visible(sql,id,r.actor);});
 }
 @Post(':id/fitting') @Allow(...studio) async fitting(@Param('id') id:string,@Req() r:any){return this.db.tx(async sql=>{const b=await this.studio.visible(sql,id,r.actor,true);if(b.status!=='IN_PRODUCTION')throw new ConflictException('Start production before a fitting');await sql.query("UPDATE bespoke SET status='FITTING',updated_at=now() WHERE id=$1",[id]);await notify(sql,b.customer_id,'Your garment is ready for a fitting','Please book a fitting appointment in the app.');await audit(sql,r.actor.id,'FITTING_REQUESTED',id);return this.studio.visible(sql,id,r.actor);});}
}
@Controller('appointments')
export class AppointmentsController {
 constructor(private db:Db,private studio:StudioService){}
 @Get() @Allow('CUSTOMER',...studio) list(@Req() r:any){const a:Actor=r.actor;const where=a.role==='CUSTOMER'?'customer_id=$1':['TAILOR','DESIGNER'].includes(a.role)?'staff_id=$1':'true';return this.db.query(`SELECT * FROM appointments WHERE ${where} ORDER BY starts_at LIMIT 300`,where==='true'?[]:[a.id]).then(r=>r.rows);}
 @Post() @Allow('CUSTOMER') async book(@Req() r:any,@Body() body:any){
  const d=parse(z.object({kind:z.enum(['CONSULTATION','MEASUREMENT','FITTING','COLLECTION']),startsAt:z.string().datetime({offset:true}),bespokeId:uuid.optional(),notes:z.string().max(2000).optional()}).strict(),body);const start=new Date(d.startsAt);if(start.getTime()<Date.now()+3600000)throw new BadRequestException('Book at least an hour in advance');
  return this.db.tx(async sql=>{await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[r.actor.id]);if(d.bespokeId)await this.studio.visible(sql,d.bespokeId,r.actor);const s=(await one(sql,'SELECT data FROM settings WHERE id=1')).data;const end=new Date(start.getTime()+s.appointmentMinutes*60000);
   if(await one(sql,"SELECT id FROM appointments WHERE customer_id=$1 AND status IN ('REQUESTED','CONFIRMED') AND starts_at<$3 AND ends_at>$2",[r.actor.id,start,end]))throw new ConflictException('You already have an appointment at this time');
   const a=await one(sql,'INSERT INTO appointments(customer_id,bespoke_id,kind,starts_at,ends_at,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.actor.id,d.bespokeId||null,d.kind,start,end,d.notes||null]);await notify(sql,r.actor.id,'Appointment requested','The atelier will confirm your time.');return a;});
 }
 @Post(':id/status') @Allow('CUSTOMER',...studio) async status(@Param('id') id:string,@Req() r:any,@Body() body:any){
  const d=parse(z.object({status:z.enum(['CONFIRMED','COMPLETED','CANCELLED']),staffId:uuid.optional()}).strict(),body);const a:Actor=r.actor;
  return this.db.tx(async sql=>{const ap=await one(sql,'SELECT * FROM appointments WHERE id=$1 FOR UPDATE',[parse(uuid,id)]);if(!ap)throw new NotFoundException();if(a.role==='CUSTOMER'&&(ap.customer_id!==a.id||d.status!=='CANCELLED'))throw new ForbiddenException();if(['TAILOR','DESIGNER'].includes(a.role)&&ap.staff_id!==a.id)throw new ForbiddenException();
   if(['COMPLETED','CANCELLED'].includes(ap.status))throw new ConflictException('Appointment is closed');if(d.status==='COMPLETED'&&ap.status!=='CONFIRMED')throw new ConflictException('Confirm the appointment first');
   const staff=d.staffId||ap.staff_id;if(d.status==='CONFIRMED'){
    if(!management.includes(a.role))throw new ForbiddenException('A manager must confirm the appointment');
    if(!staff||!(await one(sql,"SELECT id FROM users WHERE id=$1 AND active AND role IN ('DESIGNER','TAILOR') FOR UPDATE",[staff])))throw new BadRequestException('Select an active designer or tailor');
    if(await one(sql,"SELECT id FROM appointments WHERE id<>$1 AND staff_id=$2 AND status='CONFIRMED' AND starts_at<$4 AND ends_at>$3",[id,staff,ap.starts_at,ap.ends_at]))throw new ConflictException('This staff member is already booked');
   }
   const updated=await one(sql,'UPDATE appointments SET status=$2,staff_id=$3 WHERE id=$1 RETURNING *',[id,d.status,staff||null]);await audit(sql,a.id,`APPOINTMENT_${d.status}`,id);await notify(sql,ap.customer_id,`Appointment ${d.status.toLowerCase()}`,`${ap.kind} at ${new Date(ap.starts_at).toISOString()}`);return updated;
  });
 }
}
