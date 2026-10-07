import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import providerModule from '../dist/payment-providers.js';
const {Flutterwave,Momo,FlutterwaveUnavailable}=providerModule;

async function fixture(run){
 const originalFetch=globalThis.fetch,previous={...process.env};
 process.env.FLUTTERWAVE_MODE='test';process.env.FLUTTERWAVE_SECRET_KEY='FLWSECK_TEST-fixture-X';
 process.env.FLUTTERWAVE_WEBHOOK_SECRET='fixture-secret-hash-at-least-32-characters';
 const calls=[];
 const p={id:randomUUID(),reference:randomUUID(),order_id:randomUUID(),amount:1500,provider_currency:'RWF',phone:'250780000001',payer_email:'customer@test.rw',payer_name:'Test Customer',sandbox:true};
 try{await run({gateway:new Flutterwave(),p,calls,respond(status,body){globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});};}});}
 finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
}

test('Rwanda charge sends trusted RWF amount, payer and stable references to Flutterwave v3',()=>fixture(async({gateway,p,calls,respond})=>{
 respond(200,{status:'success',meta:{authorization:{mode:'redirect',redirect:'https://checkout.flutterwave.com/captcha/verify/fixture'}}});
 const submitted=await gateway.submit(p);assert.equal(submitted.authorizationUrl,'https://checkout.flutterwave.com/captcha/verify/fixture');
 assert.equal(calls[0].url,'https://api.flutterwave.com/v3/charges?type=mobile_money_rwanda');
 assert.equal(calls[0].init.headers.Authorization,`Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`);
 const body=JSON.parse(calls[0].init.body);assert.equal(body.amount,1500);assert.equal(body.currency,'RWF');assert.equal(body.phone_number,p.phone);assert.equal(body.email,p.payer_email);assert.equal(body.tx_ref,p.reference);assert.equal(body.order_id,p.id);
}));
test('verification uses merchant reference and parses independent provider settlement',()=>fixture(async({gateway,p,calls,respond})=>{
 respond(200,{status:'success',data:{id:123,status:'successful',tx_ref:p.reference,amount:1500,currency:'RWF',customer:{email:p.payer_email,phone_number:p.phone}}});
 const result=await gateway.status(p);assert.equal(calls[0].url,`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${p.reference}`);
 assert.deepEqual(result,{status:'SUCCESSFUL',reference:p.reference,amount:1500,currency:'RWF',phone:p.phone,email:p.payer_email,transactionId:'123'});
}));
test('missing transaction stays unknown; authentication and provider outages are not declines',()=>fixture(async({gateway,p,respond})=>{
 respond(400,{status:'error',message:'No transaction was found for this reference'});assert.equal(await gateway.status(p),null);
 for(const status of [401,403,429,500]){respond(status,{status:'error',message:'Provider error'});await assert.rejects(()=>gateway.status(p),error=>error.getStatus()===503);}
}));
test('only definitive validation rejections permit another charge',()=>fixture(async({gateway,p,respond})=>{
 for(const status of [400,422]){respond(status,{status:'error'});await assert.rejects(()=>gateway.submit(p),error=>error.getStatus()===400);}
 for(const status of [401,408,409,429,500]){respond(status,{status:'error'});await assert.rejects(()=>gateway.submit(p),error=>error.getStatus()===503);}
 globalThis.fetch=async()=>{throw new Error('Lost response after provider accepted');};await assert.rejects(()=>gateway.submit(p));
}));
test('confirmation addresses reject insecure schemes, lookalike hosts and embedded credentials',()=>fixture(async({gateway,p,respond})=>{
 for(const redirect of ['javascript:alert(1)','http://checkout.flutterwave.com/pay','https://checkout.flutterwave.com.evil.test/pay','https://user:pass@checkout.flutterwave.com/pay','https://checkout.flutterwave.com:444/pay']){
  respond(200,{status:'success',meta:{authorization:{mode:'redirect',redirect}}});await assert.rejects(()=>gateway.submit(p),error=>error.getStatus()===503);
 }
 respond(200,{status:'success',meta:{authorization:{mode:'redirect',redirect:'https://ravemodal-dev.herokuapp.com/captcha/verify/test'}}});assert.ok((await gateway.submit(p)).authorizationUrl);
}));
test('test/live keys must match mode; v4 OAuth secrets are rejected',()=>fixture(async({gateway})=>{
 gateway.assertConfigured();assert.equal(gateway.sandbox(),true);assert.equal(gateway.currency(),'RWF');
 process.env.FLUTTERWAVE_MODE='live';assert.throws(()=>gateway.assertConfigured());
 process.env.FLUTTERWAVE_SECRET_KEY='FLWSECK-live-fixture-X';gateway.assertConfigured();assert.equal(gateway.sandbox(),false);
 process.env.FLUTTERWAVE_MODE='test';assert.throws(()=>gateway.assertConfigured());
 process.env.FLUTTERWAVE_SECRET_KEY='oauth-client-secret';assert.throws(()=>gateway.assertConfigured());
}));
test('v3 webhook requires the exact configured secret hash',()=>fixture(async({gateway})=>{
 gateway.verifyWebhook(process.env.FLUTTERWAVE_WEBHOOK_SECRET);
 for(const hash of [undefined,[], 'wrong', 'x'.repeat(process.env.FLUTTERWAVE_WEBHOOK_SECRET.length)])assert.throws(()=>gateway.verifyWebhook(hash),error=>error.getStatus()===401);
 delete process.env.FLUTTERWAVE_WEBHOOK_SECRET;assert.throws(()=>gateway.verifyWebhook('anything'),error=>error.getStatus()===503);
}));
test('changing to live mode cannot submit or verify a stored test payment',()=>fixture(async({gateway,p,calls,respond})=>{
 process.env.FLUTTERWAVE_MODE='live';process.env.FLUTTERWAVE_SECRET_KEY='FLWSECK-live-fixture-X';
 respond(200,{status:'success'});
 await assert.rejects(()=>gateway.submit(p),error=>error.getStatus()===503);await assert.rejects(()=>gateway.status(p),error=>error.getStatus()===503);assert.equal(calls.length,0);
}));
test('historical MTN verification retains its original provider UUID and external payment ID',()=>fixture(async({p,calls,respond})=>{
 process.env.MOMO_SUBSCRIPTION_KEY='fixture';process.env.MOMO_API_USER='fixture';process.env.MOMO_API_KEY='fixture';
 const gateway=new Momo();let count=0;
 globalThis.fetch=async(url)=>{calls.push({url:String(url)});count++;return new Response(JSON.stringify(count===1?{access_token:'fixture',expires_in:3600}:{status:'SUCCESSFUL',externalId:p.id,amount:'1500',currency:'EUR',payer:{partyId:p.phone},financialTransactionId:'legacy-123'}),{status:200});};
 const result=await gateway.status(p);assert.ok(calls[1].url.endsWith(`/collection/v1_0/requesttopay/${p.reference}`));assert.equal(result.reference,p.id);assert.equal(result.currency,'EUR');assert.equal(result.transactionId,'legacy-123');
}));

