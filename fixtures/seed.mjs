// SPDX-License-Identifier: AGPL-3.0-only
import { execute } from '../src/application.mjs';
export async function seedDemo(app){
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'DeltaDesk — synthetic lab',description:'Owned demonstration dataset. No accounts, email or payments. Not a native execution receipt.'});
  const releases=[];
  for(const build of ['A','B']){
    const release=await create('release',{product_id:product.id,name:`DeltaDesk ${build==='A'?'1.0 LTS':'1.1 preview'}`,build:`deltadesk-${build}-fixture-v1`,status:build==='A'?'lts':'draft',notes:build==='A'?'Historical build A stays pinned.':'Build B changes checkout placement and advanced export plan/role eligibility. An external resource remains unobserved.'});releases.push(release);
    const source=await create('source',{product_id:product.id,name:`DeltaDesk web build ${build}`,type:'web',locator:`http://127.0.0.1:4320/build/${build}`,build:release.data.build,coverage:'declared'});
    for(const language of ['en-US','es-MX']){
      const target=await create('target',{release_id:release.id,name:`${language} · basic viewer`,ui_locale:language,editorial_locale:language,audio_locale:language,role:'viewer',plan:'basic',region:'MX',flags:{advanced_export:true},viewport:{width:1440,height:900,scale_milli:1000}});
      await create('scenario',{release_id:release.id,name:`Checkout ${language}`,source_id:source.id,target_id:target.id,steps:[{action:'navigate',anchor:'checkout'},{action:'assert',anchor:'checkout-title'}],anchors:[{name:'checkout-title',role:'heading',label:language==='es-MX'?'Tu plan':'Your plan',expected_count:1}],readiness:'needs-validation'});
      const deliverable=await create('deliverable',{release_id:release.id,name:language==='es-MX'?'Notas de versión':'Release notes',target_id:target.id,format:'markdown',content:language==='es-MX'?`Borrador editorial del build ${build}.\n\nLa elegibilidad de exportación avanzada requiere evidencia por plan y rol. Este texto no prueba disponibilidad.`:`Editorial draft for build ${build}.\n\nAdvanced export eligibility requires evidence per plan and role. This text is not proof of availability.`,claim_ids:[],source_ids:[source.id]});
      const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
      await create('binding',{release_id:release.id,name:language==='es-MX'?'Documentación':'Documentation',mode:build==='A'?'lts':'rolling',deliverable_id:deliverable.id,...(build==='A'?{pinned_artifact_id:artifact.id}:{})});
    }
  }
  const second=await create('product',{name:'GridNote — second synthetic product',description:'A distinct tabular editor fixture. Not a renamed DeltaDesk schema.'});
  await create('template',{product_id:second.id,name:'GridNote release brief',format:'markdown',content:'# {{title}}\n\n{{summary}}\n\nEvidence boundaries must be retained.',parameters:['title','summary']});
  return{synthetic:true,product:product.id,release_ids:releases.map(r=>r.id),second_product:second.id,native_capture_executed:false,media_render_executed:false};
}
