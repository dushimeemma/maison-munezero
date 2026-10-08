import { test } from 'node:test';
import assert from 'node:assert/strict';
import emailModule from '../dist/email.js';
import workerModule from '../dist/workers.js';
const {createEmailDelivery,assertEmailConfigured}=emailModule;
const env={EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'private-test-key',EMAIL_FROM:'sender@example.com',EMAIL_FROM_NAME:'Maison Munezero'};
const message={id:'outbox-test',to:'customer@example.com',subject:'Order update',text:'Your order is ready'};
test('HTTPS email uses the fixed provider endpoint and submits the existing outbox content',async()=>{
 let calls=0;
 const delivery=createEmailDelivery(env,async(url,options)=>{calls++;assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers['api-key'],env.BREVO_API_KEY);assert.ok(options.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(options.body),{sender:{email:env.EMAIL_FROM,name:env.EMAIL_FROM_NAME},to:[{email:message.to}],subject:message.subject,textContent:message.text});return Response.json({messageId:'provider-message-id'},{status:201});});
 await delivery.send(message);delivery.close();assert.equal(calls,1);
});
test('rejection, malformed acknowledgement and timeout never count as accepted delivery',async()=>{
 for(const response of [Response.json({message:'private provider response'},{status:401}),Response.json({},{status:201}),new Response('invalid json',{status:201})]){
  await assert.rejects(createEmailDelivery(env,async()=>response).send(message),e=>!e.message.includes('private provider response')&&['EMAIL_PROVIDER_REJECTED','EMAIL_RESPONSE_INVALID'].includes(e.code));
 }
 await assert.rejects(createEmailDelivery(env,async()=>{throw new Error('private-test-key customer@example.com');}).send(message),e=>e.code==='EMAIL_NETWORK_OR_TIMEOUT'&&!e.message.includes('private-test-key'));
});
test('HTTPS selection never falls back to SMTP; configuration supports both environments',()=>{
 assert.doesNotThrow(()=>assertEmailConfigured(env));assert.doesNotThrow(()=>assertEmailConfigured({SMTP_HOST:'localhost',SMTP_FROM:'sender@example.com'}));
 assert.equal(createEmailDelivery({}),undefined);
 assert.throws(()=>createEmailDelivery({...env,BREVO_API_KEY:'',SMTP_HOST:'localhost',SMTP_FROM:'sender@example.com'}),/BREVO_CONFIGURATION_REQUIRED/);
 assert.throws(()=>createEmailDelivery({EMAIL_PROVIDER:'unknown'}),/EMAIL_PROVIDER_INVALID/);
});
async function workerDelivery(response){
 const names=['EMAIL_PROVIDER','BREVO_API_KEY','EMAIL_FROM','EMAIL_FROM_NAME'];const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));const originalFetch=globalThis.fetch,originalWarn=console.warn;
 const updates=[],logs=[];Object.assign(process.env,env);globalThis.fetch=async()=>response;console.warn=s=>logs.push(s);
 const db={async query(q,p){if(q.includes('pg_try_advisory'))return {rows:[{locked:true}]};if(q.includes('SELECT o.*'))return {rows:[{id:message.id,email:message.to,subject:message.subject,body:message.text}]};if(q.startsWith('UPDATE outbox'))updates.push({q,p});return {rows:[]};},async tx(fn){return fn(this);}};
 try{await new workerModule.Workers(db,{}).tick();return {updates,logs};}
 finally{globalThis.fetch=originalFetch;console.warn=originalWarn;for(const k of names)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
}
test('worker marks a message sent only after the HTTPS provider accepts it',async()=>{
 const {updates,logs}=await workerDelivery(Response.json({messageId:'accepted'},{status:201}));assert.equal(updates.length,1);assert.match(updates[0].q,/sent_at=now\(\)/);assert.deepEqual(updates[0].p,[message.id]);assert.equal(logs.length,0);
});
test('worker leaves failures unsent, schedules retry and logs only safe diagnostic fields',async()=>{
 const {updates,logs}=await workerDelivery(Response.json({message:'secret body'},{status:403}));assert.equal(updates.length,1);assert.match(updates[0].q,/next_at=now\(\)\+interval '10 minutes'/);assert.doesNotMatch(updates[0].q,/sent_at=/);assert.deepEqual(JSON.parse(logs[0]),{event:'EMAIL_DELIVERY_FAILED',provider:'brevo',code:'EMAIL_PROVIDER_REJECTED',httpStatus:403});assert.ok(!logs.join('').includes(message.to));
});
