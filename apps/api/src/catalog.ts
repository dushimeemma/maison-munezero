import { Body, Controller, Get, Post, Put, Delete, Param, Query, Req, NotFoundException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Db, one, audit } from './db';
import { Allow, Public, management, sales, parse, uuid, money, text, optionalUrl } from './security';
const productSchema=z.object({name:text(150),description:text(4000),category:text(80),price:money,imageUrl:optionalUrl,active:z.boolean().default(true),featured:z.boolean().default(false),variants:z.array(z.object({id:uuid.optional(),sku:text(80),size:text(30),color:text(40),stock:z.number().int().min(0).max(100000)}).strict()).min(1).max(100)}).strict();
@Controller()
export class CatalogController {
 constructor(private db:Db){}
 @Get('categories') @Public() async categories(){return (await this.db.query('SELECT DISTINCT category FROM products WHERE active ORDER BY category')).rows.map(p=>p.category);}
 @Get('settings') @Public() async settings(){return (await one(this.db,'SELECT data FROM settings WHERE id=1')).data;}
 @Put('settings') @Allow(...management) async saveSettings(@Req() r:any,@Body() body:any){
  const d=parse(z.object({brandName:text(100),currency:z.literal('RWF'),deliveryZones:z.array(z.object({id:text(30),name:text(100),fee:z.number().int().min(0).max(1000000)}).strict()).max(50),depositPercent:z.number().int().min(1).max(100),taxBasisPoints:z.number().int().min(0).max(10000),shopAddress:text(500),shopPhone:z.string().max(30),shopEmail:z.union([z.literal(''),z.string().email()]),instagram:optionalUrl,returnsDays:z.number().int().min(0).max(90),appointmentMinutes:z.number().int().min(15).max(240),sampleCatalogue:z.boolean(),terms:text(10000)}).strict(),body);
  if(new Set(d.deliveryZones.map(v=>v.id)).size!==d.deliveryZones.length)throw new BadRequestException('Delivery zone IDs must be unique');
  return this.db.tx(async sql=>{await sql.query('UPDATE settings SET data=$1 WHERE id=1',[JSON.stringify(d)]);await audit(sql,r.actor.id,'SETTINGS_UPDATED',null);return d;});
 }
 @Get('products') @Public() async products(@Query() q:any){
  const search=typeof q.q==='string'?q.q.slice(0,100):'';
  const category=typeof q.category==='string'?q.category.slice(0,80):'';
  return (await this.db.query(`SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'size',v.size,'color',v.color,'stock',v.stock)) FILTER(WHERE v.id IS NOT NULL),'[]') variants
   FROM products p LEFT JOIN variants v ON v.product_id=p.id WHERE p.active AND (p.name ILIKE $1 OR p.description ILIKE $1) AND ($2='' OR p.category=$2)
   GROUP BY p.id ORDER BY p.featured DESC,p.created_at DESC LIMIT 200`,[`%${search}%`,category])).rows;
 }
 @Get('admin/products') @Allow(...sales) async allProducts(){return (await this.db.query(`SELECT p.*,COALESCE(jsonb_agg(v) FILTER(WHERE v.id IS NOT NULL),'[]') variants FROM products p LEFT JOIN variants v ON v.product_id=p.id GROUP BY p.id ORDER BY p.created_at DESC LIMIT 500`)).rows;}
 @Get('products/:id') @Public() async product(@Param('id') id:string){const p=await one(this.db,'SELECT * FROM products WHERE id=$1 AND active',[parse(uuid,id)]);if(!p)throw new NotFoundException();return {...p,variants:(await this.db.query('SELECT * FROM variants WHERE product_id=$1 ORDER BY size,color',[id])).rows};}
 @Post('products') @Allow(...management) create(@Req() r:any,@Body() body:any){return this.write(r,undefined,body);}
 @Put('products/:id') @Allow(...management) update(@Req() r:any,@Param('id') id:string,@Body() body:any){return this.write(r,parse(uuid,id),body);}
 async write(r:any,id:string|undefined,body:any){
  const d=parse(productSchema,body);
  if(new Set(d.variants.map(v=>`${v.size}:${v.color}`)).size!==d.variants.length)throw new BadRequestException('Duplicate size and color');
  return this.db.tx(async sql=>{
   if(id && !(await one(sql,'SELECT id FROM products WHERE id=$1 FOR UPDATE',[id])))throw new NotFoundException();
   const p=id?await one(sql,`UPDATE products SET name=$2,description=$3,category=$4,price=$5,image_url=$6,active=$7,featured=$8,updated_at=now() WHERE id=$1 RETURNING *`,[id,d.name,d.description,d.category,d.price,d.imageUrl||null,d.active,d.featured])
    :await one(sql,`INSERT INTO products(name,description,category,price,image_url,active,featured) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[d.name,d.description,d.category,d.price,d.imageUrl||null,d.active,d.featured]);
   const existing=(await sql.query('SELECT id FROM variants WHERE product_id=$1',[p.id])).rows;
   if(existing.some(v=>!d.variants.some(x=>x.id===v.id)))throw new BadRequestException('Keep existing variants. Adjust stock to zero to stop selling a variant.');
   for(const v of d.variants){
    if(v.id){
     const old=await one(sql,'SELECT * FROM variants WHERE id=$1 AND product_id=$2 FOR UPDATE',[v.id,p.id]);if(!old)throw new BadRequestException('Unknown variant');
     // Stock is changed separately with a reason, so editing a product cannot overwrite a concurrent sale.
     await sql.query('UPDATE variants SET sku=$2,size=$3,color=$4 WHERE id=$1',[v.id,v.sku,v.size,v.color]);
    }else{
     const added=await one(sql,'INSERT INTO variants(product_id,sku,size,color,stock) VALUES($1,$2,$3,$4,$5) RETURNING id',[p.id,v.sku,v.size,v.color,v.stock]);
     if(v.stock)await sql.query('INSERT INTO stock_moves(variant_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)',[added.id,v.stock,'Opening stock',r.actor.id]);
    }
   }
   await audit(sql,r.actor.id,id?'PRODUCT_UPDATED':'PRODUCT_CREATED',p.id);return p;
  });
 }
 @Post('inventory/adjust') @Allow(...management) async stock(@Req() r:any,@Body() body:any){
  const d=parse(z.object({variantId:uuid,delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0),reason:text(500)}).strict(),body);
  return this.db.tx(async sql=>{const v=await one(sql,'UPDATE variants SET stock=stock+$2 WHERE id=$1 AND stock+$2>=0 RETURNING *',[d.variantId,d.delta]);if(!v)throw new BadRequestException('Insufficient stock or unknown variant');await sql.query('INSERT INTO stock_moves(variant_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)',[d.variantId,d.delta,d.reason,r.actor.id]);await audit(sql,r.actor.id,'STOCK_ADJUSTED',v.id,{delta:d.delta,reason:d.reason});return v;});
 }
 @Get('inventory/movements') @Allow(...management) inventory(){return this.db.query('SELECT m.*,v.sku FROM stock_moves m JOIN variants v ON v.id=m.variant_id ORDER BY m.created_at DESC LIMIT 300').then(r=>r.rows);}
 @Get('wishlist') async wishlist(@Req() r:any){return this.db.query('SELECT p.* FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=$1 AND p.active',[r.actor.id]).then(r=>r.rows);}
 @Post('wishlist/:id') async wish(@Req() r:any,@Param('id') id:string){await this.db.query('INSERT INTO wishlist(user_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.actor.id,parse(uuid,id)]);return {ok:true};}
 @Delete('wishlist/:id') async unwish(@Req() r:any,@Param('id') id:string){await this.db.query('DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2',[r.actor.id,parse(uuid,id)]);return {ok:true};}
}
