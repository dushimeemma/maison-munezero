import 'dotenv/config';
import { hash } from 'bcryptjs';
import { Db,one } from './db';
async function run(){
 const db=new Db();try{
  if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters).');
  const pass=await hash(process.env.ADMIN_PASSWORD,12);
  await db.tx(async sql=>{
   await sql.query(`INSERT INTO users(email,name,phone,password_hash,role) VALUES($1,'Maison Munezero Admin','250780000000',$2,'SUPER_ADMIN') ON CONFLICT(email) DO NOTHING`,[process.env.ADMIN_EMAIL!.toLowerCase(),pass]);
   if(process.env.SEED_SAMPLE_DATA!=='true')return;
   const products=[['The Imigongo Dress','An expressive silhouette for evenings and celebrations. Sample product: replace with the real catalogue.','Dresses',85000,'IMI','Terracotta'],['Atelier Tailored Set','A considered two-piece with a relaxed, modern cut. Sample product.','Sets',120000,'ATL','Olive'],['Signature Occasion Dress','A graceful occasion piece with sculptural details. Sample product.','Occasion',160000,'SIG','Ivory'],['Everyday Linen Shirt','An airy essential designed for everyday movement. Sample product.','Essentials',45000,'LIN','Sand']];
   for(const [name,description,category,price,code,color] of products){if(await one(sql,'SELECT id FROM variants WHERE sku=$1',[`${code}-M`]))continue;const p=await one(sql,'INSERT INTO products(name,description,category,price,featured) VALUES($1,$2,$3,$4,true) RETURNING id',[name,description,category,price]);for(const size of ['S','M','L','XL'])await sql.query('INSERT INTO variants(product_id,sku,size,color,stock) VALUES($1,$2,$3,$4,8)',[p.id,`${code}-${size}`,size,color]);}
  });console.log('Seed complete. Existing credentials were not overwritten.');
 }finally{await db.onModuleDestroy();}
}
void run();
