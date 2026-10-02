import { Controller,Post,UploadedFile,UseInterceptors,BadRequestException,ServiceUnavailableException,Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { Allow,management } from './security';
import { Db,audit } from './db';
@Controller('media')
export class MediaController {
 constructor(private db:Db){}
 @Post('upload') @Allow(...management,'DESIGNER','CUSTOMER')
 @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1}}))
 async upload(@UploadedFile() file:any,@Req() req:any){
  if(!file?.buffer)throw new BadRequestException('Select an image');
  const b:Buffer=file.buffer;
  const jpeg=b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
  const png=b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=b.length>12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
  if(!jpeg&&!png&&!webp)throw new BadRequestException('Upload a JPEG, PNG or WebP image, up to 5 MB');
  const cloud=process.env.CLOUDINARY_CLOUD_NAME,key=process.env.CLOUDINARY_API_KEY,secret=process.env.CLOUDINARY_API_SECRET;
  if(!cloud||!key||!secret||!/^\w+$/.test(cloud))throw new ServiceUnavailableException('Image uploads are not configured. You can use a hosted image link.');
  const timestamp=Math.floor(Date.now()/1000),folder='maison-munezero';
  const signature=createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');
  const form=new FormData();form.set('file',new Blob([new Uint8Array(b)],{type:jpeg?'image/jpeg':png?'image/png':'image/webp'}),jpeg?'image.jpg':png?'image.png':'image.webp');form.set('api_key',key);form.set('timestamp',String(timestamp));form.set('folder',folder);form.set('signature',signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`,{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new ServiceUnavailableException('Image upload failed');const result:any=await response.json();await audit(this.db,req.actor.id,'MEDIA_UPLOADED',null,{publicId:result.public_id});return {url:result.secure_url};
 }
}
