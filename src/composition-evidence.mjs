// SPDX-License-Identifier: AGPL-3.0-only
import { exactRequestDigest, requireCondition as ensure, validateValue } from '@semwright/native-sdk';

const SHA=/^[0-9a-f]{64}$/;
const COMMIT=/^[0-9a-f]{40}$/;

function sha(value,label){
  ensure(typeof value==='string'&&SHA.test(value),label+' must be lowercase SHA-256');
  return value;
}
function commit(value,label){
  ensure(typeof value==='string'&&COMMIT.test(value),label+' must be a full lowercase commit SHA');
  return value;
}
function requireObject(value,label){
  ensure(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');
  return value;
}

export function validateCompositionEvidence({expected_semwright_sha,browser_receipt,media_receipt,av_receipt}){
  validateValue({expected_semwright_sha,browser_receipt,media_receipt,av_receipt});
  commit(expected_semwright_sha,'Expected Semwright SHA');
  requireObject(browser_receipt,'Browser receipt');
  requireObject(media_receipt,'Media receipt');
  requireObject(av_receipt,'AV receipt');

  ensure(browser_receipt.schema_version==='launchwright-deltadesk-browser-driver/1','Unexpected browser receipt schema');
  ensure(browser_receipt.semwright_sha===expected_semwright_sha,'Browser receipt is from another Semwright revision','StaleReference');
  ensure(browser_receipt.real_semwright_adapter===true,'Browser receipt did not execute the real Semwright adapter');
  ensure(browser_receipt.agent_javascript===false&&browser_receipt.raw_cdp_exposed===false,'Browser receipt bypassed the semantic adapter');
  ensure(browser_receipt.platform_job_receipt===false,'This evidence chain must not invent a Platform job');
  ensure(Array.isArray(browser_receipt.captures)&&browser_receipt.captures.length===2,'Expected exact DeltaDesk A/B captures');
  const captures=new Map(browser_receipt.captures.map(row=>[String(row.build).toUpperCase(),row]));
  const captureA=captures.get('A'),captureB=captures.get('B');
  ensure(captureA&&captureB,'DeltaDesk A/B capture identities are incomplete');
  sha(captureA.screenshot?.sha256,'Build A screenshot digest');
  sha(captureB.screenshot?.sha256,'Build B screenshot digest');

  ensure(media_receipt.schema_version==='launchwright-real-media-driver/1','Unexpected real-media receipt schema');
  ensure(media_receipt.classification==='REAL_BROWSER_CAPTURE_TO_DRIVER_HOST_MLT','Unexpected real-media classification');
  ensure(media_receipt.semwright_sha===expected_semwright_sha,'Media receipt is from another Semwright revision','StaleReference');
  ensure(media_receipt.provider==='driver.mlt-video'&&media_receipt.driver_host===true,'Real-media path did not use the Semwright MLT Driver Host');
  ensure(media_receipt.network===false,'Real-media render unexpectedly had network access');
  ensure(media_receipt.broker_dispatch===false,'Receipt overstates Broker dispatch');
  ensure(media_receipt.platform_job_receipt===false,'Media receipt must not fabricate a Platform job');
  ensure(media_receipt.composition_coordinator_receipt===false,'Media receipt must not fabricate Composition coordinator authority');
  ensure(media_receipt.source?.kind==='semwright-chromium-capture','Media source is not the real browser-capture class');
  ensure(media_receipt.source.capture_a_sha256===captureA.screenshot.sha256,'Build A media source differs from captured bytes','Conflict');
  ensure(media_receipt.source.capture_b_sha256===captureB.screenshot.sha256,'Build B media source differs from captured bytes','Conflict');
  ensure(Number.isInteger(media_receipt.source.width)&&media_receipt.source.width>=640,'Media width is invalid');
  ensure(Number.isInteger(media_receipt.source.height)&&media_receipt.source.height>=480,'Media height is invalid');
  sha(media_receipt.frame_manifest_sha256,'Frame manifest digest');
  sha(media_receipt.mezzanine_sha256,'Mezzanine digest');
  sha(media_receipt.audio_sha256,'Audio digest');
  sha(media_receipt.artifact?.sha256,'MP4 digest');
  ensure(media_receipt.artifact?.mime==='video/mp4','Real-media artifact is not MP4');
  ensure(Number.isInteger(media_receipt.artifact?.bytes)&&media_receipt.artifact.bytes>1000,'Real-media MP4 is unexpectedly small');
  ensure(media_receipt.timeline?.fps?.num===30&&media_receipt.timeline?.fps?.den===1,'Acceptance timeline must be 30 fps rational time');
  ensure(media_receipt.timeline?.frame_count===600,'Acceptance timeline must contain exactly 600 frames');
  ensure(media_receipt.timeline?.duration?.num===20&&media_receipt.timeline?.duration?.den===1,'Acceptance timeline must be exactly 20 seconds');
  ensure(Array.isArray(media_receipt.timeline?.segments)&&media_receipt.timeline.segments.length===2,'Acceptance timeline must preserve A/B source segments');
  ensure(media_receipt.timeline.segments[0]?.build==='A'&&media_receipt.timeline.segments[0]?.first_frame===0&&media_receipt.timeline.segments[0]?.end_frame_exclusive===300,'Build A segment binding changed');
  ensure(media_receipt.timeline.segments[1]?.build==='B'&&media_receipt.timeline.segments[1]?.first_frame===300&&media_receipt.timeline.segments[1]?.end_frame_exclusive===600,'Build B segment binding changed');

  ensure(av_receipt.schema_version===1,'Unexpected canonical AV receipt schema');
  ensure(av_receipt.classification==='COMBINED_A_B_NATIVE_AV_CANDIDATE','Unexpected canonical AV classification');
  ensure(av_receipt.composition_source_sha===expected_semwright_sha,'Canonical AV receipt is from another Semwright revision','StaleReference');
  ensure(av_receipt.audio_source_sha===expected_semwright_sha,'Canonical AV audio source is from another Semwright revision','StaleReference');
  ensure(av_receipt.audio_pre_encode_pass===true&&av_receipt.audio_post_encode_pass===true,'Canonical AV audio verification did not pass');
  ensure(av_receipt.sync_full_scan_pass===true&&av_receipt.sync_exhaustive===true,'Canonical AV sync verification was not exhaustive');
  sha(av_receipt.master_mp4_sha256,'Canonical AV master digest');
  ensure(av_receipt.r16_closed===false&&av_receipt.promotional_video===false,'Canonical AV receipt scope changed unexpectedly');

  const facts={
    semwright_sha:expected_semwright_sha,
    capture_a_sha256:captureA.screenshot.sha256,
    capture_b_sha256:captureB.screenshot.sha256,
    real_media_mp4_sha256:media_receipt.artifact.sha256,
    canonical_av_master_sha256:av_receipt.master_mp4_sha256,
    real_capture_source:'PASS',
    native_driver_host_render:'PASS',
    canonical_composition_av_stack:'PASS',
    single_recipe_real_capture_composition:'UNKNOWN'
  };
  return{
    schema_version:'launchwright-composition-evidence/1',
    ...facts,
    chain_sha256:exactRequestDigest('launchwright/composition-evidence/1',facts),
    admission:'PARTIAL_CROSS_SYSTEM_EVIDENCE',
    technical_state:'UNKNOWN',
    media_requirement_state:'PARTIAL',
    output_editorial_state:'PENDING',
    execution_authority:false,
    explanation:'The same pinned Semwright revision proves real DeltaDesk capture -> Driver Host MLT -> MP4 and independently proves the canonical Composition AV stack. A single owner-admitted Composition recipe consuming those real captures is not yet evidenced, so Launchwright does not promote this chain to technical PASS.'
  };
}
