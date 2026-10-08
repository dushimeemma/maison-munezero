import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import diagnosticsModule from '../dist/check-payments.js';
import providerModule from '../dist/payment-providers.js';
const {inspectPendingFlutterwave}=diagnosticsModule;
const {Flutterwave,FlutterwaveUnavailable}=providerModule;
function payment(){return {id:randomUUID(),reference:randomUUID(),status:'PENDING',submission:'UNCERTAIN',sandbox:true,authorization_url:null,amount:1500,provider_currency:'RWF',phone:'250780000001',payer_email:'private@example.test'};}

test('diagnostics verify existing references with GET only and do not reveal credentials or payer data',async()=>{
 const p=payment(),queries=[],calls=[],originalFetch=globalThis.fetch,previous={...process.env};
 process.env.FLUTTERWAVE_MODE='test';process.env.FLUTTERWAVE_SECRET_KEY='FLWSECK_TEST-private-fixture-X';
 try{
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({status:'error',message:'No transaction was found for this reference'}),{status:400});};
  const reports=await inspectPendingFlutterwave({async query(q){queries.push(q);return {rows:[p]};}},new Flutterwave());
  assert.equal(queries.length,1);assert.match(queries[0],/^SELECT /);assert.match(queries[0],/status='PENDING'/);
  assert.equal(calls.length,1);assert.equal(calls[0].init.method??'GET','GET');assert.ok(String(calls[0].url).endsWith(`verify_by_reference?tx_ref=${p.reference}`));
  assert.equal(reports[0].verification,'NOT_FOUND_OR_NOT_YET_AVAILABLE');assert.equal(reports[0].hasConfirmationLink,false);
  for(const secret of [process.env.FLUTTERWAVE_SECRET_KEY,p.phone,p.payer_email])assert.ok(!JSON.stringify(reports).includes(secret));
  assert.equal(p.status,'PENDING');assert.equal(p.submission,'UNCERTAIN');
 }finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
test('diagnostics retain unavailable requests and fixed HTTP diagnostics without printing thrown errors',async()=>{
 const rows=[payment(),payment()],gateway={async status(p){if(p.id===rows[0].id)throw new FlutterwaveUnavailable('AUTHENTICATION',401);throw new Error('Bearer private-token 250780000001 private@example.test');}};
 const reports=await inspectPendingFlutterwave({async query(){return {rows};}},gateway);
 assert.equal(reports[0].code,'AUTHENTICATION');assert.equal(reports[0].httpStatus,401);assert.equal(reports[1].code,'UNKNOWN');
 assert.ok(reports.every(r=>r.verification==='UNAVAILABLE'));assert.ok(!JSON.stringify(reports).includes('private-token'));
});
test('diagnostics report provider outcome and settlement mismatches without applying a payment',async()=>{
 const rows=[payment(),payment()],gateway={async status(p){return {status:'SUCCESSFUL',reference:p.reference,amount:p.amount,currency:p.id===rows[0].id?'RWF':'EUR',email:p.payer_email,phone:p.phone,transactionId:'provider-private-id'};}};
 const reports=await inspectPendingFlutterwave({async query(){return {rows};}},gateway);
 assert.equal(reports[0].verification,'SUCCESSFUL');assert.equal(reports[0].matchesStoredPayment,true);assert.equal(reports[0].hasProviderTransactionId,true);assert.equal(reports[1].matchesStoredPayment,false);assert.deepEqual(reports[1].mismatchFields,['currency']);
 assert.ok(rows.every(p=>p.status==='PENDING'));assert.ok(!JSON.stringify(reports).includes('provider-private-id'));
});
test('CLI refuses invalid configuration before accessing a database and never prints environment secrets',()=>{
 const secret='private-key-value',result=spawnSync(process.execPath,['dist/check-payments.js'],{encoding:'utf8',timeout:10000,env:{...process.env,FLUTTERWAVE_MODE:secret,FLUTTERWAVE_SECRET_KEY:secret,DATABASE_URL:'postgresql://private-user:private-password@invalid.test/private-db'}});
 assert.equal(result.status,1);const output=result.stdout+result.stderr;assert.match(output,/"readOnly":true/);assert.match(output,/"mode":"INVALID"/);assert.match(output,/"matchingV3KeyConfigured":false/);
 for(const privateValue of [secret,'private-password','private-user','invalid.test'])assert.ok(!output.includes(privateValue));
});

test('diagnostics use financial identity even when Flutterwave contacts are missing or differ',async()=>{
 const p=payment(),result={status:'SUCCESSFUL',reference:p.reference,amount:p.amount,currency:'RWF',phone:'N/A',email:'different-private@example.test',transactionId:'private-provider-id'};
 const reports=await inspectPendingFlutterwave({async query(){return {rows:[p]};}},{async status(){return result;}});
 assert.equal(reports[0].matchesStoredPayment,true);assert.deepEqual(reports[0].mismatchFields,[]);
 for(const value of [p.payer_email,p.phone,result.email,result.phone,result.transactionId])assert.ok(!JSON.stringify(reports).includes(value));
});
