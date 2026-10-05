// SPDX-License-Identifier: AGPL-3.0-only
import { sameVersion } from '@semwright/native-sdk';

export function claimCheck(app,claim){
  const c=claim.data,release=app.get(c.release_id,'release'),target=app.get(c.target_id,'target');
  const evidence=c.evidence_ids.map(id=>app.get(id,'evidence')),reasons=[];
  if(!evidence.length)reasons.push('no-evidence');
  for(const e of evidence){
    if(e.data.build!==release.data.build)reasons.push('build-mismatch');
    if(!sameVersion(e.data.target_version,target.version))reasons.push('target-revision-changed');
    if(!['owned','licensed'].includes(e.data.rights))reasons.push('rights-unresolved');
    if(e.data.technical!=='PASS')reasons.push('technical-verification-unknown');
  }
  if(c.valid_until&&Date.parse(c.valid_until)<=Date.now())reasons.push('claim-validity-expired');
  if(c.availability_id){
    const a=app.get(c.availability_id,'availability');
    if(a.data.target_id!==c.target_id)reasons.push('availability-target-mismatch');
    if(a.data.valid_until&&Date.parse(a.data.valid_until)<=Date.now())reasons.push('availability-validity-expired');
    if(a.data.state==='unavailable')reasons.push('declared-availability-contradiction');
    if(a.data.state==='unknown')reasons.push('declared-availability-unknown');
    if(a.data.basis!=='observed')reasons.push('availability-not-observed');
  }
  const status=reasons.includes('declared-availability-contradiction')?'FAIL':'UNKNOWN';
  return{claim_id:claim.id,target_id:c.target_id,status,reasons:[...new Set([...reasons,'canonical-claim-verifier-unavailable'])],evidence_count:evidence.length,category:c.category};
}