test('uncertain submissions expose fixed diagnostic codes and HTTP status without provider bodies',()=>fixture(async({gateway,p,respond})=>{
 const privateBody={status:'error',message:`Bearer ${process.env.FLUTTERWAVE_SECRET_KEY} ${p.phone} ${p.payer_email} https://checkout.flutterwave.com/private-token`};
 for(const [httpStatus,code] of [[401,'AUTHENTICATION'],[403,'ACCESS_DENIED'],[429,'RATE_LIMITED'],[500,'PROVIDER_UNAVAILABLE'],[409,'HTTP_ERROR']]){
  respond(httpStatus,privateBody);
  for(const method of ['submit','status'])await assert.rejects(()=>gateway[method](p),error=>{
   assert.ok(error instanceof FlutterwaveUnavailable);assert.equal(error.code,code);assert.equal(error.httpStatus,httpStatus);assert.equal(error.getStatus(),503);
   for(const value of [process.env.FLUTTERWAVE_SECRET_KEY,p.phone,p.payer_email,'private-token'])assert.ok(!JSON.stringify(error.getResponse()).includes(value));
   return true;
  });
 }
 globalThis.fetch=async()=>{throw new Error(privateBody.message);};await assert.rejects(()=>gateway.submit(p),error=>error.code==='NETWORK'&&!error.message.includes(p.phone));
}));
test('invalid JSON, missing confirmation and unsupported addresses remain distinguishable without leaking response data',()=>fixture(async({gateway,p,respond})=>{
 globalThis.fetch=async()=>new Response('private-provider-body',{status:200});await assert.rejects(()=>gateway.submit(p),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes('private-provider-body'));
 respond(200,null);await assert.rejects(()=>gateway.submit(p),error=>error.code==='INVALID_RESPONSE');
 respond(200,{status:'success'});await assert.rejects(()=>gateway.submit(p),error=>error.code==='CONFIRMATION_MISSING');
 respond(200,{status:'success',meta:{authorization:{mode:'redirect',redirect:'https://unapproved.test/private-token'}}});await assert.rejects(()=>gateway.submit(p),error=>error.code==='CONFIRMATION_ADDRESS'&&!error.message.includes('private-token'));
}));
