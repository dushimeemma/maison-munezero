import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException, BadRequestException, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Db, one } from './db';
export const roles = ['SUPER_ADMIN','MANAGER','SALES','DESIGNER','TAILOR','DRIVER','ACCOUNTANT','CUSTOMER'] as const;
export type Role = typeof roles[number];
export type Actor = { id: string; email: string; name: string; role: Role; session_id: string };
export const Public = () => SetMetadata('public', true);
export const Allow = (...allowed: Role[]) => SetMetadata('roles', allowed);
export const management: Role[] = ['SUPER_ADMIN','MANAGER'];
export const sales: Role[] = [...management,'SALES'];
export const studio: Role[] = [...management,'DESIGNER','TAILOR'];
export const finance: Role[] = [...management,'ACCOUNTANT'];
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const uuid = z.string().uuid();
export const money = z.number().int().min(1).max(100000000);
export const phone = z.string().regex(/^2507[2389]\d{7}$/, 'Use Rwanda phone format 2507XXXXXXXX');
export const text = (max = 1000) => z.string().trim().min(1).max(max);
export const optionalUrl = z.union([z.literal(''), z.string().url().regex(/^https:\/\//)]).optional();
export const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body); if (!r.success) throw new BadRequestException(r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data;
};
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(private reflector: Reflector, private db: Db) {}
 async canActivate(context: ExecutionContext) {
  if (this.reflector.getAllAndOverride('public', [context.getHandler(), context.getClass()])) return true;
  const req = context.switchToHttp().getRequest();
  const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
  if (!bearer) throw new UnauthorizedException('Please sign in');
  const actor = await one(this.db, `SELECT u.id,u.email,u.name,u.role,s.id session_id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.access_hash=$1 AND s.access_expires>now() AND s.expires_at>now() AND u.active=true`, [digest(bearer)]);
  if (!actor) throw new UnauthorizedException('Session expired'); req.actor = actor;
  const allowed: Role[] | undefined = this.reflector.getAllAndOverride('roles', [context.getHandler(), context.getClass()]);
  if (allowed && !allowed.includes(actor.role)) throw new ForbiddenException('You do not have permission for this action');
  return true;
 }
}
@Catch()
export class Errors implements ExceptionFilter {
 catch(error: any, host: ArgumentsHost) {
  const res = host.switchToHttp().getResponse();
  let status = error instanceof HttpException ? error.getStatus() : 500;
  let message = error instanceof HttpException ? error.message : 'Could not complete this request';
  if (error.code === '23505') { status=409; message='This record already exists or a payment is already pending'; }
  if (error.code === '23503' || error.code === '23514') { status=400; message='Invalid record or state'; }
  if (status===500) console.error('Request failed', error.code || error.name);
  res.status(status).json({statusCode:status,message});
 }
}
