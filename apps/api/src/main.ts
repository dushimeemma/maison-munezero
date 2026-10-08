import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app';
import { Flutterwave } from './payment-providers';
import { assertEmailConfigured } from './email';
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
 if(process.env.NODE_ENV==='production'){
  if(!process.env.CORS_ORIGINS?.startsWith('https://'))throw new Error('Production HTTPS CORS origins are required');
  assertEmailConfigured();
  if(process.env.FLUTTERWAVE_MODE!=='live')throw new Error('Production requires Flutterwave live payment mode');
  new Flutterwave().assertConfigured();
  if(!process.env.FLUTTERWAVE_WEBHOOK_SECRET||process.env.FLUTTERWAVE_WEBHOOK_SECRET.length<32)throw new Error('Production requires a Flutterwave webhook secret of at least 32 characters');
 }
 const app=await NestFactory.create(AppModule,{bodyParser:true});app.setGlobalPrefix('api/v1');
 app.use(helmet());app.enableCors({origin:(process.env.CORS_ORIGINS||'http://localhost:8080').split(','),allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS']});
 app.enableShutdownHooks();await app.listen(Number(process.env.PORT||3000),'0.0.0.0');
}
void main();
