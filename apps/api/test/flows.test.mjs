import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import appModule from '../dist/app.js';
import dbModule from '../dist/db.js';
import paymentModule from '../dist/payments.js';
const {AppModule}=appModule,{Db}=dbModule,{Momo}=paymentModule;
let app,sql,db,engine,admin,customer,other,designer,tailor,driver,driver2,accountant,product,variant;
const provider={assertConfigured(){},currency(){return 'EUR';},calls:0,results:new Map(),async submit(){this.calls++;return 'SENT';},async status(reference){return this.results.get(reference)||null;}};
const passwords='Maison!Test2026strong';
before(async()=>{
 process.env.WORKERS_DISABLED='true';
 if(process.env.TEST_DATABASE_URL){if(process.env.NODE_ENV==='production'||!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'))throw new Error('Tests require a dedicated database whose name ends with _test');engine=new Pool({connectionString:process.env.TEST_DATABASE_URL});sql={query:(q,p=[])=>engine.query(q,p)};db={...sql,tx:async fn=>{const c=await engine.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};await sql.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await sql.query(readFileSync('migrations/001_initial.sql','utf8'));}
 else{engine=new PGlite();await engine.exec(readFileSync('migrations/001_initial.sql','utf8'));sql={query:(q,p=[])=>engine.query(q,p)};db={...sql,tx:fn=>engine.transaction(tx=>fn({query:(q,p=[])=>tx.query(q,p)}))};}
 const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(Db).useValue(db).overrideProvider(Momo).useValue(provider).compile();app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');await app.init();
 async function staff(role,email){const id=randomUUID();await sql.query('INSERT INTO users(id,email,name,phone,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,email,role,'250780000000',role,await bcrypt.hash(passwords,4)]);const r=await request(app.getHttpServer()).post('/api/v1/auth/login').send({email,password:passwords}).expect(201);return {...r.body.user,token:r.body.accessToken,refresh:r.body.refreshToken};}
 admin=await staff('SUPER_ADMIN','admin@test.rw');designer=await staff('DESIGNER','designer@test.rw');tailor=await staff('TAILOR','tailor@test.rw');driver=await staff('DRIVER','driver@test.rw');driver2=await staff('DRIVER','driver2@test.rw');accountant=await staff('ACCOUNTANT','accountant@test.rw');
 for(const email of ['customer@test.rw','other@test.rw']){const r=await request(app.getHttpServer()).post('/api/v1/auth/register').send({email,password:passwords,name:email,phone:'250780000001'}).expect(201);const u={...r.body.user,token:r.body.accessToken,refresh:r.body.refreshToken};if(!customer)customer=u;else other=u;}
 const r=await call(admin,'post','/products',{name:'Test dress',description:'An API test piece',category:'Dresses',price:10000,variants:[{sku:'TEST-M',size:'M',color:'Olive',stock:10}]});assert.equal(r.status,201);product=r.body;variant=(await call(customer,'get',`/products/${product.id}`)).body.variants[0];
});
after(async()=>{await app?.close();await (engine?.close?.()||engine?.end?.());});
function call(user,method,path,body,key){let r=request(app.getHttpServer())[method](`/api/v1${path}`);if(user)r=r.set('Authorization',`Bearer ${user.token}`);if(key)r=r.set('Idempotency-Key',key);return body?r.send(body):r;}
function checkoutData(fulfilment='PICKUP',quantity=1){return {items:[{variantId:variant.id,quantity}],fulfilment,customerName:'Customer',customerPhone:'250780000001',...(fulfilment==='DELIVERY'?{zoneId:'kigali',address:'Kigali test landmark'}:{})};}
test('public health reports the deployed revision and fails when the database is unavailable',async()=>{
 const previous=process.env.APP_REVISION,renderPrevious=process.env.RENDER_GIT_COMMIT,originalQuery=db.query;
 process.env.APP_REVISION='a'.repeat(40);delete process.env.RENDER_GIT_COMMIT;
 try{
  const healthy=await call(null,'get','/health');assert.equal(healthy.status,200);assert.equal(healthy.body.status,'ok');assert.equal(healthy.body.service,'maison-munezero-api');assert.equal(healthy.body.revision,process.env.APP_REVISION);
  db.query=async()=>{throw new Error('Database test outage');};assert.equal((await call(null,'get','/health')).status,503);
 }finally{db.query=originalQuery;if(previous===undefined)delete process.env.APP_REVISION;else process.env.APP_REVISION=previous;if(renderPrevious===undefined)delete process.env.RENDER_GIT_COMMIT;else process.env.RENDER_GIT_COMMIT=renderPrevious;}
});
async function order(fulfilment='PICKUP',quantity=1){const r=await call(customer,'post','/orders',checkoutData(fulfilment,quantity),randomUUID());assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function cash(o,amount=o.total,key=randomUUID()){const r=await call(admin,'post',`/payments/orders/${o.id}/cash`,{amount,receiptReference:'CASH-TEST'},key);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
test('registration cannot choose a staff role; customer/driver/finance permissions are enforced',async()=>{
 const escalated=await call(null,'post','/auth/register',{email:'evil@test.rw',password:passwords,name:'Test',phone:'250780000001',role:'SUPER_ADMIN'});assert.equal(escalated.status,400);
 assert.equal((await call(customer,'get','/users')).status,403);assert.equal((await call(driver,'get','/reports')).status,403);assert.equal((await call(accountant,'post','/products',{})).status,403);assert.equal((await call(null,'get','/orders')).status,401);
});
test('server rejects submitted prices; checkout snapshots authoritative price and delivery fee',async()=>{
 const bad=await call(customer,'post','/orders',{...checkoutData(),total:1},randomUUID());assert.equal(bad.status,400);
 const o=await order('DELIVERY');assert.equal(o.subtotal,10000);assert.equal(o.delivery_fee,2500);assert.equal(o.total,12500);assert.equal(o.status,'AWAITING_PAYMENT');
 assert.equal((await call(other,'get',`/orders/${o.id}`)).status,403);assert.equal((await call(driver,'get',`/orders/${o.id}`)).status,403);
});
test('checkout retries return the same order; reusing key with different payload is rejected',async()=>{
 const key=randomUUID(),body=checkoutData();const a=await call(customer,'post','/orders',body,key);const b=await call(customer,'post','/orders',body,key);assert.equal(a.status,201);assert.equal(a.body.id,b.body.id);
 assert.equal((await call(customer,'post','/orders',checkoutData('PICKUP',2),key)).status,409);
});
test('stock cannot go negative and cancellation releases a reservation exactly once',async()=>{
 const before=(await sql.query('SELECT stock FROM variants WHERE id=$1',[variant.id])).rows[0].stock;
 assert.equal((await call(customer,'post','/orders',checkoutData('PICKUP',50),randomUUID())).status,409);
 const o=await order();assert.equal((await sql.query('SELECT stock FROM variants WHERE id=$1',[variant.id])).rows[0].stock,before-1);
 assert.equal((await call(customer,'post',`/orders/${o.id}/status`,{status:'CANCELLED',note:'Changed my mind'})).status,201);
 assert.equal((await call(customer,'post',`/orders/${o.id}/status`,{status:'CANCELLED',note:'Again'})).status,403);
 assert.equal((await sql.query('SELECT stock FROM variants WHERE id=$1',[variant.id])).rows[0].stock,before);
});
test('cash is role restricted, bounded and idempotent; unpaid orders cannot become ready',async()=>{
 const o=await order();assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'READY',note:'Ready'})).status,409);
 assert.equal((await call(customer,'post',`/payments/orders/${o.id}/cash`,{amount:o.total,receiptReference:'X'},randomUUID())).status,403);
 assert.equal((await call(admin,'post',`/payments/orders/${o.id}/cash`,{amount:o.total+1,receiptReference:'X'},randomUUID())).status,409);
 const key=randomUUID();const a=await cash(o,o.total,key),b=await cash(o,o.total,key);assert.equal(a.id,b.id);
 const d=(await call(customer,'get',`/orders/${o.id}`)).body;assert.equal(d.paid,o.total);assert.equal(d.status,'CONFIRMED');
 assert.equal((await call(customer,'post',`/orders/${o.id}/status`,{status:'CANCELLED',note:'Cancel paid'})).status,403);
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'READY',note:'Packed'})).status,201);
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'COMPLETED',note:'Collected',pickupCode:'wrong'})).status,400);
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'COMPLETED',note:'Collected',pickupCode:d.pickup_code})).status,201);
});
test('MoMo retries submit once; forged callbacks do not pay an order; verified settlement is applied once',async()=>{
 const o=await order(),key=randomUUID(),body={phone:'250780000001'};
 const p=await call(customer,'post',`/payments/orders/${o.id}/momo`,body,key);assert.equal(p.status,201);const calls=provider.calls;
 const again=await call(customer,'post',`/payments/orders/${o.id}/momo`,body,key);assert.equal(again.body.id,p.body.id);assert.equal(provider.calls,calls);
 const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.body.id])).rows[0];
 await call(null,'post',`/payments/momo/callback/${raw.reference}`,{status:'SUCCESSFUL',amount:raw.amount});assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,0);
 assert.equal((await call(customer,'post',`/orders/${o.id}/status`,{status:'CANCELLED',note:'Cancel'})).status,409);
 assert.equal((await call(customer,'post',`/payments/orders/${o.id}/momo`,body,randomUUID())).status,409);
 provider.results.set(raw.reference,{status:'SUCCESSFUL',externalId:raw.id,amount:String(raw.amount),currency:'EUR',payer:{partyId:raw.phone},financialTransactionId:'MTN-TEST'});
 assert.equal((await call(customer,'post',`/payments/${raw.id}/check`,{})).body.status,'SUCCESSFUL');await call(customer,'post',`/payments/${raw.id}/check`,{});
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,o.total);
});
test('a provider amount mismatch cannot settle a payment',async()=>{
 const o=await order();const p=(await call(customer,'post',`/payments/orders/${o.id}/momo`,{phone:'250780000001'},randomUUID())).body;const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];provider.results.set(raw.reference,{status:'SUCCESSFUL',externalId:raw.id,amount:'1',currency:'EUR',payer:{partyId:raw.phone}});
 assert.equal((await call(customer,'post',`/payments/${raw.id}/check`,{})).status,409);assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,0);
});
test('bespoke quote, assignment, privacy, acceptance, deposit, production, fitting and balance work',async()=>{
 const b=(await call(customer,'post','/bespoke',{title:'Wedding dress',garment:'Dress',description:'Custom bridal dress'})).body;
 assert.equal((await call(other,'get',`/bespoke/${b.id}`)).status,403);assert.equal((await call(designer,'get',`/bespoke/${b.id}`)).status,403);
 assert.equal((await call(admin,'post',`/bespoke/${b.id}/assign`,{designerId:designer.id,tailorId:tailor.id})).status,201);
 assert.equal((await call(designer,'post',`/bespoke/${b.id}/quote`,{amount:50000,notes:'Fabric and two fittings included',dueDate:new Date(Date.now()+180*86400000).toISOString().slice(0,10)})).status,201);
 assert.equal((await call(tailor,'patch',`/bespoke/${b.id}/measurements`,{unit:'cm',waist:72,hip:94})).status,200);
 const o=(await call(customer,'post',`/bespoke/${b.id}/accept`,{fulfilment:'PICKUP'})).body;assert.equal(o.total,50000);assert.equal(o.deposit_due,25000);
 assert.equal((await call(customer,'post',`/bespoke/${b.id}/accept`,{fulfilment:'PICKUP'})).body.id,o.id);
 assert.equal((await call(tailor,'post',`/orders/${o.id}/status`,{status:'IN_PRODUCTION',note:'Start sewing'})).status,409);
 await cash(o,25000);assert.equal((await call(tailor,'post',`/orders/${o.id}/status`,{status:'IN_PRODUCTION',note:'Start sewing'})).status,201);
 assert.equal((await call(tailor,'post',`/bespoke/${b.id}/fitting`,{})).status,201);assert.equal((await call(tailor,'post',`/orders/${o.id}/status`,{status:'READY',note:'Final fitting done'})).status,201);
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'COMPLETED',note:'Collected',pickupCode:o.pickup_code})).status,409);await cash(o,25000);
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'COMPLETED',note:'Collected',pickupCode:o.pickup_code})).status,201);
});
test('delivery assignment and reassignment restrict driver access and require recipient code',async()=>{
 const o=await order('DELIVERY');await cash(o);await call(admin,'post',`/orders/${o.id}/status`,{status:'READY',note:'Packed'});
 const del=(await call(admin,'get','/deliveries')).body.find(d=>d.order_id===o.id);
 assert.equal((await call(admin,'post',`/deliveries/${del.id}/assign`,{driverId:driver.id})).status,201);
 assert.equal((await call(driver,'post',`/deliveries/${del.id}/status`,{status:'PICKED_UP',proof:'At shop'})).status,201);
 assert.equal((await call(admin,'post',`/deliveries/${del.id}/assign`,{driverId:driver2.id})).status,201);
 assert.equal((await call(driver,'get',`/orders/${o.id}`)).status,403);const visible=(await call(driver2,'get',`/orders/${o.id}`)).body;assert.equal(visible.pickup_code,undefined);
 await call(driver2,'post',`/deliveries/${del.id}/status`,{status:'PICKED_UP',proof:'Collected'});
 assert.equal((await call(driver2,'post',`/deliveries/${del.id}/status`,{status:'DELIVERED',proof:'Received',collectionCode:'wrong'})).status,400);
 assert.equal((await call(driver2,'post',`/deliveries/${del.id}/status`,{status:'DELIVERED',proof:'Received',collectionCode:o.pickup_code})).status,201);
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.status,'COMPLETED');
});
test('appointment confirmation prevents a staff double booking',async()=>{
 const startsAt=new Date(Date.now()+86400000).toISOString();const a=(await call(customer,'post','/appointments',{kind:'CONSULTATION',startsAt})).body;const b=(await call(other,'post','/appointments',{kind:'MEASUREMENT',startsAt})).body;
 assert.equal((await call(admin,'post',`/appointments/${a.id}/status`,{status:'CONFIRMED',staffId:designer.id})).status,201);
 assert.equal((await call(admin,'post',`/appointments/${b.id}/status`,{status:'CONFIRMED',staffId:designer.id})).status,409);
 assert.equal((await call(customer,'post',`/appointments/${b.id}/status`,{status:'CANCELLED'})).status,403);
});
test('refund review blocks fulfilment, requires bounded amount and verified external reference',async()=>{
 const o=await order();await cash(o);const rt=(await call(customer,'post','/returns',{orderId:o.id,reason:'Changed requirement'})).body;
 assert.equal((await call(admin,'post',`/orders/${o.id}/status`,{status:'READY',note:'Packed'})).status,409);
 assert.equal((await call(accountant,'post',`/returns/${rt.id}/status`,{status:'APPROVED',amount:o.total+1})).status,400);
 assert.equal((await call(accountant,'post',`/returns/${rt.id}/status`,{status:'APPROVED',amount:o.total})).status,201);
 assert.equal((await call(accountant,'post',`/returns/${rt.id}/status`,{status:'REFUNDED'})).status,400);
 assert.equal((await call(accountant,'post',`/returns/${rt.id}/status`,{status:'REFUNDED',refundReference:'BANK-CONFIRMED-1'})).status,201);
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.status,'CANCELLED');
});
test('competing checkouts cannot oversell the last piece',async()=>{
 const p=(await call(admin,'post','/products',{name:'Last piece',description:'Concurrency fixture',category:'Dresses',price:1000,variants:[{sku:'LAST-S',size:'S',color:'Black',stock:1}]})).body;
 const v=(await call(customer,'get',`/products/${p.id}`)).body.variants[0];const b={...checkoutData(),items:[{variantId:v.id,quantity:1}]};
 const result=await Promise.all([call(customer,'post','/orders',b,randomUUID()),call(other,'post','/orders',b,randomUUID())]);
 assert.deepEqual(result.map(r=>r.status).sort(),[201,409]);assert.equal((await sql.query('SELECT stock FROM variants WHERE id=$1',[v.id])).rows[0].stock,0);
});

