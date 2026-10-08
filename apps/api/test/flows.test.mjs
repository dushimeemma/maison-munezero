import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import appModule from '../dist/app.js';
import dbModule from '../dist/db.js';
import paymentModule from '../dist/payments.js';
import workerModule from '../dist/workers.js';
import providerModule from '../dist/payment-providers.js';
import diagnosticsModule from '../dist/check-payments.js';
const {AppModule}=appModule,{Db}=dbModule,{Momo,Flutterwave}=paymentModule;
let app,sql,db,engine,admin,customer,other,designer,tailor,driver,driver2,accountant,product,variant;
const provider=Object.assign(new Flutterwave(),{assertConfigured(){},calls:0,results:new Map(),async submit(){this.calls++;return {authorizationUrl:'https://checkout.flutterwave.com/captcha/verify/test'};},async status(p){return this.results.get(p.reference)||null;}});
const legacyProvider=Object.assign(new Momo(),{assertConfigured(){},results:new Map(),async submit(){return {};},async status(p){return this.results.get(p.reference)||null;}});
const passwords='Maison!Test2026strong';
before(async()=>{
 process.env.WORKERS_DISABLED='true';
 process.env.FLUTTERWAVE_WEBHOOK_SECRET='test-webhook-secret-that-is-at-least-32-characters';
 if(process.env.TEST_DATABASE_URL){if(process.env.NODE_ENV==='production'||!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'))throw new Error('Tests require a dedicated database whose name ends with _test');engine=new Pool({connectionString:process.env.TEST_DATABASE_URL});sql={query:(q,p=[])=>engine.query(q,p)};db={...sql,tx:async fn=>{const c=await engine.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};await sql.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await sql.query(readFileSync('migrations/001_initial.sql','utf8'));}
 else{engine=new PGlite();await engine.exec(readFileSync('migrations/001_initial.sql','utf8'));sql={query:(q,p=[])=>engine.query(q,p)};db={...sql,tx:fn=>engine.transaction(tx=>fn({query:(q,p=[])=>tx.query(q,p)}))};}
 for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n!=='001_initial.sql').sort()){const migration=readFileSync(`migrations/${name}`,'utf8');if(process.env.TEST_DATABASE_URL)await sql.query(migration);else await engine.exec(migration);}
 const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(Db).useValue(db).overrideProvider(Momo).useValue(legacyProvider).overrideProvider(Flutterwave).useValue(provider).compile();app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');await app.init();
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
test('Flutterwave retries submit once; signed webhook data cannot pay an order; verified settlement is applied once',async()=>{
 const o=await order(),key=randomUUID(),body={phone:'250780000001'};
 const p=await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key);assert.equal(p.status,201);assert.equal(p.body.provider,'FLUTTERWAVE');assert.equal(p.body.providerCurrency,'RWF');assert.equal(p.body.sandbox,true);assert.ok(p.body.authorizationUrl);const calls=provider.calls;
 const again=await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key);assert.equal(again.body.id,p.body.id);assert.equal(provider.calls,calls);
 const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.body.id])).rows[0];
 const webhook={event:'charge.completed',data:{tx_ref:raw.reference,status:'successful',amount:raw.amount}};
 assert.equal((await call(null,'post','/payments/flutterwave/webhook',webhook)).status,401);
 await request(app.getHttpServer()).post('/api/v1/payments/flutterwave/webhook').set('verif-hash',process.env.FLUTTERWAVE_WEBHOOK_SECRET).send(webhook).expect(200);assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,0);
 assert.equal((await call(customer,'post',`/orders/${o.id}/status`,{status:'CANCELLED',note:'Cancel'})).status,409);
 assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,randomUUID())).status,409);
 provider.results.set(raw.reference,{status:'SUCCESSFUL',reference:raw.reference,amount:raw.amount,currency:'RWF',phone:raw.phone,email:raw.payer_email,transactionId:'FLW-TEST'});
 assert.equal((await call(customer,'post',`/payments/${raw.id}/check`,{})).body.status,'SUCCESSFUL');await call(customer,'post',`/payments/${raw.id}/check`,{});
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,o.total);
});
test('a provider amount mismatch cannot settle a payment',async()=>{
 const o=await order();const p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];provider.results.set(raw.reference,{status:'SUCCESSFUL',reference:raw.reference,amount:1,currency:'RWF',phone:raw.phone,email:raw.payer_email,transactionId:'FLW-MISMATCH'});
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
 const history=await call(admin,'get','/audit');assert.equal(history.status,200);assert.ok(history.body.some(a=>a.action==='FLUTTERWAVE_SUCCESSFUL'));assert.ok(history.body.some(a=>a.action==='DRIVER_ASSIGNED'));
});

