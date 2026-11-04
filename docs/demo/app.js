(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const array = value => Array.isArray(value) ? value : [];
  const show = value => value === undefined || value === null || value === '' ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
  const pretty = value => JSON.stringify(value, null, 2);
  const short = value => String(value ?? '').length > 29 ? `${String(value).slice(0, 16)}…${String(value).slice(-7)}` : show(value);
  const state = { steps: [], index: 0, query: '', selected: null, buttons: [], toast: null };
  function el(tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = show(value); return node; }
  function chip(value) { const label = show(value); return el('span', `status-chip ${label.toLowerCase().replace(/[^a-z_-]/gu, '')}`, label.replaceAll('_', ' ')); }
  function matches(value) { return !state.query || show(value).normalize('NFKC').toLowerCase().includes(state.query); }
  function hint(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(state.toast); state.toast = setTimeout(() => { $('toast').hidden = true; }, 3000); }
  function payload() { return state.steps[state.index]?.data || {}; }
  function formatMode(step, data) {
    const id = String(step.id || '').toLowerCase();
    if ((id.includes('reduc') || id.includes('shrink')) && data.reduction) return 'reduction';
    if ((id.includes('verif') || id.includes('compar')) && data.verification) return 'verification';
    if ((id.includes('plan') || id.includes('probe') || id.includes('exper')) && data.planner) return 'planner';
    if (data.inspection) return 'inspection'; if (data.planner) return 'planner'; if (data.verification) return 'verification'; if (data.reduction) return 'reduction'; return 'payload';
  }
  function empty(message) { return el('div', 'empty-state', message); }
  function table(headers, records, cells, note) {
    const wrap = el('div', 'table-wrap');
    if (!records.length) return empty('No supplied records match this filter.');
    const node = el('table', 'preview-table'); node.append(el('caption', 'sr-only', $('state-heading').textContent)); const head = el('thead'); const hr = el('tr');
    for (const label of headers) { const th = el('th', '', label); th.scope = 'col'; hr.append(th); } head.append(hr); node.append(head);
    const body = el('tbody');
    for (const record of records.slice(0, 16)) { const row = el('tr'); for (const value of cells(record)) { const cell = el('td'); if (value instanceof Node) cell.append(value); else cell.textContent = show(value); row.append(cell); } body.append(row); }
    node.append(body); wrap.append(node);
    if (records.length > 16) wrap.append(el('p', 'result-note', `Showing 16 of ${records.length} matches. Export includes all supplied records.`));
    else if (note) wrap.append(el('p', 'result-note', note));
    return wrap;
  }
  function recordLink(label, record) {
    const button = el('button', 'record-button', label); button.type = 'button';
    button.addEventListener('click', () => { state.selected = record; renderPreview(); $('selected-detail')?.scrollIntoView({ block: 'nearest' }); }); return button;
  }
  function metrics(entries) { $('demo-metrics').replaceChildren(...entries.map(([label, value, note, style = '']) => { const card = el('div', `demo-metric ${style}`); card.append(el('span', '', label), el('strong', '', value), el('small', '', note)); return card; })); }
  function renderInspection(data) {
    const inspection = data.inspection; const contexts = array(inspection.contexts); const nodes = array(inspection.nodes); const edges = array(inspection.edges); const evidence = array(inspection.evidence); const unknowns = array(inspection.unknowns);
    metrics([['Contexts', contexts.length, 'Separate artifact boundaries'], ['Candidate links', edges.length, 'Static declarations / candidates'], ['Source records', evidence.length, 'Positions with content identity'], ['Unknowns', unknowns.length, 'Retained investigation limits', unknowns.length ? 'is-warning' : 'is-signal']]);
    $('preview-type').textContent = 'STATIC ARTIFACT BOUNDARIES';
    const fragment = document.createDocumentFragment(); const matchingContexts = contexts.filter(matches);
    if (matchingContexts.length) {
      const grid = el('div', 'preview-contexts');
      for (const context of matchingContexts.slice(0, 3)) { const card = el('article', 'preview-context'); card.append(el('span', 'context-kind', context.kind), el('strong', '', context.label || context.id), el('span', 'context-path', array(context.entrypoints).join('\n') || short(context.id)), el('span', 'context-note', 'Separate context · static inspection')); grid.append(card); }
      fragment.append(grid);
      if (matchingContexts.length > 3) fragment.append(el('p', 'result-note', `${matchingContexts.length - 3} additional matching contexts are retained in the export.`));
    }
    const nodeLabel = id => nodes.find(item => item.id === id)?.label || contexts.find(item => item.id === id)?.label || short(id);
    const filtered = edges.filter(edge => matches({ ...edge, from_label: nodeLabel(edge.from), to_label: nodeLabel(edge.to) }));
    fragment.append(el('h4', 'preview-subheading', 'Relationships with their stated authority'), table(['From', 'Relationship', 'To', 'Authority'], filtered, edge => [recordLink(nodeLabel(edge.from), edge), show(edge.kind).replaceAll('_', ' '), nodeLabel(edge.to), chip(edge.authority)]));
    if (!edges.length && evidence.length) fragment.append(el('h4', 'preview-subheading', 'Source records'), table(['File', 'Location', 'Operation', 'Digest'], evidence.filter(matches), record => [recordLink(record.file || record.id, record), `L${record.line ?? '?'}:${record.column ?? '?'}`, record.operation, el('span', 'mono', short(record.sha256))]));
    $('result-count').textContent = `${filtered.length} matching relationships · ${matchingContexts.length} matching contexts`;
    $('result-authority').textContent = 'Static candidates do not establish runtime execution.'; return fragment;
  }
  function renderPlanner(data) {
    const planner = data.planner; const ranked = array(planner.ranked); const hypotheses = array(data.case?.hypotheses); const surviving = array(planner.surviving_ids);
    metrics([['Hypotheses', hypotheses.length, 'Supplied candidate explanations'], ['Surviving', surviving.length, 'Applicable observation filtering', 'is-signal'], ['Ranked probes', ranked.length, 'Available under declared constraints'], ['Planner status', planner.status, 'A heuristic outcome, not confidence']]);
    $('preview-type').textContent = 'DISTINGUISHING EXPERIMENT PLAN';
    const fragment = document.createDocumentFragment(); const filtered = ranked.filter(matches);
    fragment.append(table(['Probe', 'Declared cost', 'Score', 'Supplied ranking detail'], filtered, probe => { const id = probe.probe_id || probe.id || probe.probe?.id; const definition = array(data.case?.probes).find(item => item.id === id); return [recordLink(probe.label || probe.probe?.label || definition?.label || id, { ranking: probe, definition: definition || null }), probe.cost, probe.score, probe.gain === undefined ? 'Inspect the supplied partition result' : `Gain ${probe.gain}${probe.worst_survivors === undefined ? '' : ` · worst survivors ${probe.worst_survivors}`}`]; }, 'Missing predictions remain unknown. The viewer does not execute a ranked probe.'));
    if (surviving.length) { const row = el('div', 'hypothesis-row'); row.append(el('span', '', 'SURVIVING IDS')); for (const id of surviving) row.append(chip(id)); fragment.append(row); }
    if (array(planner.ignored_observations).length) { const note = el('div', 'detail-section'); note.append(el('h4', '', 'Ignored / inapplicable observations'), el('pre', '', pretty(planner.ignored_observations))); fragment.append(note); }
    $('result-count').textContent = `${filtered.length} matching ranked probes`;
    $('result-authority').textContent = 'Worst-case partition heuristic · no probability claim.'; return fragment;
  }
  function renderVerification(data) {
    const verification = data.verification; const summary = verification.summary || {}; const cases = array(verification.cases); const filtered = cases.filter(matches);
    metrics([['Passed', summary.pass ?? 0, 'Declared supplied cases', 'is-signal'], ['Failed', summary.fail ?? 0, 'Concrete supplied mismatches', summary.fail ? 'is-warning' : ''], ['Unknown', summary.unknown ?? 0, 'Missing / incomparable evidence'], ['Verdict', verification.status, 'Finite behavioral contract']]);
    $('preview-type').textContent = 'FINITE BEHAVIOR VERIFICATION';
    const fragment = document.createDocumentFragment(); const strip = el('div', `verdict-strip${verification.status === 'fail' ? ' is-fail' : verification.status === 'unknown' ? ' is-unknown' : ''}`); const copy = el('div'); copy.append(el('strong', '', 'The declared comparison has a visible result.'), el('p', '', 'Inspect each case and its applicability; no whole-program equivalence is inferred.')); strip.append(copy, chip(verification.status)); fragment.append(strip);
    fragment.append(table(['Case', 'Verdict', 'Recorded detail'], filtered, record => [recordLink(record.id || record.case_id, record), chip(record.status || record.verdict || 'unknown'), show(record.reason || record.reasons || record.differences || record.detail || record.message || 'Inspect the supplied result')]));
    $('result-count').textContent = `${filtered.length} matching comparison cases`;
    $('result-authority').textContent = 'Recorded synthetic/control-model evidence retains its scope.'; return fragment;
  }
  function renderReduction(data) {
    const reduction = data.reduction; const sequence = array(reduction.sequence); const receipts = array(reduction.receipts);
    metrics([['Retained steps', sequence.length, 'A smaller interaction sequence', 'is-signal'], ['Oracle tests', reduction.tests, 'Recorded reduction test count'], ['Outcome', reduction.status, 'Bounded reduction status'], ['Minimality', reduction.minimality, 'Under tested operations / budget']]);
    $('preview-type').textContent = 'REPRODUCIBLE MISMATCH REDUCTION';
    const fragment = document.createDocumentFragment(); const steps = el('div', 'sequence');
    sequence.forEach((step, index) => { if (!matches(step)) return; const card = el('div', 'sequence-step'); card.append(el('span', '', String(index + 1).padStart(2, '0')), el('strong', '', show(step))); steps.append(card); });
    fragment.append(steps.childNodes.length ? steps : empty('No retained sequence steps match the filter.'));
    if (receipts.length) fragment.append(el('h4', 'preview-subheading', 'Recorded oracle attempts'), table(['Attempt', 'Status', 'Result'], receipts.filter(matches), receipt => [recordLink(show(receipt.test ?? receipt.attempt ?? receipt.index ?? 'recorded'), receipt), chip(receipt.status || receipt.result?.status || 'recorded'), el('span', 'mono', show(receipt.fingerprint || receipt.result || receipt))]));
    fragment.append(el('p', 'result-note', 'Reduction preserves the failure oracle and reset conditions. Tested one-minimality is not a globally shortest failure claim.'));
    $('result-count').textContent = `${sequence.filter(matches).length} matching retained steps · ${receipts.filter(matches).length} matching receipts`;
    $('result-authority').textContent = 'Controlled synthetic oracle · inspect the exported conditions.'; return fragment;
  }
  function renderPreview() {
    if (!state.steps.length) return;
    const step = state.steps[state.index]; const data = payload(); const mode = formatMode(step, data); let content;
    if (mode === 'inspection') content = renderInspection(data);
    else if (mode === 'planner') content = renderPlanner(data);
    else if (mode === 'verification') content = renderVerification(data);
    else if (mode === 'reduction') content = renderReduction(data);
    else { metrics([['Schema', data.schema_version, 'Supplied record schema']]); content = el('pre', 'payload-fallback', pretty(data)); $('result-count').textContent = 'Complete supplied payload'; $('preview-type').textContent = 'RECORDED PAYLOAD'; }
    $('preview-content').replaceChildren(content);
    if (state.selected) { const detail = el('section', 'detail-section'); detail.id = 'selected-detail'; detail.append(el('h4', '', 'Selected supplied record'), el('pre', '', pretty(state.selected))); $('preview-content').append(detail); }
  }
  function selectStep(index, announce = true) {
    if (index < 0 || index >= state.steps.length) return;
    state.index = index; state.query = ''; state.selected = null; $('demo-search').value = '';
    const step = state.steps[index]; const data = payload();
    $('state-heading').textContent = step.label || step.title || step.id || `Operation ${index + 1}`;
    $('state-description').textContent = step.description || 'Explore the supplied engine output below.';
    $('state-code').textContent = `RECORDED OPERATION ${String(index + 1).padStart(2, '0')} / ${String(state.steps.length).padStart(2, '0')}`;
    $('demo-position').textContent = `STATE ${String(index + 1).padStart(2, '0')} / ${String(state.steps.length).padStart(2, '0')}`;
    $('demo-source').textContent = `REA PRO MAX / ${String(data.kind || 'RECORDED CASE').toUpperCase()}`;
    $('step-summary').textContent = `Step ${index + 1} of ${state.steps.length} · actual engine output · synthetic fixture`;
    $('previous-state').disabled = index === 0; $('next-state').disabled = index === state.steps.length - 1;
    state.buttons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; });
    renderPreview(); if (announce) $('state-announcement').textContent = `${$('state-heading').textContent}. ${$('state-description').textContent}`;
  }
  function buildTabs() {
    $('state-tabs').replaceChildren(); state.buttons = [];
    state.steps.forEach((step, index) => { const button = el('button', 'state-tab'); button.type = 'button'; button.role = 'tab'; button.id = `operation-${index}`; button.setAttribute('aria-controls', 'case-stage'); button.append(el('span', '', String(index + 1).padStart(2, '0')), el('span', '', step.label || step.title || step.id || `Operation ${index + 1}`)); button.addEventListener('click', () => selectStep(index)); button.addEventListener('keydown', event => { let next; if (event.key === 'ArrowRight') next = (index + 1) % state.steps.length; else if (event.key === 'ArrowLeft') next = (index + state.steps.length - 1) % state.steps.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = state.steps.length - 1; if (next !== undefined) { event.preventDefault(); selectStep(next); state.buttons[next].focus(); } }); state.buttons.push(button); $('state-tabs').append(button); });
  }
  async function load() {
    $('demo-error').hidden = true; $('retry-load').disabled = true;
    try {
      const response = await fetch('demo/states.json', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`The recorded data returned HTTP ${response.status}.`);
      const json = await response.json(); const steps = Array.isArray(json) ? json : json.states;
      if (!Array.isArray(steps) || !steps.length || !steps.every(step => step && typeof step === 'object' && step.data && typeof step.data === 'object')) throw new Error('Expected recorded states with their supplied payloads.');
      state.steps = steps; buildTabs(); $('export-state').disabled = false; $('demo-search').disabled = false; selectStep(0, false);
    } catch (error) { $('demo-error-detail').textContent = `${error.message} The toolkit source and installation guide are still available on GitHub.`; $('demo-error').hidden = false; $('state-heading').textContent = 'Recorded results unavailable'; $('state-description').textContent = 'No inspection, runtime or verification result has been inferred.'; $('demo-metrics').replaceChildren(); $('preview-content').replaceChildren(empty('Use the toolkit locally, or try loading this recorded explorer again.')); }
    finally { $('retry-load').disabled = false; }
  }
  $('previous-state').addEventListener('click', () => selectStep(state.index - 1)); $('next-state').addEventListener('click', () => selectStep(state.index + 1));
  $('demo-search').addEventListener('input', () => { state.query = $('demo-search').value.normalize('NFKC').toLowerCase().trim(); state.selected = null; renderPreview(); });
  $('retry-load').addEventListener('click', load);
  $('export-state').addEventListener('click', () => { if (!state.steps.length) return; const url = URL.createObjectURL(new Blob([pretty(payload()) + '\n'], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = `rea-pro-max-${String(state.steps[state.index].id || state.index + 1).replace(/[^a-z0-9_-]/giu, '-')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); hint('The complete selected payload has been exported.'); });
  $('copy-prompt').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('example-prompt').textContent.trim()); hint('Example task prompt copied.'); } catch { hint('Clipboard access is unavailable. Select and copy the visible prompt.'); } });
  load();
})();
