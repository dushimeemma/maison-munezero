import 'reflect-metadata';
import { Module, Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { Db } from './db';
import { Public,AuthGuard,Errors } from './security';
import { AuthService,AuthController } from './auth';
import { CatalogController } from './catalog';
import { OrderService,OrderController } from './orders';
import { Momo,PaymentService,PaymentController } from './payments';
import { StudioService,StudioController,AppointmentsController } from './studio';
import { OperationsController } from './operations';
import { Workers } from './workers';
import { MediaController } from './media';
@Controller('health')
class HealthController {
 constructor(private db:Db){}
 @Get() @Public() async health(){try{await this.db.query('SELECT 1');return {status:'ok',service:'maison-munezero-api',revision:process.env.RENDER_GIT_COMMIT||process.env.APP_REVISION||null};}catch{throw new ServiceUnavailableException('Database unavailable');}}
}
@Module({controllers:[HealthController,AuthController,CatalogController,OrderController,PaymentController,StudioController,AppointmentsController,OperationsController,MediaController],providers:[Db,AuthService,OrderService,Momo,PaymentService,StudioService,Workers,{provide:APP_GUARD,useClass:AuthGuard},{provide:APP_FILTER,useClass:Errors}]})
export class AppModule{}
