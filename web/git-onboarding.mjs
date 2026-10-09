// SPDX-License-Identifier: AGPL-3.0-only
// R37: one-browser-session, local owner-controlled Git onboarding.
// No observation, private filename, source path or plan is persisted to localStorage.
export const MAX_GIT_OBSERVATION_UPLOAD_BYTES=240*1024;
export const MAX_GIT_PLAN_UPLOAD_BYTES=32*1024;
const html=value=>String(value??'').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
function readJson(text,max,label){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>max)
    throw Error(label+' is too large or not readable text');
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error(label+' is not valid JSON');}
  if(!isObj(parsed))throw Error(label+' must be a JSON object');
  return parsed;
}
function sha(value,len){return typeof value==='string'&&new RegExp('^[a-f0-9]{'+len+'}$').test(value);}
export function createGitOnboardingController(client){
  let observation=null,plan=null,result=null,observationName='';
  const loaded=()=>!!observation;
  const planned=()=>!!plan;
  return {
    loaded,planned,
    defaults(){
      if(!observation)throw Error('Select an R32 observation first');
      const alias=String(observation.source_alias??'Git project').replaceAll('_',' ').slice(0,60);
      const suffix=typeof observation.head_sha==='string'?observation.head_sha.slice(0,8):'commit';
      return{
        product_name:alias,release_name:'Review '+suffix,
        source_name:'Approved Git metadata',target_name:'Desktop reviewer',
        notes_title:'Changes to review',source_purpose:'Operator-approved committed Git metadata only',
        locale:'en-US',role:'reviewer',plan:'local',region:'MX',rights:''
      };
    },
    uploadObservation(text,name=''){
      observation=null;plan=null;result=null;observationName='';
      const parsed=readJson(text,MAX_GIT_OBSERVATION_UPLOAD_BYTES,'Git observation');
      if(!sha(parsed.observation_sha256,64)||!sha(parsed.base_sha,40)||
        !sha(parsed.head_sha,40)||typeof parsed.source_alias!=='string'||
        !Array.isArray(parsed.changed_paths))
        throw Error('Expected an exact R32 Git metadata observation');
      observation=parsed;observationName=String(name).slice(0,128);
      plan=null;result=null;
      return{source_alias:parsed.source_alias,observation_sha256:parsed.observation_sha256};
    },
    async prepare(config){
      if(!observation)throw Error('Select a private Git observation first');
      const prepared=await client.planLocalGitBootstrap(observation,config);
      if(!isObj(prepared?.plan)||!sha(prepared.plan.plan_sha256,64)||
        prepared.workspace_mutated!==false||prepared.external_send_performed!==false)
        throw Error('Local owner bootstrap plan reply does not meet the no-effects contract');
      plan=prepared.plan;result=null;
      return prepared;
    },
    async loadSavedPlan(text){
      if(!observation)throw Error('Select the matching Git observation first');
      const saved=readJson(text,MAX_GIT_PLAN_UPLOAD_BYTES,'Saved bootstrap plan');
      if(!sha(saved.plan_sha256,64)||!isObj(saved.config))
        throw Error('Saved Git bootstrap plan is incomplete');
      const prepared=await client.planLocalGitBootstrap(observation,saved.config);
      if(JSON.stringify(prepared.plan)!==JSON.stringify(saved))
        throw Error('Saved plan does not match the exact current observation and options');
      plan=prepared.plan;result=null;
      return prepared;
    },
    downloadPlan(){
      if(!plan)throw Error('Prepare or load an exact plan before downloading');
      return JSON.stringify(plan,null,2)+'\n';
    },
    async apply(confirmations){
      if(!plan||!observation)throw Error('Load the exact Git observation and plan first');
      if(!isObj(confirmations))throw Error('All independent operator confirmations are required');
      const applied=await client.applyLocalGitBootstrap(observation,plan,confirmations);
      if(!isObj(applied)||applied.plan_sha256!==plan.plan_sha256||
        applied.imported_evidence_state!=='UNKNOWN'||
        applied.platform_authority!==false||
        applied.external_mutation_performed!==false||
        applied.project_graph_authority!==false||
        applied.publication_authority!==false)
        throw Error('Onboarding reply did not retain the imported/UNKNOWN authority boundary');
      result=applied;
      return applied;
    },
    clear(){observation=null;plan=null;result=null;observationName='';},
    summary(){
      return{
        has_observation:!!observation,has_plan:!!plan,has_result:!!result,
        observation_sha256:observation?.observation_sha256??null,
        plan_sha256:plan?.plan_sha256??null,
        imported_evidence_state:result?.imported_evidence_state??'UNKNOWN',
        publication_authority:false
      };
    },
    render(){
      const files=observation?
        '<dl class="fact-list"><div><dt>Source alias</dt><dd>'+html(observation.source_alias)+'</dd></div>'+
        '<div><dt>Selected file</dt><dd>'+html(observationName)+'</dd></div>'+
        '<div><dt>Base commit</dt><dd><code>'+html(observation.base_sha)+'</code></dd></div>'+
        '<div><dt>Head commit</dt><dd><code>'+html(observation.head_sha)+'</code></dd></div>'+
        '<div><dt>Changed files</dt><dd>'+html(observation.changed_files)+'</dd></div>'+
        '<div><dt>Source observation</dt><dd><code>'+html(observation.observation_sha256)+'</code></dd></div></dl>':
        '<p class="muted">No observation chosen. Source filenames are not displayed or sent until you prepare a plan.</p>';
      const planHtml=plan?
        '<div class="onboard-summary"><p><strong>Plan prepared — no workspace changes</strong></p>'+
        '<dl class="fact-list"><div><dt>Plan SHA-256</dt><dd><code>'+html(plan.plan_sha256)+'</code></dd></div>'+
        '<div><dt>Git head</dt><dd><code>'+html(plan.head_sha)+'</code></dd></div>'+
        '<div><dt>Product</dt><dd>'+html(plan.config.product_name)+'</dd></div>'+
        '<div><dt>Release</dt><dd>'+html(plan.config.release_name)+'</dd></div>'+
        '<div><dt>Declared rights</dt><dd>'+html(plan.config.rights)+'</dd></div>'+
        '<div><dt>Technical truth</dt><dd>UNKNOWN (imported only)</dd></div></dl></div>'+
        '<div class="actions"><button data-action="onboard-download-plan" class="secondary">Save private plan JSON</button>'+
        '<button data-action="onboard-apply">Confirm and create workspace</button></div>':
        '<p class="muted">Review product, release, target, approved purpose and operator-declared rights before applying. The plan is not a publication intent.</p>';
      const resultHtml=result?
        '<section class="panel"><div class="panel-title"><h2>Workspace created or recovered</h2></div>'+
        '<div class="panel-body"><p>Six local domain resources are reconciled. Technical state remains <strong>UNKNOWN</strong>; the Markdown notes still need human review.</p>'+
        '<dl class="fact-list"><div><dt>Product ID</dt><dd><code>'+html(result.product_id)+'</code></dd></div>'+
        '<div><dt>Release ID</dt><dd><code>'+html(result.release_id)+'</code></dd></div>'+
        '<div><dt>Evidence ID</dt><dd><code>'+html(result.evidence_id)+'</code></dd></div>'+
        '<div><dt>Editable notes</dt><dd><code>'+html(result.deliverable_id)+'</code></dd></div></dl>'+
        '<div class="actions"><button data-action="onboard-open-release">Open release workspace</button></div></div></section>':'';
      return '<div class="git-onboarding"><div class="callout"><strong>Local Git metadata only</strong>No repository access is performed by the browser or server, no scripts are executed and no feature or publication claim is inferred. Imported evidence stays UNKNOWN.</div>'+
        '<section class="panel"><div class="panel-title"><h2>1 · Observe your existing project</h2></div>'+
        '<div class="panel-body"><p>Use the authorized local R32 CLI with an exact base/head commit pair. It creates a private JSON snapshot of committed file metadata, without reading code or fetching remote branches.</p>'+
        '<pre class="onboard-instructions">node scripts/git-change-source.mjs observe --repo /absolute/owned/repo --alias owned_project --base BASE_40_SHA --head HEAD_40_SHA --out /private/observation.json</pre>'+
        '<p class="small-note">Generate the observation on the same computer as your Git project. Only select the resulting JSON here; do not paste credentials or repository paths.</p></div></section>'+
        '<section class="panel"><div class="panel-title"><h2>2 · Select a private R32 observation</h2></div>'+
        '<div class="panel-body"><div class="field"><label for="git-observation-file">Observation JSON (max 240 KiB)</label>'+
        '<input type="file" id="git-observation-file" accept=".json,application/json" aria-describedby="onboard-observation-help">'+
        '<small id="onboard-observation-help">Read only into this browser session. Never saved to localStorage.</small></div>'+files+'</div></section>'+
        '<section class="panel"><div class="panel-title"><h2>3 · Prepare an exact onboarding plan</h2></div>'+
        '<div class="panel-body"><div class="actions"><button data-action="onboard-configure"'+(!loaded()?' disabled':'')+
        '>Configure local plan</button><button class="secondary" data-action="onboard-clear">Clear session</button></div>'+
        '<div class="field"><label for="git-plan-file">Or reload a previously saved private R35 plan</label>'+
        '<input type="file" id="git-plan-file" accept=".json,application/json"'+(!loaded()?' disabled':'')+
        '><small>Reload the matching observation first. The server verifies the plan against it.</small></div>'+
        planHtml+'</div></section>'+
        '<section class="panel"><div class="panel-title"><h2>4 · Review, then use Launchwright</h2></div>'+
        '<div class="panel-body"><p>Applying creates or reconciles Product, draft Release, approved CLI Source, declared Target, imported Evidence and editable Markdown notes. A human must still review notes and obtain runtime verification before publication.</p>'+
        '<p class="small-note">Re-running the <strong>same</strong> exact plan after an interrupted reply is recoverable. Never generate a different plan to guess whether an unknown operation succeeded. There is no automatic resend.</p></div></section>'+
        resultHtml+'</div>';
    }
  };
}
