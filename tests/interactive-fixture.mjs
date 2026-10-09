// SPDX-License-Identifier: AGPL-3.0-only
// Only for owned synthetic R43 fixtures and CI. These images are NOT customer
// capture and never earn canonical Driver Host acceptance.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { baseline, captureInput } from './helpers.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fill(png,x,y,w,h,color){
  for(let b=y;b<Math.min(png.height,y+h);b++){
    for(let a=x;a<Math.min(png.width,x+w);a++){
      const i=(b*png.width+a)*4;
      png.data[i]=color[0];png.data[i+1]=color[1];
      png.data[i+2]=color[2];png.data[i+3]=255;
    }
  }
}
function ownedPixels(index,width,height){
  const p=new PNG({width,height,filterType:0});
  fill(p,0,0,width,height,[15,31,48]);
  fill(p,0,0,width,48,[35,57,76]);
  fill(p,0,48,150,height-48,[23,43,61]);
  fill(p,175,74,width-200,118,[36,61,78]);
  fill(p,175,208,width-200,104,[27,52,72]);
  fill(p,199,104,Math.floor((width-252)*(index+1)/3),14,[58,207,189]);
  fill(p,199,142,Math.floor((width-252)*(index+1)/4),10,[171,202,216]);
  fill(p,199,252,width-258,10,[102,146,165]);
  fill(p,199,276,Math.floor((width-258)*(index+1)/3),9,[76,176,173]);
  // Distinct synthetic visuals, not copied from an existing real product.
  return PNG.sync.write(p,{colorType:6,inputColorType:6});
}
const interval=(a,b)=>({start:{num:String(a),den:'1'},end:{num:String(b),den:'1'}});
export async function makeOwnedInteractiveFixture(parentRoot,{
  maliciousLabel=false,framesCount=2,width=640,height=360
}={}){
  const localRoot=join(parentRoot,'owned-fixture');
  mkdirSync(localRoot,{recursive:true,mode:0o700});
  const screenshotDir=join(localRoot,'frames');
  mkdirSync(screenshotDir,{mode:0o700});
  const app=new LaunchwrightApplication(join(localRoot,'workspace'),{initialize:true});
  const b=await baseline(app);
  const source=(await execute(app,'entity.update',{
    id:b.source.id,expected:b.source.version,
    data:{...b.source.data,approval:'approved',
      purpose:'Operator-approved synthetic Media fixture only'}
  })).entity;
  const scenario=await b.create('scenario',{
    release_id:b.release.id,name:'Offline fixture state walkthrough',
    source_id:source.id,target_id:b.target.id,
    steps:[{action:'navigate',anchor:'root'},{action:'assert',anchor:'root'}],
    anchors:[{name:'root',role:'main',label:'Owned synthetic source',expected_count:1}],
    readiness:'declared',version_label:'r43',reset_strategy:'isolated-context',effects:[]
  });
  const shots=[],frames=[];
  for(let i=0;i<framesCount;i++){
    const capture=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
      name:'Synthetic captured state '+(i+1)
    }))).entity;
    const sanitized=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
      name:'Operator-declared sanitized derivative '+(i+1),
      classification:'sanitized',
      provenance:{
        capture_class:'SANITIZED_DERIVATIVE',synthetic:true,
        parent_evidence_id:capture.id,
        transformations:[{
          kind:'REDACT',operation_ref:'operator-owned-pixel-review-'+(i+1),
          semantic_effect:'preserves-observed-state'
        }]
      }
    }))).entity;
    const shotId='state_'+(i+1);
    shots.push({
      id:shotId,name:'Owned synthetic state '+(i+1),
      capture_evidence_id:capture.id,interactive_evidence_id:sanitized.id,
      claim_ids:[],interval:interval(i*4,(i+1)*4),
      purpose:'illustrative',transform_refs:['synthetic-owned-pixel-review']
    });
    const bytes=ownedPixels(i,width,height);
    const path=join(screenshotDir,'frame-'+(i+1)+'.png');
    writeFileSync(path,bytes,{flag:'wx',mode:0o600});
    frames.push({
      shot_id:shotId,source_evidence_id:sanitized.id,
      label:maliciousLabel&&i===0?'<img src=x onerror=alert(1)>':'Owned state '+(i+1),
      alt:'Synthetic visual representation '+(i+1)+' of the operator-owned fixture',
      png_path:path,png_sha256:hash(bytes)
    });
  }
  const variants=['video','screenshot-series','interactive-demo'].map((kind,index)=>({
    id:['video_1','screens_1','offline_1'][index],kind,
    locale:'en-US',width,height,
    safe_area_milli:{top:20,right:20,bottom:20,left:20},
    shot_ids:shots.map(x=>x.id),track_ids:[]
  }));
  const plan=(await execute(app,'media.plan',{
    release_id:b.release.id,target_id:b.target.id,scenario_id:scenario.id,
    name:'Exact synthetic Media walkthrough',
    backend:{profile:'motion-canvas',fidelity:'exact',losses:[],unsupported:[]},
    frame_rate:{num:30,den:1},
    duration:{num:String(framesCount*4),den:'1'},
    shots,assets:[],tracks:[],variants,
    interactive_policy:{
      sanitized_only:true,productive_auth:false,
      active_source_scripts:false,external_links:[]
    }
  })).entity;
  const input={
    media_plan_id:plan.id,variant_id:'offline_1',
    source_rights:'owned',acknowledge_private_only:true,
    acknowledge_pixel_privacy:true,frames
  };
  return{app,b,source,scenario,plan,frames,input,localRoot,
    close(){app.close();},
    cleanup(){app.close();rmSync(localRoot,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
  };
}
