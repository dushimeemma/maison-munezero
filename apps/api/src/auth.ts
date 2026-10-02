import { Body, Controller, Get, Post, Req, Injectable, UnauthorizedException, ConflictException, BadRequestException, Delete, Patch } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { Db, Sql, one, audit, notify } from './db';
import { Actor, Public, Allow, parse, text, phone, token, digest } from './security';
const credentials = z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(12).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Password must use at most 72 UTF-8 bytes')}).strict();
@Injectable()
export class AuthService {
 constructor(private db: Db) {}
 async session(sql: Sql, user: any) {
  const accessToken=token(), refreshToken=token();
  await sql.query(`INSERT INTO sessions(user_id,access_hash,refresh_hash,access_expires,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes',now()+interval '30 days')`, [user.id,digest(accessToken),digest(refreshToken)]);
  const {password_hash,...safe}=user; return {accessToken,refreshToken,user:safe};
 }
 async register(body: unknown) {
  const d=parse(credentials.extend({name:text(100),phone:phone}).strict(),body);
  const hashed=await hash(d.password,12);
  return this.db.tx(async sql=>{
   if(await one(sql,'SELECT id FROM users WHERE email=$1',[d.email]))throw new ConflictException('This email is already registered');
   const u=await one(sql,`INSERT INTO users(email,name,phone,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,phone,role,email_verified`,[d.email,d.name,d.phone,hashed]);
   await this.sendVerification(sql,u.id);
   await notify(sql,u.id,'Welcome to Maison Munezero','Your account is ready. Browse the collection or book a design consultation.');
   return this.session(sql,u);
  });
 }
 async login(body:unknown) {
  const d=parse(credentials,body);
  // Shared database lockout: a new request increments before password comparison.
  const attempt=await one(this.db,`INSERT INTO auth_attempts(email,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(email) DO UPDATE SET
   attempts=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.attempts+1 END,
   window_start=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_start END RETURNING attempts`,[d.email]);
  if(attempt.attempts>10)throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');
  const u=await one(this.db,'SELECT * FROM users WHERE email=$1',[d.email]);
  const valid=await compare(d.password,u?.password_hash || '$2b$12$NKz9AG2uACKxDvjoRbYIQeENLc0D6M9PglF.wEISyOZFIF.vYLNdC');
  if(!u?.active||!valid)throw new UnauthorizedException('Invalid email or password');
  return this.db.tx(async sql=>{ const current=await one(sql,'SELECT * FROM users WHERE id=$1 FOR UPDATE',[u.id]);if(!current.active||current.password_hash!==u.password_hash)throw new UnauthorizedException('Please sign in again');await sql.query('DELETE FROM auth_attempts WHERE email=$1',[d.email]); await audit(sql,u.id,'LOGIN',u.id); return this.session(sql,current); });
 }
 async refresh(body:unknown) {
  const d=parse(z.object({refreshToken:text(100)}).strict(),body);
  return this.db.tx(async sql=>{
   const s=await one(sql,'SELECT * FROM sessions WHERE refresh_hash=$1 AND expires_at>now() FOR UPDATE',[digest(d.refreshToken)]);
   if(!s)throw new UnauthorizedException('Please sign in again');
   const u=await one(sql,'SELECT id,email,name,phone,role,email_verified FROM users WHERE id=$1 AND active=true',[s.user_id]);
   if(!u)throw new UnauthorizedException();
   const accessToken=token(),refreshToken=token();
   await sql.query(`UPDATE sessions SET access_hash=$1,refresh_hash=$2,access_expires=now()+interval '15 minutes' WHERE id=$3`,[digest(accessToken),digest(refreshToken),s.id]);
   return {accessToken,refreshToken,user:u};
  });
 }
 async forgot(body:unknown) {
  const d=parse(z.object({email:z.string().email().transform(v=>v.toLowerCase())}).strict(),body);
  const u=await one(this.db,'SELECT id FROM users WHERE email=$1 AND active=true',[d.email]);
  if(u)await this.db.tx(async sql=>{
   const t=token(); await sql.query('DELETE FROM password_resets WHERE user_id=$1',[u.id]);
   await sql.query(`INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')`,[u.id,digest(t)]);
   await sql.query('INSERT INTO outbox(user_id,subject,body) VALUES($1,$2,$3)',[u.id,'Reset your Maison Munezero password',`Use this one-time reset code within 30 minutes: ${t}\nEnter it on the Reset password screen. If you did not request this, ignore it.`]);
  });
  return {message:'If the email is registered, a reset code will be sent.'};
 }
 async sendVerification(sql:Sql,id:string){const t=token();await sql.query("INSERT INTO email_verifications(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '24 hours') ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",[id,digest(t)]);await sql.query('INSERT INTO outbox(user_id,subject,body) VALUES($1,$2,$3)',[id,'Verify your Maison Munezero email',`Enter this one-time code in Account > Verify email within 24 hours: ${t}`]);}
 async verify(id:string,body:unknown){const d=parse(z.object({token:text(100)}).strict(),body);await this.db.tx(async sql=>{const v=await one(sql,'SELECT * FROM email_verifications WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() FOR UPDATE',[id,digest(d.token)]);if(!v)throw new BadRequestException('Invalid or expired verification code');await sql.query('UPDATE users SET email_verified=true WHERE id=$1',[id]);await sql.query('DELETE FROM email_verifications WHERE user_id=$1',[id]);await audit(sql,id,'EMAIL_VERIFIED',id);});return {ok:true};}
 async verification(id:string){await this.db.tx(async sql=>{const u=await one(sql,'SELECT email_verified FROM users WHERE id=$1 FOR UPDATE',[id]);if(!u.email_verified)await this.sendVerification(sql,id);});return {message:'Check your email for the verification code.'};}
 async reset(body:unknown) {
  const d=parse(z.object({token:text(100),password:credentials.shape.password}).strict(),body);
  const hashed=await hash(d.password,12);
  await this.db.tx(async sql=>{
   const r=await one(sql,'SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[digest(d.token)]);
   if(!r)throw new BadRequestException('Invalid or expired reset code');
   await sql.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashed,r.user_id]);
   await sql.query('DELETE FROM sessions WHERE user_id=$1',[r.user_id]); await sql.query('DELETE FROM password_resets WHERE user_id=$1',[r.user_id]);
   await audit(sql,r.user_id,'PASSWORD_RESET',r.user_id);
  }); return {message:'Password changed. Please sign in.'};
 }
}
@Controller('auth')
export class AuthController {
 constructor(private auth:AuthService,private db:Db){}
 @Post('register') @Public() register(@Body() d:any){return this.auth.register(d);}
 @Post('login') @Public() login(@Body() d:any){return this.auth.login(d);}
 @Post('refresh') @Public() refresh(@Body() d:any){return this.auth.refresh(d);}
 @Post('forgot-password') @Public() forgot(@Body() d:any){return this.auth.forgot(d);}
 @Post('reset-password') @Public() reset(@Body() d:any){return this.auth.reset(d);}
 @Post('email/send-verification') sendVerification(@Req() r:any){return this.auth.verification(r.actor.id);}
 @Post('email/verify') verify(@Req() r:any,@Body() b:any){return this.auth.verify(r.actor.id,b);}
 @Post('logout') async logout(@Req() r:any){await this.db.query('DELETE FROM sessions WHERE id=$1',[r.actor.session_id]);return {ok:true};}
 @Get('me') me(@Req() r:any){return one(this.db,'SELECT id,name,email,phone,role,email_verified FROM users WHERE id=$1',[r.actor.id]);}
 @Patch('profile') async profile(@Req() r:any,@Body() body:any){const d=parse(z.object({name:text(100),phone:phone}).strict(),body);await this.db.tx(async sql=>{await sql.query('UPDATE users SET name=$2,phone=$3 WHERE id=$1',[r.actor.id,d.name,d.phone]);await audit(sql,r.actor.id,'PROFILE_UPDATED',r.actor.id);});return this.me(r);}
 @Delete('account') @Allow('CUSTOMER') async deleteAccount(@Req() r:any){return this.db.tx(async sql=>{
  // Transactional records keep their purchase-time details; the login identity is removed.
  await sql.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE',[r.actor.id]);
  await sql.query("UPDATE users SET active=false,name='Deleted account',phone=NULL,email=$2,password_hash=$3 WHERE id=$1",[r.actor.id,`deleted-${r.actor.id}@accounts.invalid`,token()]);
  await sql.query('DELETE FROM sessions WHERE user_id=$1',[r.actor.id]);await sql.query('DELETE FROM password_resets WHERE user_id=$1',[r.actor.id]);await sql.query('DELETE FROM wishlist WHERE user_id=$1',[r.actor.id]);await sql.query('DELETE FROM notifications WHERE user_id=$1',[r.actor.id]);await sql.query('DELETE FROM outbox WHERE user_id=$1 AND sent_at IS NULL',[r.actor.id]);
  await sql.query('DELETE FROM email_verifications WHERE user_id=$1',[r.actor.id]);
  await sql.query("UPDATE appointments SET status='CANCELLED' WHERE customer_id=$1 AND status IN ('REQUESTED','CONFIRMED')",[r.actor.id]);await sql.query("UPDATE bespoke SET measurements=CASE WHEN order_id IS NULL OR status IN ('COMPLETED','CANCELLED') THEN '{}'::jsonb ELSE measurements END,status=CASE WHEN order_id IS NULL THEN 'CANCELLED' ELSE status END WHERE customer_id=$1",[r.actor.id]);await audit(sql,r.actor.id,'ACCOUNT_DELETED',r.actor.id);return {ok:true};
 });}
}
