import { digest, RpmError } from './common.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const channelName = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const MAX_EVENTS = 2000;

// A channel correlation is a hypothesis about the handler, even when the
// message receipt was captured by this session. No per-function tracing occurs.
export function reconcileRuntime(inspection, runtime, { sessionCapture = false } = {}) {
  if (!object(inspection) || !Array.isArray(inspection.nodes) || !Array.isArray(inspection.contexts) || !object(runtime) || !Array.isArray(runtime.events)) {
    throw new RpmError('reconcile_input', 'Reconciliation requires an inspection and an explicit runtime events array.');
  }
  if (runtime.events.length > MAX_EVENTS || inspection.nodes.length > 5000 || inspection.contexts.length > 128) {
    throw new RpmError('reconcile_bounds', 'Inspection or runtime events exceed the reconciliation budget.');
  }
  if (runtime.kind !== 'runtime-capture' || inspection.artifact?.kind !== 'manifest-v3') {
    throw new RpmError('reconcile_unsupported', 'Reconciliation supports an MV3 inspection and its matching rpm-kv-v1 capture.');
  }
  const target = inspection.artifact.sha256;
  if (!hash(target) || target !== runtime.receipt?.bindings?.target_sha256 || target !== runtime.provenance?.target?.sha256) {
    throw new RpmError('binding_mismatch', 'Inspect the exact unfiltered artifact used by the MV3 capture before joining its events.');
  }
  const authority = sessionCapture ? 'provider-captured' : 'reported';
  const workers = new Set(inspection.contexts.filter(context => context?.kind === 'service-worker').map(context => context.id));
  const handlers = inspection.nodes.filter(node => node?.kind === 'message-listener' && workers.has(node.context_id));
  const handlersByChannel = new Map(), observedByChannel = new Map();
  const matches = [], unknowns = [], unmatchedRuntime = [];
  const add = (index, key, value) => {
    const values = index.get(key) ?? [];
    values.push(value);
    index.set(key, values);
  };
  for (const handler of handlers) {
    const channel = channelName(handler.channel);
    if (channel === null) unknowns.push({ code: 'static_channel_unresolved', static_id: handler.id });
    else add(handlersByChannel, channel, handler);
  }
  let storageSnapshots = 0, ignoredEvents = 0;
  for (const [index, event] of runtime.events.entries()) {
    if (event?.kind === 'storage-local') { storageSnapshots++; continue; }
    if (event?.kind !== 'message-response') { ignoredEvents++; continue; }
    const channel = channelName(event.request?.type);
    const row = { event_index: index, action_id: channelName(event.action_id), channel, authority };
    if (channel === null || row.action_id === null) unmatchedRuntime.push({ ...row, reason: 'runtime_message_unresolved' });
    else add(observedByChannel, channel, row);
  }
  for (const [channel, candidates] of handlersByChannel) {
    const observations = observedByChannel.get(channel) ?? [];
    if (candidates.length !== 1) {
      unknowns.push({ code: 'static_channel_ambiguous', channel, static_ids: candidates.map(row => row.id), event_count: observations.length });
    } else if (!observations.length) {
      unknowns.push({ code: 'runtime_unmatched', static_id: candidates[0].id, channel });
    } else {
      matches.push({ static_id: candidates[0].id, static_authority: 'candidate', runtime_authority: authority, channel, status: 'channel-correlation', event_count: observations.length });
    }
  }
  // Every observed message retains its own index, including repeated action IDs.
  const events = [];
  for (const [channel, observations] of observedByChannel) {
    const candidates = handlersByChannel.get(channel) ?? [];
    for (const row of observations) {
      if (candidates.length === 1) events.push({ ...row, static_id: candidates[0].id });
      else unmatchedRuntime.push({ ...row, reason: candidates.length ? 'static_channel_ambiguous' : 'no_static_candidate' });
    }
  }
  if (runtime.complete !== true || runtime.receipt?.complete !== true) unknowns.push({ code: 'runtime_capture_incomplete' });
  const complete = unknowns.length === 0 && unmatchedRuntime.length === 0;
  return {
    schema_version: 1,
    kind: 'runtime-reconciliation',
    status: matches.length ? (complete ? 'matched' : 'partial') : 'unknown',
    target: { artifact_sha256: target, inspection_sha256: digest(inspection), runtime_sha256: digest(runtime) },
    authority: { static: 'bounded-static-candidate', runtime: authority, derived: 'channel-correlation' },
    matches,
    events: events.sort((a, b) => a.event_index - b.event_index),
    unknowns,
    unmatched_runtime: unmatchedRuntime.sort((a, b) => a.event_index - b.event_index),
    coverage: { static_operations: handlers.length, runtime_events: runtime.events.length, matched: matches.length, matched_events: events.length, unmatched_runtime: unmatchedRuntime.length, storage_snapshots: storageSnapshots, ignored_events: ignoredEvents },
    scope: 'Same-artifact MV3 service-worker message channels in an rpm-kv-v1 capture. A correlated channel does not identify executed functions, storage calls or whole-program behavior.',
  };
}
