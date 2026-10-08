import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sandboxConfig,prepareSandbox} from '../publish-sandbox-release.mjs';
import {publishRelease} from '../publish-release.mjs';
import {sha256} from '../prepare-release.mjs';
const env={GITHUB_REF:'refs/heads/develop',GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:'dushimeemma/maison-munezero',GITHUB_RUN_ID:'123',GITHUB_RUN_NUMBER:'9',GITHUB_SHA:'a'.repeat(40),API_BASE_URL:'https://test-api.onrender.com/api/v1',WEB_SITE_URL:'https://test-web.vercel.app',AUTOMATION_RESULT:'success',API_RESULT:'success',WEB_RESULT:'success',ANDROID_RESULT:'success',IOS_RESULT:'success'};
const versions={root:'1.0.0',api:'1.0.0',flutter:'1.0.0'};
test('sandbox gate only accepts successful develop push/manual runs and matching versions',()=>{
 assert.equal(sandboxConfig(env,versions).tag,'v1.0.0-sandbox.9');
 assert.equal(sandboxConfig({...env,GITHUB_EVENT_NAME:'workflow_dispatch'},versions).channel,'sandbox');
 for(const patch of [{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'pull_request'},{API_RESULT:'failure'},{IOS_RESULT:'skipped'},{ANDROID_RESULT:'cancelled'},{GITHUB_SHA:'bad'}])assert.throws(()=>sandboxConfig({...env,...patch},versions));
 assert.throws(()=>sandboxConfig(env,{...versions,flutter:'1.1.0'}));
});
test('sandbox package validates web revision/API and includes review APK and matching checksums',async()=>{
 const root=await mkdtemp(join(tmpdir(),'maison-sandbox-'));
 try{
  await Promise.all(['apps/api','apps/flutter','.vercel/output/static','.vercel/android-review'].map(p=>mkdir(join(root,p),{recursive:true})));
  for(const [p,data] of [['package.json',JSON.stringify({version:'1.0.0'})],['apps/api/package.json',JSON.stringify({version:'1.0.0'})],['apps/flutter/pubspec.yaml','version: 1.0.0+1\n'],['.vercel/output/config.json','{"version":3}'],['.vercel/output/static/index.html','html'],['.vercel/output/static/main.dart.js','js'],['.vercel/output/static/maison-release.json',JSON.stringify({commit:env.GITHUB_SHA,apiBaseUrl:env.API_BASE_URL})],['.vercel/android-review/app-release.apk',Buffer.from([0x50,0x4b,0x03,0x04,1])]])await writeFile(join(root,p),data);
  const prepared=await prepareSandbox({env,root});
  assert.deepEqual(prepared.assets.map(a=>a.name),['maison-munezero-web.zip','maison-android-review.apk','review.json','SHA256SUMS']);
  for(const a of prepared.assets)assert.equal(a.digest,`sha256:${sha256(a.bytes)}`);
  const sums=prepared.assets.at(-1).bytes.toString();for(const a of prepared.assets.slice(0,-1))assert.ok(sums.includes(`${sha256(a.bytes)}  ${a.name}`));
  const retry=await prepareSandbox({env,root});assert.deepEqual(retry.assets.map(a=>a.digest),prepared.assets.map(a=>a.digest));
  await writeFile(join(root,'.vercel/output/static/maison-release.json'),JSON.stringify({commit:'b'.repeat(40),apiBaseUrl:env.API_BASE_URL}));
  await assert.rejects(()=>prepareSandbox({env,root}),/must match/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('sandbox publication remains prerelease, publishes all assets last and never promotes latest',async()=>{
 const manifest=sandboxConfig(env,versions),requests=[],stored=[];let release,ref;
 const assets=['maison-android-review.apk','maison-munezero-web.zip','review.json','SHA256SUMS'].map(name=>{const bytes=Buffer.from(name==='review.json'?`${JSON.stringify(manifest,null,2)}\n`:name);return {name,bytes,contentType:'application/octet-stream',digest:`sha256:${sha256(bytes)}`};});
 const fetchImpl=async(url,options)=>{
  const u=new URL(url),path=decodeURIComponent(u.pathname.replace(`/repos/${env.GITHUB_REPOSITORY}`,'')),method=options.method;requests.push(method);const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
  if(path.startsWith('/git/ref/tags/'))return ref?json(ref):json({},404);
  if(path==='/git/refs'){const body=JSON.parse(options.body);assert.equal(body.sha,env.GITHUB_SHA);ref={object:{type:'commit',sha:body.sha}};return json(ref,201);}
  if(path==='/releases'&&method==='GET')return json(release?[release]:[]);
  if(path==='/releases/generate-notes')return json({body:'notes'});
  if(path==='/releases'&&method==='POST'){const body=JSON.parse(options.body);assert.equal(body.draft,true);assert.equal(body.prerelease,true);assert.equal(body.make_latest,'false');assert.ok(body.body.includes('does not certify'));release={...body,id:1,html_url:'https://github.com/test/release'};return json(release,201);}
  if(path==='/releases/1/assets'&&method==='GET')return json(stored);
  if(path==='/releases/1/assets'&&method==='POST'){assert.equal(release.draft,true);const a={name:u.searchParams.get('name'),size:options.body.length,digest:`sha256:${sha256(options.body)}`,state:'uploaded'};stored.push(a);return json(a,201);}
  if(path==='/releases/1'&&method==='PATCH'){assert.equal(stored.length,4);assert.deepEqual(JSON.parse(options.body),{draft:false,make_latest:'false'});release.draft=false;return json(release);}
  assert.fail(`Unexpected request ${method} ${path}`);
 };
 await publishRelease({manifest,assets,token:'test',fetchImpl});assert.equal(release.prerelease,true);
 requests.length=0;await publishRelease({manifest,assets,token:'test',fetchImpl});assert.ok(requests.every(m=>m==='GET'));
});