test('media uploads reject non-images and customer account deletion revokes sign-in',async()=>{
 const bad=await request(app.getHttpServer()).post('/api/v1/media/upload').set('Authorization',`Bearer ${admin.token}`).attach('file',Buffer.from('<script>test</script>'),'bad.png');assert.equal(bad.status,400);
 const r=await call(null,'post','/auth/register',{email:'delete@test.rw',password:passwords,name:'Delete account',phone:'250780000001'});const u={...r.body.user,token:r.body.accessToken};
 assert.equal((await call(u,'delete','/auth/account')).status,200);assert.equal((await call(u,'get','/auth/me')).status,401);
 assert.equal((await call(null,'post','/auth/login',{email:'delete@test.rw',password:passwords})).status,401);
});

test('email verification is one-time and production ordering requires it; password reset revokes sessions',async()=>{
 const registered=await call(null,'post','/auth/register',{email:'verified@test.rw',password:passwords,name:'Verify',phone:'250780000001'});const u={...registered.body.user,token:registered.body.accessToken};
 const email=(await sql.query("SELECT body FROM outbox WHERE user_id=$1 AND subject='Verify your Maison Munezero email' ORDER BY created_at DESC LIMIT 1",[u.id])).rows[0];const code=email.body.match(/[A-Za-z0-9_-]{43}/)[0];
 const oldEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';try{
  assert.equal((await call(u,'post','/orders',checkoutData(),randomUUID())).status,403);
  assert.equal((await call(u,'post','/auth/email/verify',{token:code})).status,201);
  assert.equal((await call(u,'post','/auth/email/verify',{token:code})).status,400);
  assert.equal((await call(u,'post','/orders',checkoutData(),randomUUID())).status,201);
 }finally{if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}
 await call(null,'post','/auth/forgot-password',{email:'verified@test.rw'});const reset=(await sql.query("SELECT body FROM outbox WHERE user_id=$1 AND subject='Reset your Maison Munezero password' ORDER BY created_at DESC LIMIT 1",[u.id])).rows[0].body.match(/[A-Za-z0-9_-]{43}/)[0];
 assert.equal((await call(null,'post','/auth/reset-password',{token:reset,password:'NewMaison!2026pass'})).status,201);
 assert.equal((await call(u,'get','/auth/me')).status,401);assert.equal((await call(null,'post','/auth/reset-password',{token:reset,password:'NewMaison!2026pass'})).status,400);
});

test('refresh tokens rotate, logout revokes access and staff role changes revoke sessions',async()=>{
 const r=await call(null,'post','/auth/refresh',{refreshToken:other.refresh});assert.equal(r.status,201);assert.equal((await call(null,'post','/auth/refresh',{refreshToken:other.refresh})).status,401);
 const fresh={...other,token:r.body.accessToken};await call(fresh,'post','/auth/logout',{});assert.equal((await call(fresh,'get','/auth/me')).status,401);
 assert.equal((await call(admin,'patch',`/users/${driver.id}`,{active:false,role:'DRIVER'})).status,200);assert.equal((await call(driver,'get','/auth/me')).status,401);
});
test('report totals and audit trail reflect business operations',async()=>{
 const report=await call(accountant,'get','/reports');assert.equal(report.status,200);assert.ok(report.body.gross>0);assert.equal(report.body.refunds,10000);assert.equal(report.body.net,report.body.gross-report.body.refunds);
 const history=await call(admin,'get','/audit');assert.equal(history.status,200);assert.ok(history.body.some(a=>a.action==='MOMO_SUCCESSFUL'));assert.ok(history.body.some(a=>a.action==='DRIVER_ASSIGNED'));
});
