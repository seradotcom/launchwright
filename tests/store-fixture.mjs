// SPDX-License-Identifier: AGPL-3.0-only
// R44 owned disposable mobile-store listing fixture; these are synthetic
// design-state pixels, NOT screenshots from any real Android/iOS device.
import { mkdirSync,writeFileSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
function syntheticImage(width,height,index,{transparent=false}={}){
  const png=new PNG({width,height});
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const k=(y*width+x)*4;
      const light=(x>width/5 && x<width*4/5 && y>height/5 && y<height*4/5);
      png.data[k]=light?48+index*20:22;
      png.data[k+1]=light?120+index*12:43;
      png.data[k+2]=light?138+index*16:63;
      png.data[k+3]=transparent&&x<width/10?0:255;
    }
  }
  return PNG.sync.write(png,{colorType:6,inputColorType:6});
}
export async function makeOwnedStoreFixture(parentRoot,{
  platform='apple-iphone-dynamic-island-medium',
  screenshotCount=2,transparentScreen=false
}={}){
  const apple=platform==='apple-iphone-dynamic-island-medium';
  const x=await makeOwnedInteractiveFixture(parentRoot,{
    framesCount:screenshotCount,width:640,height:360
  });
  const dir=join(parentRoot,'store-pixels');
  mkdirSync(dir,{recursive:true,mode:0o700});
  if(process.platform!=='win32')chmodSync(dir,0o700);
  const write=(name,width,height,index,flags)=>{
    const path=join(dir,name);
    const image=syntheticImage(width,height,index,flags);
    writeFileSync(path,image,{flag:'wx',mode:0o600});
    return{path,sha256:hash(image)};
  };
  const [width,height]=apple?[1179,2556]:[1080,1920];
  const screenshots=x.frames.map((f,i)=>({
    source_evidence_id:f.source_evidence_id,
    png:write('screenshot-'+String(i+1)+'.png',width,height,i+1,{
      transparent:transparentScreen&&i===0
    }),
    alt:'Synthetic UI state '+(i+1)+' presented for private store review'
  }));
  const graphics=apple?{icon:null,feature:null}:{
    icon:write('store-icon.png',512,512,4,{transparent:true}),
    feature:write('feature-graphic.png',1024,500,5)
  };
  const channel=(await execute(x.app,'entity.create',{kind:'channel_profile',data:{
    product_id:x.b.product.id,
    name:apple?'Apple iPhone store assets':'Google Play phone store assets',
    channel:apple?'app-store-connect-draft':'google-play-draft',
    profile_version:'official-snapshot-2026-10-09',
    destination_class:'external-draft',
    requirements:{format:'png',device:apple?
      'iphone-dynamic-island-medium':'phone-portrait'},
    source:apple?'store-listing:apple':'store-listing:google-play',
    effective_at:'2026-10-09T00:00:00.000Z',
    idempotency:'recover-first'
  }})).entity;
  const artifact=(await execute(x.app,'deliverable.render',{id:x.b.deliverable.id})).entity;
  const candidate=(await execute(x.app,'candidate.freeze',{
    release_id:x.b.release.id,name:'Synthetic store media review',
    artifact_ids:[artifact.id],destination:'owned-store-review',
    channel_profile_ids:[channel.id],
    contract:{version:'r44',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(x.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',
    comment:'Operator-reviewed synthetic listing only'
  });
  const input={
    platform,release_id:x.b.release.id,target_id:x.b.target.id,
    candidate_id:candidate.id,channel_profile_id:channel.id,locale:'en-US',
    metadata:{
      name:'Owned Synthetic Product',
      summary:'A clear, source-bound demo',
      description:'Local operator-owned fixture. No customer acceptance.',
      keywords:apple?'demo,release': '',
      support_url:'https://example.invalid/support',
      privacy_policy_url:'https://example.invalid/privacy'
    },
    source_rights:'owned',screenshots,graphics,
    acknowledge_private_only:true,
    acknowledge_source_rights:true,
    acknowledge_pixel_privacy:true
  };
  return{...x,platform,channel,candidate,artifact,input,
    storeWidth:width,storeHeight:height,storeDir:dir};
}
