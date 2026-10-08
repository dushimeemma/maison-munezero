import {execFileSync} from 'node:child_process';
import {appendFile,mkdir,readFile,readdir,rm,utimes} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiBase,revision,website} from './ci-config.mjs';
import {sha256} from './prepare-release.mjs';
import {publishRelease} from './publish-release.mjs';

export function sandboxConfig(env,versions){
 if(env.GITHUB_REF!=='refs/heads/develop'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||
   ['AUTOMATION_RESULT','API_RESULT','WEB_RESULT','ANDROID_RESULT','IOS_RESULT'].some(key=>env[key]!=='success')){
  throw new Error('Sandbox releases require all five CI checks to succeed on develop');
 }
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY||'')||
   !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER||''))throw new Error('Invalid workflow identity');
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versions.root)||versions.api!==versions.root||versions.flutter!==versions.root)throw new Error('Application versions must match');
 return {channel:'sandbox',tag:`v${versions.root}-sandbox.${env.GITHUB_RUN_NUMBER}`,version:versions.root,
  commit:revision(env.GITHUB_SHA),repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,
  runUrl:`https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  api:{url:apiBase(env.API_BASE_URL)},web:{url:website(env.WEB_SITE_URL)},
  android:{signing:'review-only',apiBaseUrl:apiBase(env.API_BASE_URL)}};
}
export async function prepareSandbox({env,root}){
 const [pkg,api,pubspec]=await Promise.all([readFile(join(root,'package.json'),'utf8'),readFile(join(root,'apps/api/package.json'),'utf8'),readFile(join(root,'apps/flutter/pubspec.yaml'),'utf8')]);
 const manifest=sandboxConfig(env,{root:JSON.parse(pkg).version,api:JSON.parse(api).version,flutter:/^version:\s*(\d+\.\d+\.\d+)\+[1-9]\d*\s*$/m.exec(pubspec)?.[1]});
 const web=join(root,'.vercel/output'),output=join(root,'.vercel/sandbox-release');
 const metadata=JSON.parse(await readFile(join(web,'static/maison-release.json'),'utf8'));
 if(metadata.commit!==manifest.commit||metadata.apiBaseUrl!==manifest.api.url||JSON.parse(await readFile(join(web,'config.json'),'utf8')).version!==3)throw new Error('Web artifact must match this CI commit and sandbox API');
 await Promise.all(['static/index.html','static/main.dart.js'].map(path=>readFile(join(web,path))));
 const entries=[];
 async function collect(directory=''){
  const children=await readdir(join(web,directory),{withFileTypes:true});children.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const entry of children){const path=join(directory,entry.name);
   if(entry.isDirectory())await collect(path);
   else if(entry.isFile()){await utimes(join(web,path),new Date('1980-01-01T00:00:00Z'),new Date('1980-01-01T00:00:00Z'));entries.push(path);}
   else throw new Error('Web bundle must contain regular files only');
  }
 }
 await collect();await mkdir(output,{recursive:true});const zip=resolve(output,'maison-munezero-web.zip');await rm(zip,{force:true});
 execFileSync('zip',['-X','-q',zip,...entries],{cwd:web,env:{...process.env,TZ:'UTC'},timeout:60000});
 const apk=await readFile(join(root,'.vercel/android-review/app-release.apk'));
 if(apk.length<4||apk.readUInt32LE(0)!==0x04034b50)throw new Error('Missing or invalid review APK');
 const assets=[{name:'maison-munezero-web.zip',contentType:'application/zip',bytes:await readFile(zip)},
  {name:'maison-android-review.apk',contentType:'application/vnd.android.package-archive',bytes:apk},
  {name:'review.json',contentType:'application/json',bytes:Buffer.from(`${JSON.stringify(manifest,null,2)}\n`)}];
 assets.push({name:'SHA256SUMS',contentType:'text/plain',bytes:Buffer.from(assets.map(a=>`${sha256(a.bytes)}  ${a.name}`).join('\n')+'\n')});
 return {manifest,assets:assets.map(a=>({...a,digest:`sha256:${sha256(a.bytes)}`}))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const prepared=await prepareSandbox({env:process.env,root:fileURLToPath(new URL('../',import.meta.url))});
 const result=await publishRelease({...prepared,token:process.env.GITHUB_TOKEN});
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`Sandbox prerelease: [${result.tag}](${result.url}) — ${result.commit}\n`);
 console.log(`Published sandbox prerelease: ${result.tag}`);
}
