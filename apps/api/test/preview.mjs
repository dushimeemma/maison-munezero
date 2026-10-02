// Local UI verification only. No MoMo simulation or SMTP delivery is enabled.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import express from 'express';
import bcrypt from 'bcryptjs';
import module from '../dist/app.js';
import dbModule from '../dist/db.js';
if(process.env.NODE_ENV==='production')throw new Error('Local preview is not a production database');
if(!process.env.DEMO_PASSWORD||process.env.DEMO_PASSWORD.length<12)throw new Error('Set DEMO_PASSWORD (12+ characters) for local preview');
process.env.WORKERS_DISABLED='true';
const engine=new PGlite();await engine.exec(readFileSync('migrations/001_initial.sql','utf8'));
const db={query:(q,p=[])=>engine.query(q,p),tx:fn=>engine.transaction(tx=>fn({query:(q,p=[])=>tx.query(q,p)}))};
await db.query("INSERT INTO users(email,name,phone,password_hash,role) VALUES($1,'Maison Preview Admin','250780000000',$2,'SUPER_ADMIN')",[process.env.DEMO_EMAIL||'preview@maison.example',await bcrypt.hash(process.env.DEMO_PASSWORD,12)]);
const pieces=[['The Imigongo Dress','Dresses',85000,'Terracotta'],['Atelier Tailored Set','Sets',120000,'Olive'],['Signature Occasion Dress','Occasion',160000,'Ivory'],['Everyday Linen Shirt','Essentials',45000,'Sand']];
for(let i=0;i<pieces.length;i++){const [name,category,price,color]=pieces[i];const p=(await db.query('INSERT INTO products(name,description,category,price,featured) VALUES($1,$2,$3,$4,true) RETURNING id',[name,'Sample product for preview. Replace with the real Maison Munezero catalogue.',category,price])).rows[0];for(const size of ['S','M','L','XL'])await db.query('INSERT INTO variants(product_id,sku,size,color,stock) VALUES($1,$2,$3,$4,8)',[p.id,`PREVIEW-${i}-${size}`,size,color]);}
const compiled=await Test.createTestingModule({imports:[module.AppModule]}).overrideProvider(dbModule.Db).useValue(db).compile();const app=compiled.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');
const web=resolve('../flutter/build/web');app.use(express.static(web));app.use((req,res,next)=>{if(req.url.startsWith('/api/'))return next();res.sendFile(resolve(web,'index.html'));});
await app.listen(Number(process.env.DEMO_PORT||8080),'0.0.0.0');console.log('Local preview listening at http://localhost:8080. Data is temporary.');
async function stop(){await app.close();await engine.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
