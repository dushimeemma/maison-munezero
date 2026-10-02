import 'dotenv/config';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from './db';
async function run(){const db=new Db();try{await db.tx(async sql=>{await sql.query('SELECT pg_advisory_xact_lock(947371)');await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');for(const name of readdirSync(resolve('migrations')).filter(f=>f.endsWith('.sql')).sort()){if((await sql.query('SELECT name FROM schema_migrations WHERE name=$1',[name])).rows.length)continue;await sql.query(readFileSync(resolve('migrations',name),'utf8'));await sql.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);console.log(`Applied ${name}`);}});}finally{await db.onModuleDestroy();}}
void run();
