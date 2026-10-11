// SPDX-License-Identifier: AGPL-3.0-only
// R68: no saved Git paths or private plans in localStorage. All Git operations
// originate from explicit owner clicks, never effects, startup or auto-retry.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const sha64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/u.test(x);
export function createGitDocsController(api){
  let plan=null,repoRoot='',status=null;
  function clear(){plan=null;repoRoot='';status=null;}
  async function prepare(selection){
    if(!selection||typeof selection.repository_root!=='string'||
      !selection.repository_root.startsWith('/')&&
      !/^[A-Za-z]:[\\/]/u.test(selection.repository_root))
      throw Error('Choose the absolute root of the authorized local Git repository');
    if(selection.acknowledge_draft_only!==true)
      throw Error('Approve local Git branch creation only, not publication');
    const result=await api.planLocalGitDocs(selection);
    if(!sha64(result.plan?.plan_sha256))throw Error('No exact R40 plan SHA returned');
    plan=result.plan;repoRoot=selection.repository_root;status=null;
    return plan;
  }
  async function restore(saved,root){
    if(!saved||saved.schema_version!=='launchwright-git-docs-branch-intent/1'||
      !sha64(saved.plan_sha256)||!sha64(saved.candidate_sha256)||
      !sha40(saved.base_commit_sha)||typeof root!=='string'||!root)
      throw Error('Choose the original absolute repository and exact R40 plan JSON');
    const inspected=await api.inspectLocalGitDocs(root,saved);
    plan=saved;repoRoot=root;status=inspected;
    return status;
  }
  async function inspect(){
    if(!plan)throw Error('Prepare or import an exact R40 plan first');
    status=await api.inspectLocalGitDocs(repoRoot,plan);
    return status;
  }
  async function apply(confirmations){
    if(!plan)throw Error('Prepare or import an exact R40 plan first');
    if(!confirmations||confirmations.acknowledge_local_git_write!==true)
      throw Error('Explicit local Git write approval required');
    // A lost HTTP response must be resolved by inspect(), NEVER auto-retried.
    const result=await api.applyLocalGitDocs(repoRoot,plan,confirmations);
    status=await api.inspectLocalGitDocs(repoRoot,plan);
    if(status.state!=='LOCAL_BRANCH_READY')
      throw Error('The created branch could not be independently read back');
    return{...result,status};
  }
  function downloadPlan(){
    if(!plan)throw Error('Prepare or import the original plan first');
    return JSON.stringify(plan,null,2)+'\n';
  }
  function render(candidates,artifacts){
    const scoped=new Set(candidates.flatMap(c=>c.data.manifest?.artifact_ids??[]));
    const frozen=artifacts.filter(a=>scoped.has(a.id));
    let html=`<section class="panel"><div class="panel-title"><h2>Reviewed Markdown → local Git branch</h2></div><div class="panel-body"><p>Choose a frozen candidate, one Markdown artifact and the exact Git repository you control. Launchwright validates that the candidate was editorially approved and has not drifted. No project code, hooks, pushes or remote APIs run.</p>`+
      `<div class="actions"><button data-action="docs-git-plan" ${!candidates.length||!frozen.length?'disabled':''}>Prepare reviewed branch</button><button data-action="docs-git-load" class="secondary">Restore exact saved plan</button><button data-action="docs-git-clear" class="secondary">Clear private inputs</button></div>`+
      (!candidates.length?'<p class="small-note">Render a Markdown deliverable, freeze the artifact in Review room, and approve the candidate editorially first.</p>':'')+
      `</div></section>`;
    if(plan){
      const rows=[
        ['Plan SHA-256',plan.plan_sha256],['Candidate SHA-256',plan.candidate_sha256],
        ['Base commit SHA',plan.base_commit_sha],['Frozen Markdown SHA-256',plan.artifact_sha256],
        ['Local review branch',plan.branch],['GitHub repository declaration',plan.github_repository],
        ['Documentation destination',plan.docs_path],['Technical state',plan.technical_state]
      ];
      html+=`<section class="panel"><div class="panel-title"><h2>Exact R40 plan — no branch written by preparation</h2></div><div class="panel-body"><dl class="fact-list docs-git-facts">`+
        rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd><code class="docs-git-hash">${esc(v)}</code></dd></div>`).join('')+
        `</dl><p>Review the three full identity hashes before confirming. Save the plan in a private folder; it is kept only in this browser tab's memory until downloaded.</p><div class="actions"><button data-action="docs-git-apply">Create or reconcile local branch</button><button data-action="docs-git-inspect" class="secondary">Read branch status (safe recovery)</button><button data-action="docs-git-save" class="secondary">Download plan JSON</button></div></div></section>`;
    }
    if(status){
      html+=`<section class="panel"><div class="panel-title"><h2>Git branch readback</h2></div><div class="panel-body"><p>State: <strong>${esc(status.state)}</strong>. Nothing was pushed to GitHub.</p>`+
        (status.commit_sha?`<dl class="fact-list"><div><dt>Verified commit</dt><dd><code class="docs-git-hash">${esc(status.commit_sha)}</code></dd></div><div><dt>Frozen source</dt><dd><code class="docs-git-hash">${esc(status.source_artifact_sha256)}</code></dd></div></dl>`:'')+
        `<p class="small-note">To open a GitHub Draft PR, review this branch, push it separately using your approved Git process, and follow the R41 workflow. A branch is not a publication.</p></div></section>`;
    }
    return html+`<div class="callout"><strong>Safety boundary</strong>This workflow creates at most one local docs branch from Semwright Native-backed frozen Markdown. It cannot prove technical behavior, customer rights or Platform Publish. Remote push, GitHub PR and merge are separate authorizations.</div>`;
  }
  return{prepare,restore,inspect,apply,downloadPlan,render,clear,
    get plan(){return plan;},get repoRoot(){return repoRoot;},
    get status(){return status;}};
}
