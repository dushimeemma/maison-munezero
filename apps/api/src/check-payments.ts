import 'dotenv/config';
import { Db, Sql } from './db';
import { Flutterwave, FlutterwaveUnavailable, MobileMoneyGateway } from './payment-providers';
import { paymentMismatchFields } from './payment-verification';

// Inspect existing requests only: no POST, reconciliation, resubmission or writes.
export async function inspectPendingFlutterwave(sql:Sql,gateway:Pick<MobileMoneyGateway,'status'>){
 const payments=(await sql.query("SELECT id,reference,status,submission,sandbox,authorization_url,amount,provider_currency,phone,payer_email FROM payments WHERE provider='FLUTTERWAVE' AND status='PENDING' ORDER BY created_at DESC LIMIT 5")).rows;
 return Promise.all(payments.map(async p=>{
  const summary={paymentId:p.id,reference:p.reference,testPayment:p.sandbox,submission:p.submission,hasConfirmationLink:!!p.authorization_url};
  try{
   const result=await gateway.status(p);
   if(!result)return {...summary,verification:'NOT_FOUND_OR_NOT_YET_AVAILABLE'};
   const mismatchFields=paymentMismatchFields({...p,provider:'FLUTTERWAVE'},result);
   const status=['SUCCESSFUL','FAILED','PENDING'].includes(result.status)?result.status:'UNKNOWN';
   return {...summary,verification:status,matchesStoredPayment:mismatchFields.length===0,mismatchFields,hasProviderTransactionId:!!result.transactionId};
  }catch(error){
   const diagnostic=error instanceof FlutterwaveUnavailable?error:undefined;
   return {...summary,verification:'UNAVAILABLE',code:diagnostic?.code||'UNKNOWN',httpStatus:diagnostic?.httpStatus};
  }
 }));
}

async function run(){
 const gateway=new Flutterwave();
 const mode=process.env.FLUTTERWAVE_MODE||'test';
 let configured=true;
 try{gateway.assertConfigured();}catch{configured=false;}
 console.log(JSON.stringify({readOnly:true,mode:['test','live'].includes(mode)?mode:'INVALID',matchingV3KeyConfigured:configured}));
 if(!configured){console.log('Configure the matching Flutterwave v3 secret key and mode in the API environment.');process.exitCode=1;return;}
 if(!process.env.DATABASE_URL){console.log('DATABASE_URL is missing from the API environment.');process.exitCode=1;return;}
 const db=new Db();
 try{
  // PostgreSQL enforces read-only access for this diagnostic transaction.
  const reports=await db.tx(async sql=>{await sql.query('SET TRANSACTION READ ONLY');return inspectPendingFlutterwave(sql,gateway);});
  if(!reports.length)console.log('No pending Flutterwave payments found.');
  for(const report of reports)console.log(JSON.stringify(report));
 }finally{await db.onModuleDestroy();}
}
if(require.main===module)run().catch(()=>{console.error('Payment diagnostics could not complete. Check database connectivity and run migration 002. No payment was submitted or updated.');process.exitCode=1;});
