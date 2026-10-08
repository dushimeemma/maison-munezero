import nodemailer from 'nodemailer';

type Env = NodeJS.ProcessEnv;
type Message = { id:string; to:string; subject:string; text:string };
export class EmailDeliveryError extends Error {
 constructor(public code:string, public httpStatus?:number){super(code);}
}
export function emailProvider(env:Env=process.env){
 const provider=env.EMAIL_PROVIDER||'smtp';
 if(!['smtp','brevo'].includes(provider))throw new EmailDeliveryError('EMAIL_PROVIDER_INVALID');
 return provider;
}
export function assertEmailConfigured(env:Env=process.env){
 if(emailProvider(env)==='brevo'){
  if(!env.BREVO_API_KEY?.trim()||!env.EMAIL_FROM||!/^\S+@\S+\.\S+$/.test(env.EMAIL_FROM))throw new EmailDeliveryError('BREVO_CONFIGURATION_REQUIRED');
 }else if(!env.SMTP_HOST||!env.SMTP_FROM)throw new EmailDeliveryError('SMTP_CONFIGURATION_REQUIRED');
}
export function createEmailDelivery(env:Env=process.env, fetchImpl:typeof fetch=fetch){
 const provider=emailProvider(env);
 if(provider==='smtp'&&!env.SMTP_HOST)return undefined;
 assertEmailConfigured(env);
 if(provider==='brevo')return {
  provider,
  async send(message:Message){
   let response:Response;
   try{response=await fetchImpl('https://api.brevo.com/v3/smtp/email',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'api-key':env.BREVO_API_KEY!,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({sender:{email:env.EMAIL_FROM,name:env.EMAIL_FROM_NAME||'Maison Munezero'},to:[{email:message.to}],subject:message.subject,textContent:message.text}),
   });}catch{throw new EmailDeliveryError('EMAIL_NETWORK_OR_TIMEOUT');}
   if(!response.ok)throw new EmailDeliveryError('EMAIL_PROVIDER_REJECTED',response.status);
   let result:any;
   try{result=await response.json();}catch{throw new EmailDeliveryError('EMAIL_RESPONSE_INVALID',response.status);}
   if(typeof result?.messageId!=='string'||!result.messageId)throw new EmailDeliveryError('EMAIL_RESPONSE_INVALID',response.status);
  },
  close(){},
 };
 const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure:env.SMTP_SECURE==='true',connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS}:undefined});
 return {provider,async send(message:Message){try{await transport.sendMail({from:env.SMTP_FROM,to:message.to,subject:message.subject,text:message.text});}catch{throw new EmailDeliveryError('EMAIL_SMTP_FAILED');}},close(){transport.close();}};
}
