import {test} from 'node:test';
import assert from 'node:assert/strict';
import verification from '../dist/payment-verification.js';
const {paymentMismatchFields}=verification;
const p={id:'legacy-payment',reference:'merchant-reference',provider:'FLUTTERWAVE',amount:85000,provider_currency:'RWF',phone:'250780000001',payer_email:'private@example.test'};
const result={reference:p.reference,status:'SUCCESSFUL',amount:85000,currency:'RWF',transactionId:'provider-id'};
test('legacy MTN still requires its original external ID and wallet number',()=>{
 const legacy={...p,provider:'MOMO'},verified={...result,reference:p.id,phone:p.phone};
 assert.deepEqual(paymentMismatchFields(legacy,verified),[]);
 assert.deepEqual(paymentMismatchFields(legacy,{...verified,phone:'250730000002'}),['phone']);
 assert.deepEqual(paymentMismatchFields(legacy,{...verified,reference:p.reference}),['reference']);
});
test('financial mismatch reports contain field names only, and invalid amounts cannot pass',()=>{
 assert.deepEqual(paymentMismatchFields(p,result),[]);
 assert.deepEqual(paymentMismatchFields(p,{...result,reference:'private-reference',amount:82535,currency:'EUR',transactionId:''}),['reference','amount','currency','transactionId']);
 for(const amount of [NaN,Infinity,-Infinity,85001,0])assert.deepEqual(paymentMismatchFields(p,{...result,amount}),['amount']);
});