async function paymentOrder(){
 const p=(await call(admin,'post','/products',{name:'Payment fixture',description:'Provider test order',category:'Dresses',price:1500,variants:[{sku:randomUUID(),size:'M',color:'Black',stock:1}]})).body;
 const v=(await call(customer,'get',`/products/${p.id}`)).body.variants[0];
 const r=await call(customer,'post','/orders',{...checkoutData(),items:[{variantId:v.id,quantity:1}]},randomUUID());assert.equal(r.status,201);return r.body;
}
function verified(p,overrides={}){return {status:'SUCCESSFUL',reference:p.reference,amount:p.amount,currency:'RWF',phone:p.phone,email:p.payer_email,transactionId:randomUUID(),...overrides};}
test('financial mismatches stay pending and identify only the failed fields',async()=>{
 const o=await paymentOrder();const p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;
 const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];
 for(const mismatch of [{reference:randomUUID()},{currency:'EUR'},{amount:1},{amount:NaN},{transactionId:undefined},{transactionId:'   '}]){
  provider.results.set(raw.reference,verified(raw,mismatch));const response=await call(customer,'post',`/payments/${p.id}/check`,{});assert.equal(response.status,409);assert.ok(response.body.message.includes(Object.keys(mismatch)[0]));assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,0);
 }
 provider.results.set(raw.reference,verified(raw,{phone:'0780000001'}));assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.status,'SUCCESSFUL');
});
test('Flutterwave profile contacts are not settlement identifiers; verified payment applies exactly once',async()=>{
 for(const contacts of [{phone:'N/A',email:undefined},{phone:'250730000002',email:'other@test.rw'},{phone:undefined,email:undefined}]){
  const o=await paymentOrder(),p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;
  const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0],before=provider.calls;
  provider.results.set(raw.reference,verified(raw,contacts));
  for(let i=0;i<2;i++)assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.status,'SUCCESSFUL');
  const detail=(await call(customer,'get',`/orders/${o.id}`)).body;assert.equal(detail.paid,o.total);assert.equal(detail.status,'CONFIRMED');assert.equal(provider.calls,before);
  assert.equal((await sql.query("SELECT count(*)::int n FROM audit WHERE entity_id=$1 AND action='FLUTTERWAVE_SUCCESSFUL'",[p.id])).rows[0].n,1);
 }
});
test('lost submission response cannot trigger resubmission, cash collection or another provider charge',async()=>{
 const o=await paymentOrder(),key=randomUUID(),body={phone:'250730000001'},original=provider.submit;
 provider.submit=async()=>{provider.calls++;throw new Error('Response lost after accepting charge');};
 try{
  const p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key)).body;
  const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];assert.equal(p.submission,'UNCERTAIN');
  await sql.query("UPDATE payments SET created_at=now()-interval '2 minutes' WHERE id=$1",[p.id]);const before=provider.calls;
  for(let i=0;i<2;i++)assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.status,'PENDING');
  assert.equal((await call(customer,'post',`/payments/orders/${o.id}/momo`,body,key)).body.id,p.id);assert.equal(provider.calls,before);
  assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,randomUUID())).status,409);
  assert.equal((await call(admin,'post',`/payments/orders/${o.id}/cash`,{amount:o.total,receiptReference:'TEST'},randomUUID())).status,409);
  provider.results.set(raw.reference,verified(raw));assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.status,'SUCCESSFUL');
 }finally{provider.submit=original;}
});
test('submission diagnostics remain pending, log only safe metadata, and read-only checks cannot charge again',async()=>{
 const o=await paymentOrder(),key=randomUUID(),body={phone:'250780000001'},original=provider.submit;
 const logger=app.get(paymentModule.PaymentService).logger,originalWarn=logger.warn,logs=[];
 logger.warn=message=>logs.push(JSON.parse(message));
 provider.submit=async()=>{provider.calls++;throw new providerModule.FlutterwaveUnavailable('AUTHENTICATION',401);};
 try{
  const p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key)).body;
  assert.equal(p.status,'PENDING');assert.equal(p.submission,'UNCERTAIN');assert.equal(p.authorizationUrl,null);assert.match(p.failure,/authentication failed/);assert.match(p.failure,/HTTP 401/);
  assert.deepEqual(logs,[{event:'PAYMENT_SUBMISSION_UNCERTAIN',paymentId:p.id,provider:'FLUTTERWAVE',code:'AUTHENTICATION',httpStatus:401}]);
  const before=provider.calls,storedBefore=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];
  const reports=await diagnosticsModule.inspectPendingFlutterwave(sql,provider);assert.ok(reports.some(r=>r.paymentId===p.id));assert.equal(provider.calls,before);
  const storedAfter=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];assert.deepEqual(storedAfter,storedBefore);
  assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key)).body.id,p.id);assert.equal(provider.calls,before);
  const privateValue='private-token private@example.test 250780000001';provider.submit=async()=>{throw new Error(privateValue);};
  const otherOrder=await paymentOrder(),otherPayment=(await call(customer,'post',`/payments/orders/${otherOrder.id}/mobile-money`,body,randomUUID())).body;
  assert.equal(otherPayment.failure,'Awaiting provider reconciliation. Do not pay again.');assert.equal(logs.at(-1).code,'UNKNOWN');
  for(const value of privateValue.split(' '))assert.ok(!JSON.stringify(logs).includes(value));
 }finally{provider.submit=original;logger.warn=originalWarn;}
});
test('Flutterwave sandbox confirmation domains reach payment and order responses without another submission on retry',async()=>{
 const original=provider.submit,originalFetch=globalThis.fetch,oldKey=process.env.FLUTTERWAVE_SECRET_KEY,oldMode=process.env.FLUTTERWAVE_MODE;
 process.env.FLUTTERWAVE_SECRET_KEY='FLWSECK_TEST-fixture-X';process.env.FLUTTERWAVE_MODE='test';
 const gateway=new Flutterwave();provider.submit=async p=>{provider.calls++;return gateway.submit(p);};
 try{
  for(const host of ['ravesandboxapi.flutterwave.com','checkout-v2.dev-flutterwave.com']){
   const url=`https://${host}/captcha/verify/lang-en/private-test-token`;
   let charges=0;globalThis.fetch=async()=>{charges++;return new Response(JSON.stringify({status:'success',meta:{authorization:{mode:'redirect',redirect:url}}}),{status:200});};
   const o=await paymentOrder(),key=randomUUID(),body={phone:'250780000001'};
   const result=await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key);assert.equal(result.status,201);
   const p=result.body;assert.equal(p.submission,'SENT');assert.equal(p.authorizationUrl,url);assert.equal(p.failure,null);
   const detail=(await call(customer,'get',`/orders/${o.id}`)).body;assert.equal(detail.payments[0].authorization_url,url);
   assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,body,key)).body.id,p.id);assert.equal(charges,1);
   assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.authorizationUrl,url);assert.equal(charges,1);
  }
 }finally{provider.submit=original;globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.FLUTTERWAVE_SECRET_KEY;else process.env.FLUTTERWAVE_SECRET_KEY=oldKey;if(oldMode===undefined)delete process.env.FLUTTERWAVE_MODE;else process.env.FLUTTERWAVE_MODE=oldMode;}
});
test('live payment and order responses cannot hand off to the test checkout host',async()=>{
 const o=await paymentOrder(),url='https://checkout-v2.dev-flutterwave.com/captcha/verify/private-test-token';
 const raw=(await sql.query("INSERT INTO payments(order_id,provider,amount,provider_currency,phone,actor_id,submission,sandbox,authorization_url) VALUES($1,'FLUTTERWAVE',$2,'RWF',$3,$4,'SENT',false,$5) RETURNING *",[o.id,o.total,'250780000001',customer.id,url])).rows[0];
 // The stored payment mode, rather than the current environment, governs the handoff.
 assert.equal(provider.sandbox(),true);
 const before=provider.calls,checked=await call(customer,'post',`/payments/${raw.id}/check`,{});
 assert.equal(checked.status,201);assert.equal(checked.body.sandbox,false);assert.equal(checked.body.authorizationUrl,null);
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.payments[0].authorization_url,null);
 assert.equal(provider.calls,before);assert.equal((await sql.query('SELECT authorization_url FROM payments WHERE id=$1',[raw.id])).rows[0].authorization_url,url);
});
test('signed duplicate completion webhooks settle exactly once; private checks remain role restricted',async()=>{
 const o=await paymentOrder(),p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;
 const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];provider.results.set(raw.reference,verified(raw));
 assert.equal((await call(designer,'post',`/payments/${p.id}/check`,{})).status,403);
 const webhook={event:'charge.completed',data:{tx_ref:raw.reference,amount:1,status:'failed'}};
 for(let i=0;i<2;i++)await request(app.getHttpServer()).post('/api/v1/payments/flutterwave/webhook').set('verif-hash',process.env.FLUTTERWAVE_WEBHOOK_SECRET).send(webhook).expect(200);
 assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,o.total);
 assert.equal((await sql.query("SELECT count(*)::int n FROM audit WHERE entity_id=$1 AND action='FLUTTERWAVE_SUCCESSFUL'",[p.id])).rows[0].n,1);
});
test('existing MTN pending payments keep their provider and prevent a new Flutterwave payment',async()=>{
 const o=await paymentOrder();const raw=(await sql.query("INSERT INTO payments(order_id,provider,amount,provider_currency,phone,actor_id,submission,sandbox) VALUES($1,'MOMO',$2,'EUR',$3,$4,'SENT',true) RETURNING *",[o.id,o.total,'250780000001',customer.id])).rows[0];
 const before=provider.calls;assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:raw.phone},randomUUID())).status,409);assert.equal(provider.calls,before);
 legacyProvider.results.set(raw.reference,{status:'SUCCESSFUL',reference:raw.id,amount:raw.amount,currency:'EUR',phone:raw.phone,transactionId:randomUUID()});
 await call(null,'post',`/payments/momo/callback/${raw.reference}`,{status:'FAILED'});
 const p=(await call(customer,'post',`/payments/${raw.id}/check`,{})).body;assert.equal(p.provider,'MOMO');assert.equal(p.status,'SUCCESSFUL');assert.equal(p.sandbox,true);assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,o.total);
});
test('provider declines leave an order unpaid and allow a fresh attempt',async()=>{
 const o=await paymentOrder(),p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;
 const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];provider.results.set(raw.reference,verified(raw,{status:'FAILED'}));
 assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).body.status,'FAILED');assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,0);
 assert.equal((await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:raw.phone},randomUUID())).status,201);
});
test('a provider transaction ID cannot fund two orders',async()=>{
 const transactionId=randomUUID();
 for(let i=0;i<2;i++){
  const o=await paymentOrder(),p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250780000001'},randomUUID())).body;
  const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];provider.results.set(raw.reference,verified(raw,{transactionId}));
  assert.equal((await call(customer,'post',`/payments/${p.id}/check`,{})).status,i===0?201:409);
  assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,i===0?o.total:0);
 }
});
test('legacy provider failures cannot starve new payments in background polling', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
 // Replica advisory locks and nested worker/payment connections need native PostgreSQL.
 const original=legacyProvider.status,smtp=process.env.SMTP_HOST,legacy=[];
 delete process.env.SMTP_HOST;
 try{
  await sql.query("UPDATE payments SET checked_at=now() WHERE status='PENDING'");
  for(let i=0;i<10;i++){
   const o=await paymentOrder();
   legacy.push((await sql.query("INSERT INTO payments(order_id,provider,amount,provider_currency,phone,actor_id,submission,sandbox,created_at) VALUES($1,'MOMO',$2,'EUR',$3,$4,'SENT',true,now()-interval '2 hours') RETURNING id",[o.id,o.total,'250780000001',customer.id])).rows[0].id);
  }
  const o=await paymentOrder(),p=(await call(customer,'post',`/payments/orders/${o.id}/mobile-money`,{phone:'250730000001'},randomUUID())).body;
  const raw=(await sql.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0];
  legacyProvider.status=async()=>{throw new Error('Legacy provider unavailable');};
  const workers=app.get(workerModule.Workers);
  await workers.tick();
  assert.equal((await sql.query('SELECT count(*)::int n FROM payments WHERE id=ANY($1::uuid[]) AND checked_at IS NOT NULL',[legacy])).rows[0].n,10);
  await workers.tick();assert.ok((await sql.query('SELECT checked_at FROM payments WHERE id=$1',[p.id])).rows[0].checked_at);
  // When all payments are due again, poll the least recently checked first, regardless of creation order.
  await sql.query("UPDATE payments SET checked_at=now()-interval '30 seconds' WHERE id=ANY($1::uuid[])",[legacy]);
  await sql.query("UPDATE payments SET checked_at=now()-interval '60 seconds' WHERE id=$1",[p.id]);
  provider.results.set(raw.reference,verified(raw));await workers.tick();
  assert.equal((await call(customer,'get',`/orders/${o.id}`)).body.paid,o.total);
 }finally{legacyProvider.status=original;if(smtp===undefined)delete process.env.SMTP_HOST;else process.env.SMTP_HOST=smtp;}
});
