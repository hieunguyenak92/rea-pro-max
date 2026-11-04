(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const array = value => Array.isArray(value) ? value : [];
  const show = value => value === undefined || value === null || value === '' ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
  const pretty = value => JSON.stringify(value, null, 2);
  const short = value => String(value ?? '').length > 24 ? `${String(value).slice(0, 12)}…${String(value).slice(-8)}` : show(value);
  const state = { data: null, view: 'overview', query: '', context: '', selected: '', toast: null };
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = show(value);
    return element;
  }
  function badge(value) { const text = show(value); return node('span', `chip ${text.toLowerCase().replace(/[^a-z_-]/gu, '')}`, text.replaceAll('_', ' ')); }
  function empty(title, description) { const wrap = node('div', 'empty-state'); wrap.append(node('strong', '', title), node('span', '', description)); return wrap; }
  function match(value) { return !state.query || show(value).normalize('NFKC').toLowerCase().includes(state.query); }
  function countLabel(count, singular, plural = `${singular}s`) { return `${count.toLocaleString()} ${count === 1 ? singular : plural}`; }
  function hint(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(state.toast); state.toast = setTimeout(() => { $('toast').hidden = true; }, 3200);
  }
  function dataOf() { return state.data.inspection || {}; }
  function dataList(key) { return array(dataOf()[key]); }
  function contextName(id) { return dataList('contexts').find(item => item.id === id)?.label || id || 'Unattributed'; }
  function nodeName(id) { const item = dataList('nodes').find(entry => entry.id === id); return item?.label || contextName(id); }
  function nodeContext(id) { const item = dataList('nodes').find(entry => entry.id === id); return item?.context_id || id; }
  function setCount(value, note = 'Findings retain their stated authority.') { $('section-count').textContent = value; $('section-note').textContent = note; }
  function detail(value, heading = 'Selected record') {
    const wrapper = node('section', 'detail-panel'); wrapper.id = 'record-detail'; wrapper.append(node('h3', '', heading), node('pre', '', pretty(value))); return wrapper;
  }
  function evidenceAction(id) {
    const button = node('button', 'table-action', short(id)); button.type = 'button'; button.title = id;
    button.addEventListener('click', () => { state.view = 'evidence'; state.query = ''; state.selected = id; $('report-search').value = ''; render(); $('record-detail')?.scrollIntoView({ block: 'nearest' }); });
    return button;
  }
  function dataTable(headers, records, cells, options = {}) {
    const wrap = node('div', 'data-table-wrap');
    if (!records.length) return empty(options.emptyTitle || 'No matching records', options.emptyDescription || 'Change the search or select another section.');
    const table = node('table', 'data-table');
    const caption = node('caption', 'sr-only', options.caption || $('section-title').textContent); table.append(caption);
    const head = node('thead'); const headRow = node('tr');
    for (const label of headers) { const th = node('th', '', label); th.scope = 'col'; headRow.append(th); } head.append(headRow); table.append(head);
    const body = node('tbody');
    for (const record of records.slice(0, 400)) {
      const row = node('tr');
      for (const value of cells(record)) {
        const td = node('td');
        if (value instanceof Node) td.append(value); else td.textContent = show(value);
        row.append(td);
      }
      body.append(row);
    }
    table.append(body); wrap.append(table);
    if (records.length > 400) wrap.append(node('p', 'panel-note', `Showing the first 400 of ${records.length} matches. Export JSON includes the complete supplied data.`));
    return wrap;
  }
  function metadataRows(entries) {
    const dl = node('dl');
    for (const [key, value] of entries) { const row = node('div', 'key-value'); row.append(node('dt', '', key), node('dd', '', show(value))); dl.append(row); }
    return dl;
  }
  function sectionDefinitions() {
    const result = [{ id: 'overview', label: 'Overview' }];
    if (state.data.inspection) result.push({ id: 'boundaries', label: 'Boundaries', count: dataList('contexts').length }, { id: 'evidence', label: 'Source evidence', count: dataList('evidence').length }, { id: 'findings', label: 'Findings & unknowns', count: dataList('findings').length + dataList('unknowns').length });
    if (state.data.case || state.data.planner) result.push({ id: 'experiments', label: 'Experiments', count: array(state.data.planner?.ranked).length });
    if (state.data.verification) result.push({ id: 'verification', label: 'Verification', count: array(state.data.verification.cases).length });
    if (state.data.reduction) result.push({ id: 'reduction', label: 'Reduced trace', count: array(state.data.reduction.sequence).length });
    result.push({ id: 'payload', label: 'Complete payload' }); return result;
  }
  function renderNavigation() {
    const nav = $('view-nav'); nav.replaceChildren();
    sectionDefinitions().forEach((entry, index) => {
      const button = node('button', `nav-item${entry.id === state.view ? ' is-active' : ''}`); button.type = 'button';
      button.setAttribute('aria-current', entry.id === state.view ? 'page' : 'false');
      button.append(node('span', 'nav-number', String(index + 1).padStart(2, '0')), node('span', '', entry.label));
      if (entry.count !== undefined) button.append(node('span', 'nav-count', entry.count));
      button.addEventListener('click', () => { state.view = entry.id; state.query = ''; $('report-search').value = ''; render(); }); nav.append(button);
    });
  }
  function renderMetrics() {
    const metrics = [];
    if (state.data.inspection) metrics.push(['Contexts', dataList('contexts').length, 'Separate execution boundaries', ''], ['Connections', dataList('edges').length, 'Declared / candidate edges', ''], ['Source records', dataList('evidence').length, 'Locations with content identity', ''], ['Unknowns', dataList('unknowns').length, 'Retained investigation limits', dataList('unknowns').length ? 'is-warning' : 'is-signal']);
    else if (state.data.verification) { const summary = state.data.verification.summary || {}; metrics.push(['Passed', summary.pass ?? 0, 'Declared comparison cases', 'is-signal'], ['Failed', summary.fail ?? 0, 'Observed supplied mismatch', summary.fail ? 'is-warning' : ''], ['Unknown', summary.unknown ?? 0, 'Evidence incomplete or incompatible', ''], ['Verdict', state.data.verification.status, 'Finite supplied contract', '']); }
    else if (state.data.planner || state.data.case) metrics.push(['Hypotheses', array(state.data.case?.hypotheses).length, 'Supplied candidate explanations', ''], ['Surviving', array(state.data.planner?.surviving_ids).length, 'After applicable observations', 'is-signal'], ['Ranked probes', array(state.data.planner?.ranked).length, 'Admissible next experiments', ''], ['Observations', array(state.data.case?.observations).length, 'Supplied case observations', '']);
    else if (state.data.reduction) metrics.push(['Retained steps', array(state.data.reduction.sequence).length, 'Reduced interaction sequence', 'is-signal'], ['Oracle tests', state.data.reduction.tests, 'Actual recorded test count', ''], ['Status', state.data.reduction.status, 'Reduction outcome', ''], ['Minimality', state.data.reduction.minimality, 'Under tested operations / budget', '']);
    else metrics.push(['Schema', state.data.schema_version, 'Supplied payload version', '']);
    $('metrics').replaceChildren(...metrics.map(([label, value, note, signal]) => { const card = node('div', `metric ${signal}`); card.append(node('span', '', label), node('strong', '', value), node('small', '', note)); return card; }));
  }
  function renderOverview() {
    const grid = node('div', 'overview-grid'); const left = node('div', 'overview-block'); const right = node('div', 'overview-block');
    const artifact = dataOf().artifact || state.data.case?.target || {};
    left.append(node('p', 'block-label', 'Target identity'));
    if (artifact.sha256) left.append(node('p', 'target-digest', artifact.sha256));
    left.append(metadataRows([['Type', artifact.kind || state.data.kind], ['Path / target', artifact.path || artifact.label || artifact.id], ['Files examined', artifact.file_count], ['Case revision', state.data.case?.revision]]));
    const narrative = state.data.narrative;
    if (typeof narrative === 'string') left.append(node('p', 'content-paragraph', narrative));
    else if (Array.isArray(narrative)) for (const part of narrative) left.append(node('p', 'content-paragraph', typeof part === 'string' ? part : pretty(part)));
    right.append(node('p', 'block-label', 'Scope & interpretation'), node('p', 'content-paragraph', state.data.inspection ? 'This is static artifact inspection. Declared structures and candidate relationships need qualified runtime observations before they can establish execution.' : 'This report presents supplied case data and engine results. Inspect the bindings, provenance and comparison scope before interpreting a conclusion.'), node('p', 'content-paragraph', 'Content hashes identify the supplied bytes. They do not authenticate a reported runtime event. The viewer runs no target code.'));
    const limits = dataOf().limits;
    if (limits && Object.keys(limits).length) { right.append(node('p', 'block-label', 'Inspection bounds'), node('pre', 'json-block', pretty(limits))); }
    const capabilities = dataOf().capabilities || state.data.case?.capabilities;
    if (array(capabilities).length) { const list = node('div', 'probe-facts'); for (const capability of capabilities) list.append(badge(show(capability))); right.append(node('p', 'block-label', 'Supplied capabilities'), list); }
    grid.append(left, right); setCount('A bounded view of the supplied case', 'Open a section to inspect its underlying records.'); return grid;
  }
  function contextFilter() {
    const bar = $('filter-bar'); bar.hidden = false; const label = node('label', '', 'Context'); label.htmlFor = 'context-filter';
    const select = node('select'); select.id = 'context-filter'; select.append(new Option('All contexts', ''));
    for (const context of dataList('contexts')) select.append(new Option(context.label || context.id, context.id));
    select.value = state.context; select.addEventListener('change', () => { state.context = select.value; renderView(); }); bar.replaceChildren(label, select, badge('static candidates'));
  }
  function renderBoundaries() {
    contextFilter(); const fragment = document.createDocumentFragment();
    const contexts = dataList('contexts').filter(item => (!state.context || item.id === state.context) && match(item));
    if (contexts.length) {
      const grid = node('div', 'context-grid');
      for (const context of contexts.slice(0, 100)) {
        const card = node('button', `context-card${state.context === context.id ? ' is-selected' : ''}`); card.type = 'button';
        card.append(node('span', 'context-type', context.kind), node('strong', '', context.label || context.id), node('span', 'context-file', array(context.entrypoints).join('\n') || context.id));
        const nodeCount = dataList('nodes').filter(item => item.context_id === context.id).length;
        const bottom = node('span', 'context-bottom'); bottom.append(node('span', '', countLabel(nodeCount, 'node')), node('span', '', state.context === context.id ? 'Show all ↗' : 'Inspect context ↗')); card.append(bottom);
        card.addEventListener('click', () => { state.context = state.context === context.id ? '' : context.id; renderView(); }); grid.append(card);
      }
      fragment.append(grid);
    } else fragment.append(empty('No matching contexts', 'No supplied execution context matches this view.'));
    const edges = dataList('edges').filter(item => (!state.context || [nodeContext(item.from), nodeContext(item.to)].includes(state.context)) && match({ ...item, from_label: nodeName(item.from), to_label: nodeName(item.to) }));
    fragment.append(node('h3', 'subheading', 'Relationships & boundaries'), dataTable(['From', 'Relationship', 'To', 'Authority', 'Evidence'], edges, edge => {
      const refs = node('div', 'insight-links'); for (const id of array(edge.evidence_ids).slice(0, 4)) refs.append(evidenceAction(id));
      return [nodeName(edge.from), show(edge.kind).replaceAll('_', ' '), nodeName(edge.to), badge(edge.authority), refs];
    }, { emptyTitle: 'No matching relationships', emptyDescription: 'A static context does not imply a proven connection to another context.' }));
    fragment.append(node('p', 'panel-note', 'Candidate edges show plausible static relationships. A matching channel name is not proof that a runtime message crossed that boundary.'));
    setCount(`${countLabel(contexts.length, 'context')} · ${countLabel(edges.length, 'relationship')}`, 'Selected context filtering is local to this report.'); return fragment;
  }
  function renderEvidence() {
    const entries = dataList('evidence').filter(match); const fragment = document.createDocumentFragment();
    fragment.append(dataTable(['Source', 'Location', 'Operation', 'Content identity'], entries, record => {
      const button = node('button', 'table-action', record.file || record.id); button.type = 'button';
      button.addEventListener('click', () => { state.selected = record.id; renderView(); $('record-detail')?.scrollIntoView({ block: 'nearest' }); });
      const location = `L${record.line ?? '?'}:${record.column ?? '?'} · ${record.start ?? '?'}–${record.end ?? '?'}`;
      const identity = node('span', 'mono', short(record.sha256)); identity.title = show(record.sha256);
      return [button, location, record.operation, identity];
    }, { emptyTitle: 'No matching evidence records', emptyDescription: 'Source facts are displayed only when supplied by the inspection.' }));
    const selected = dataList('evidence').find(entry => entry.id === state.selected);
    if (selected) fragment.append(detail(selected, `Source record · ${selected.file || selected.id}`));
    setCount(countLabel(entries.length, 'source record'), 'Ranges identify supplied source positions, not runtime execution.'); return fragment;
  }
  function renderFindings() {
    const findings = dataList('findings').filter(match); const unknowns = dataList('unknowns').filter(match); const list = node('div', 'insight-list');
    for (const item of [...findings.map(entry => ({ ...entry, entryType: 'finding' })), ...unknowns.map(entry => ({ ...entry, entryType: 'unknown' }))].slice(0, 400)) {
      const article = node('article', `insight ${item.entryType}`); const content = node('div');
      article.append(node('span', 'insight-symbol')); content.append(node('h3', '', item.title || item.code || item.id || 'Supplied finding'), node('p', '', item.detail || item.description || item.message));
      if (item.file) content.append(node('p', 'context-file', item.file));
      if (array(item.evidence_ids).length) { const links = node('div', 'insight-links'); for (const id of item.evidence_ids) links.append(evidenceAction(id)); content.append(links); }
      article.append(content, badge(item.entryType === 'unknown' ? 'unknown' : item.severity || 'finding')); list.append(article);
    }
    setCount(`${countLabel(findings.length, 'finding')} · ${countLabel(unknowns.length, 'unknown')}`, 'Unknowns remain visible in every export.');
    return findings.length || unknowns.length ? list : empty('No matching findings or unknowns', 'An empty filtered list does not establish complete runtime coverage.');
  }
  function renderExperiments() {
    const fragment = document.createDocumentFragment(); const planner = state.data.planner; const hypotheses = array(state.data.case?.hypotheses).filter(match);
    if (planner) {
      const banner = node('div', `status-banner${planner.status === 'model_incomplete' ? ' is-unknown' : ''}`); const copy = node('div');
      copy.append(node('strong', '', show(planner.status).replaceAll('_', ' ')), node('p', '', 'Probe ranking is a worst-case partition heuristic, not a probability or an automatically executed experiment.')); banner.append(copy, badge(planner.status)); fragment.append(banner);
      const ranked = array(planner.ranked).filter(match); const list = node('div', 'probe-list');
      ranked.forEach((probe, index) => {
        const id = probe.probe_id || probe.id || probe.probe?.id;
        const original = array(state.data.case?.probes).find(item => item.id === id);
        const article = node('article', 'probe'); const heading = node('div', 'probe-heading'); heading.append(node('span', 'probe-rank', String(index + 1).padStart(2, '0')), node('h3', '', probe.label || probe.probe?.label || original?.label || id)); article.append(heading);
        const facts = node('div', 'probe-facts');
        for (const [label, value] of [['Score', probe.score], ['Cost', probe.cost], ['Worst survivors', probe.worst_survivors], ['Gain', probe.gain]]) { if (value === undefined) continue; const span = node('span', '', `${label} `); span.append(node('strong', '', value)); facts.append(span); }
        article.append(facts); const details = node('details', 'probe-detail'); details.append(node('summary', 'table-action', 'Inspect ranked probe'), node('pre', 'json-block', pretty({ ranking: probe, definition: original || null }))); article.append(details); list.append(article);
      });
      fragment.append(ranked.length ? list : empty('No admissible ranked probes', 'Inspect the planner status and ignored observations before choosing another action.'));
    }
    if (state.data.case) {
      fragment.append(node('h3', 'subheading', 'Candidate explanations'), dataTable(['Hypothesis', 'Survival state', 'Predicted observations'], hypotheses, hypothesis => [hypothesis.label || hypothesis.id, badge(array(planner?.surviving_ids).includes(hypothesis.id) ? 'surviving' : planner ? 'not surviving' : 'supplied'), node('span', 'mono', pretty(hypothesis.predictions))]));
      const observations = array(state.data.case.observations).filter(match);
      if (observations.length) fragment.append(node('h3', 'subheading', 'Supplied observations'), dataTable(['Probe', 'Outcome', 'Authority', 'Source'], observations, observation => [observation.probe_id, observation.outcome, badge(observation.authority), observation.source]));
    }
    if (array(planner?.ignored_observations).length) fragment.append(detail(planner.ignored_observations, 'Ignored / inapplicable observations'));
    setCount(`${countLabel(array(planner?.ranked).length, 'ranked probe')} · ${countLabel(hypotheses.length, 'hypothesis', 'hypotheses')}`, 'The viewer does not launch or attach to targets.'); return fragment;
  }
  function renderVerification() {
    const report = state.data.verification; const fragment = document.createDocumentFragment(); const banner = node('div', `status-banner${report.status === 'fail' ? ' is-fail' : report.status === 'unknown' ? ' is-unknown' : ''}`); const copy = node('div');
    copy.append(node('strong', '', `Finite contract: ${show(report.status)}`), node('p', '', 'This verdict applies to the supplied cases, receipts and comparison rules.')); banner.append(copy, badge(report.status)); fragment.append(banner);
    const records = array(report.cases).filter(match);
    fragment.append(dataTable(['Case', 'Verdict', 'Recorded detail'], records, record => {
      const button = node('button', 'table-action', record.id || record.case_id); button.type = 'button'; button.addEventListener('click', () => { state.selected = record.id || record.case_id; renderView(); $('record-detail')?.scrollIntoView({ block: 'nearest' }); });
      return [button, badge(record.status || record.verdict || 'unknown'), show(record.reason || record.reasons || record.differences || record.detail || record.message || 'Inspect the supplied result')];
    }, { emptyTitle: 'No matching comparison cases' }));
    const selected = array(report.cases).find(item => (item.id || item.case_id) === state.selected);
    if (selected) fragment.append(detail(selected, 'Selected comparison case'));
    fragment.append(node('p', 'panel-note', 'A finite pass does not prove whole-program equivalence. Reported/imported receipts retain their authority; content integrity is not independent runtime authentication.'));
    setCount(countLabel(records.length, 'comparison case'), 'Target-versus-reconstruction checks verify behavior.'); return fragment;
  }
  function renderReduction() {
    const report = state.data.reduction; const fragment = document.createDocumentFragment(); const banner = node('div', `status-banner${report.status === 'flaky_oracle' || report.status === 'unknown' ? ' is-unknown' : ''}`); const copy = node('div');
    copy.append(node('strong', '', show(report.status).replaceAll('_', ' ')), node('p', '', `Minimality: ${show(report.minimality).replaceAll('-', ' ')}. The same failure oracle and reset conditions must remain applicable.`)); banner.append(copy, badge(report.status)); fragment.append(banner);
    const sequence = node('div', 'sequence'); array(report.sequence).forEach((step, index) => { const card = node('div', 'sequence-step'); card.append(node('span', '', String(index + 1).padStart(2, '0')), node('strong', '', show(step))); if (match(step)) sequence.append(card); });
    fragment.append(sequence.childNodes.length ? sequence : empty('No matching retained steps', 'The supplied reduced sequence is empty or does not match the search.'));
    const receipts = array(report.receipts).filter(match);
    if (receipts.length) fragment.append(node('h3', 'subheading', 'Reduction receipts'), dataTable(['Attempt', 'Status', 'Supplied result'], receipts, (receipt) => [receipt.test ?? receipt.attempt ?? receipt.index ?? '—', badge(receipt.status || receipt.result?.status || 'recorded'), node('span', 'mono', pretty(receipt))]));
    fragment.append(node('p', 'panel-note', 'One-minimal applies only to the declared removal operations and tested budget. It is not a claim that this is the globally shortest failure.'));
    setCount(`${countLabel(array(report.sequence).length, 'retained step')} · ${show(report.tests)} oracle tests`, 'Reset, preconditions and failure identity stay part of the reproduction.'); return fragment;
  }
  function renderView() {
    const entry = sectionDefinitions().find(item => item.id === state.view); const index = sectionDefinitions().findIndex(item => item.id === state.view) + 1;
    $('section-code').textContent = `${String(index).padStart(2, '0')} / ${state.view.toUpperCase()}`; $('section-title').textContent = entry?.label || 'Overview';
    $('filter-bar').hidden = true; $('filter-bar').replaceChildren();
    let content;
    if (state.view === 'boundaries') content = renderBoundaries();
    else if (state.view === 'evidence') content = renderEvidence();
    else if (state.view === 'findings') content = renderFindings();
    else if (state.view === 'experiments') content = renderExperiments();
    else if (state.view === 'verification') content = renderVerification();
    else if (state.view === 'reduction') content = renderReduction();
    else if (state.view === 'payload') { const wrap = node('div', 'raw-wrap'); wrap.append(node('pre', 'json-block', pretty(state.data))); content = wrap; setCount('Complete supplied payload', 'Export JSON retains every supplied field.'); }
    else content = renderOverview();
    $('view-content').replaceChildren(content);
    $('report-search').disabled = ['overview', 'payload'].includes(state.view);
  }
  function render() { renderNavigation(); renderView(); }
  try {
    const parsed = JSON.parse($('rpm-data').textContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema_version !== 1) throw new Error('Expected a schema_version 1 report payload.');
    state.data = parsed; document.title = `${parsed.title || 'Case workbench'} · REA Pro Max`;
    $('case-title').textContent = parsed.title || 'Case workbench'; $('breadcrumb-title').textContent = parsed.title || 'Case workbench';
    const artifact = dataOf().artifact || parsed.case?.target || {};
    $('target-label').textContent = artifact.label || artifact.path?.split(/[\\/]/u).filter(Boolean).pop() || parsed.case?.id || parsed.title || 'Supplied case';
    $('target-kind').textContent = show(artifact.kind || parsed.kind).replaceAll('_', ' ');
    $('case-description').textContent = parsed.case?.goal || (typeof parsed.narrative === 'string' ? parsed.narrative : parsed.inspection ? 'Follow the artifact’s contexts, candidate boundaries and exact source records. Keep unresolved questions in view.' : 'Inspect the supplied experiment, verification and reduction results.');
    $('scope-label').textContent = parsed.inspection ? 'STATIC ARTIFACT INSPECTION' : parsed.kind === 'lab' ? 'RECORDED LAB RESULTS' : 'SUPPLIED CASE DATA';
    $('scope-detail').textContent = 'Read-only local view · no target code executed by this page';
    $('export-json').disabled = false;
    $('export-json').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([pretty(state.data) + '\n'], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = 'rea-pro-max-report.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); hint('Complete supplied payload exported.'); });
    $('report-search').addEventListener('input', () => { state.query = $('report-search').value.normalize('NFKC').toLowerCase().trim(); renderView(); });
    renderMetrics(); render();
  } catch (error) {
    $('load-error').textContent = `This report could not be read: ${error.message}`; $('load-error').hidden = false;
    $('case-description').textContent = 'Check the report payload or regenerate the HTML with the toolkit.'; $('view-content').replaceChildren(empty('Report data unavailable', 'No inspection or verification result has been inferred.')); setCount('No data loaded');
  }
})();
