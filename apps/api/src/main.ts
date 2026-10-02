import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app';
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
 if(process.env.NODE_ENV==='production'){
  if(!process.env.CORS_ORIGINS?.startsWith('https://'))throw new Error('Production HTTPS CORS origins are required');
  if(!process.env.SMTP_HOST||!process.env.SMTP_FROM)throw new Error('Production SMTP configuration is required for account recovery');
  if(process.env.MOMO_TARGET_ENVIRONMENT!=='mtnrwanda'||!process.env.MOMO_BASE_URL?.startsWith('https://'))throw new Error('Configure approved MTN Rwanda production environment and HTTPS endpoint');
  if(!process.env.MOMO_SUBSCRIPTION_KEY||!process.env.MOMO_API_USER||!process.env.MOMO_API_KEY)throw new Error('Production MoMo credentials are required');
 }
 const app=await NestFactory.create(AppModule,{bodyParser:true});app.setGlobalPrefix('api/v1');
 app.use(helmet());app.enableCors({origin:(process.env.CORS_ORIGINS||'http://localhost:8080').split(','),allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS']});
 app.enableShutdownHooks();await app.listen(Number(process.env.PORT||3000),'0.0.0.0');
}
void main();
