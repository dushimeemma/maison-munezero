import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { Db } from './db';
import { PaymentService } from './payments';
@Injectable()
export class Workers implements OnModuleInit,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private running=false;
 constructor(private db:Db,private payments:PaymentService){}
 onModuleInit(){if(process.env.WORKERS_DISABLED==='true')return;this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async tick(){if(this.running)return;this.running=true;try{
  // Abandoned, unpaid orders release stock after 24 hours. Pending provider payments never expire here.
  await this.db.tx(async sql=>{
   const abandoned=(await sql.query("SELECT * FROM orders WHERE status='AWAITING_PAYMENT' AND paid=0 AND created_at<now()-interval '24 hours' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED")).rows;
   for(const o of abandoned){
    if((await sql.query("SELECT id FROM payments WHERE order_id=$1 AND status='PENDING'",[o.id])).rows.length)continue;
    const items=(await sql.query('SELECT variant_id,quantity FROM order_items WHERE order_id=$1 AND variant_id IS NOT NULL ORDER BY variant_id',[o.id])).rows;
    for(const i of items){await sql.query('UPDATE variants SET stock=stock+$2 WHERE id=$1',[i.variant_id,i.quantity]);await sql.query('INSERT INTO stock_moves(variant_id,delta,reason) VALUES($1,$2,$3)',[i.variant_id,i.quantity,`Expired reservation MM-${o.number}`]);}
    await sql.query("UPDATE orders SET status='CANCELLED',updated_at=now() WHERE id=$1",[o.id]);await sql.query("UPDATE bespoke SET status='CANCELLED',updated_at=now() WHERE order_id=$1",[o.id]);
    await sql.query("INSERT INTO order_history(order_id,status,note) VALUES($1,'CANCELLED','Unpaid order reservation expired after 24 hours')",[o.id]);
   }
  });
  // PostgreSQL advisory lease prevents duplicate background processing across API replicas.
  await this.db.tx(async sql=>{const lease=(await sql.query('SELECT pg_try_advisory_xact_lock(947372) locked')).rows[0];if(!lease.locked)return;
   const pending=(await sql.query("SELECT reference FROM payments WHERE provider IN ('MOMO','FLUTTERWAVE') AND status='PENDING' AND (checked_at IS NULL OR checked_at<now()-interval '25 seconds') ORDER BY created_at LIMIT 10")).rows;
   for(const p of pending)try{await this.payments.reconcile(p.reference);}catch{console.warn('Payment reconciliation deferred');}
  });
  if(process.env.SMTP_HOST){const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined});
   await this.db.tx(async sql=>{const emails=(await sql.query(`SELECT o.*,u.email FROM outbox o JOIN users u ON u.id=o.user_id WHERE o.sent_at IS NULL AND o.next_at<=now() AND o.attempts<10 ORDER BY o.created_at LIMIT 10 FOR UPDATE OF o SKIP LOCKED`)).rows;
    for(const e of emails)try{await transport.sendMail({from:process.env.SMTP_FROM,to:e.email,subject:e.subject,text:e.body});await sql.query('UPDATE outbox SET sent_at=now(),attempts=attempts+1 WHERE id=$1',[e.id]);}catch{await sql.query("UPDATE outbox SET attempts=attempts+1,next_at=now()+interval '10 minutes' WHERE id=$1",[e.id]);}
   });transport.close();
  }
 }catch{console.warn('Background task deferred');}finally{this.running=false;}}
}
