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
export async function notify(sql: Sql, user: string | null, title: string, body: string) {
  if (!user) return;
  await sql.query('INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)', [user, title, body]);
  await sql.query('INSERT INTO outbox(user_id,subject,body) VALUES($1,$2,$3)', [user, title, body]);
}
