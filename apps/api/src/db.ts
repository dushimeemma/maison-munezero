import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
export interface Sql { query<T = any>(text: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }> }
@Injectable()
export class Db implements Sql, OnModuleDestroy {
  pool: Pool;
  constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 15,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    this.pool.on('error', () => console.error('Database connection failed'));
  }
  query<T = any>(text: string, values: any[] = []) { return this.pool.query<T & Record<string, any>>(text, values); }
  async tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
export async function one(sql: Sql, query: string, values: any[] = []) { return (await sql.query(query, values)).rows[0]; }
export async function audit(sql: Sql, actor: string | null, action: string, entity: string | null, details: any = {}) {
  await sql.query('INSERT INTO audit(actor_id,action,entity_id,details) VALUES($1,$2,$3,$4)', [actor, action, entity, JSON.stringify(details)]);
}
export async function notify(sql: Sql, user: string | null, title: string, body: string, options: { orderId?: string; email?: boolean } = {}) {
  if (!user) return;
  await sql.query('INSERT INTO notifications(user_id,title,body,order_id) VALUES($1,$2,$3,$4)', [user, title, body, options.orderId || null]);
  if (options.email !== false) await sql.query('INSERT INTO outbox(user_id,subject,body) VALUES($1,$2,$3)', [user, title, body]);
}

// Staff fan-out is in-app only; existing customer emails keep their current behavior.
export async function notifyRoles(sql: Sql, roles: string[], actor: string | null, title: string, body: string, orderId?: string) {
  const users = (await sql.query('SELECT id FROM users WHERE active AND role=ANY($1::text[]) AND ($2::uuid IS NULL OR id<>$2)', [roles, actor])).rows;
  for (const user of users) await notify(sql, user.id, title, body, {orderId, email:false});
}
export async function notifyOrderTeam(sql: Sql, orderId: string, actor: string | null, title: string, body: string) {
  const users = (await sql.query(`SELECT DISTINCT u.id FROM users u WHERE u.active AND
    (u.role IN ('SUPER_ADMIN','MANAGER','SALES') OR
     EXISTS(SELECT 1 FROM bespoke b WHERE b.order_id=$1 AND ((b.designer_id=u.id AND u.role='DESIGNER') OR (b.tailor_id=u.id AND u.role='TAILOR'))) OR
     EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=$1 AND d.driver_id=u.id AND u.role='DRIVER'))
    AND ($2::uuid IS NULL OR u.id<>$2)`, [orderId, actor])).rows;
  for (const user of users) await notify(sql, user.id, title, body, {orderId, email:false});
}
