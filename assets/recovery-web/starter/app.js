(function install(global) {
  'use strict';

  const records = [
    { id: 'alpha', title: 'Inbox triage', summary: 'Decide what needs attention before stand-up.', status: 'open', tags: ['ops', 'daily'] },
    { id: 'bravo', title: 'Release checklist', summary: 'Confirm the build can ship.', status: 'done', tags: ['release', 'qa'] },
    { id: 'charlie', title: 'Café handoff', summary: 'Keep the Tokyo support notes with the handoff.', status: 'open', tags: ['東京', 'support'] },
    { id: 'delta', title: 'Offline export', summary: 'Prepare a local copy for review.', status: 'done', tags: ['privacy', 'export'] },
  ];
  const FILTERS = new Set(['all', 'open', 'done']);
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').trim();
  const copy = state => ({ ...state, results: state.results.map(record => ({ ...record, tags: [...record.tags] })) });
  const matches = (query, filter) => {
    const needle = normalize(query);
    const status = FILTERS.has(filter) ? filter : 'all';
    return records.filter(record => (status === 'all' || record.status === status) && normalize([record.title, record.summary, ...record.tags].join(' ')).includes(needle));
  };
  const delay = query => normalize(query) === 'slow' ? 180 : normalize(query) === 'fast' ? 20 : 45;

  // Intentionally incomplete starter: it never reads or writes storage and every
  // response commits, even when an older delayed callback arrives last.
  function createModel({ schedule = global.setTimeout, cancel = global.clearTimeout } = {}) {
    let state = { query: '', filter: 'all', status: 'ready', error: null, results: matches('', 'all') };
    let active = null;
    function snapshot() { return copy(state); }
    function search(query = state.query, filter = state.filter) {
      const nextQuery = String(query).slice(0, 80);
      const nextFilter = FILTERS.has(filter) ? filter : 'all';
      state = { ...state, query: nextQuery, filter: nextFilter, status: 'loading', error: null };
      return new Promise(resolve => {
        const timer = schedule(() => {
          const needle = normalize(nextQuery);
          const result = matches(nextQuery, nextFilter);
          // The error is accidentally rendered as an empty result in this starter.
          state = { ...state, status: needle === 'error' || result.length === 0 ? 'success' : 'success', error: null, results: result };
          active = null;
          resolve(snapshot());
        }, delay(nextQuery));
        active = { timer, resolve };
      });
    }
    function cancelSearch() {
      if (active) cancel(active.timer);
      state = { ...state, status: 'cancelled' };
      return snapshot();
    }
    return { state: snapshot, search, cancel: cancelSearch, setQuery: value => search(value, state.filter), setFilter: value => search(state.query, value) };
  }

  function mount(doc) {
    const form = doc.querySelector('#search-form');
    const search = doc.querySelector('#search');
    const filter = doc.querySelector('#filter');
    const status = doc.querySelector('#status');
    const resultList = doc.querySelector('#results');
    const cancelButton = doc.querySelector('#cancel');
    if (!form || !search || !filter || !status || !resultList) return null;
    const model = createModel();
    const render = state => {
      search.value = state.query;
      filter.value = state.filter;
      status.textContent = state.status === 'loading' ? 'Searching locally…' : `Loaded ${state.results.length} result${state.results.length === 1 ? '' : 's'}.`;
      resultList.replaceChildren();
      if (!state.results.length) {
        const item = doc.createElement('li');
        item.className = 'empty';
        item.dataset.state = 'success';
        item.textContent = 'Nothing here yet.';
        resultList.append(item);
      } else {
        for (const record of state.results) {
          const item = doc.createElement('li');
          item.className = 'result';
          item.dataset.id = record.id;
          item.innerHTML = `<p class="result-title"></p><p class="result-summary"></p><div class="result-meta"></div>`;
          item.querySelector('.result-title').textContent = record.title;
          item.querySelector('.result-summary').textContent = record.summary;
          const meta = item.querySelector('.result-meta');
          const chip = doc.createElement('span');
          chip.className = 'chip';
          chip.textContent = record.status;
          meta.append(chip);
          resultList.append(item);
        }
      }
      cancelButton.hidden = state.status !== 'loading';
    };
    const run = () => { render(model.state()); model.search(search.value, filter.value).then(render); };
    form.addEventListener('submit', event => { event.preventDefault(); run(); });
    search.addEventListener('input', run);
    filter.addEventListener('change', run);
    cancelButton.addEventListener('click', () => render(model.cancel()));
    render(model.state());
    global.__rpmWebModel = model;
    return model;
  }

  global.__rpmWeb = { createModel, matching: matches, normalize, records: records.map(record => ({ ...record, tags: [...record.tags] })) };
  if (typeof document !== 'undefined' && document.querySelector) mount(document);
})(globalThis);
