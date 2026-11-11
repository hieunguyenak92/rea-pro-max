(function install(global) {
  'use strict';

  const records = [
    { id: 'alpha', title: 'Inbox triage', summary: 'Decide what needs attention before stand-up.', status: 'open', tags: ['ops', 'daily'] },
    { id: 'bravo', title: 'Release checklist', summary: 'Confirm the build can ship.', status: 'done', tags: ['release', 'qa'] },
    { id: 'charlie', title: 'Café handoff', summary: 'Keep the Tokyo support notes with the handoff.', status: 'open', tags: ['東京', 'support'] },
    { id: 'delta', title: 'Offline export', summary: 'Prepare a local copy for review.', status: 'done', tags: ['privacy', 'export'] },
  ];
  const STORAGE_KEY = 'rpm-web-filter-v1';
  const FILTERS = new Set(['all', 'open', 'done']);
  const DELAYS = { default: 45, slow: 180, fast: 20, error: 65 };

  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').trim();
  const copyRecords = value => value.map(record => ({ ...record, tags: [...record.tags] }));
  const copyState = state => ({ ...state, results: copyRecords(state.results) });
  const delayFor = query => DELAYS[normalize(query)] ?? (normalize(query) ? DELAYS.default : 20);
  const matching = (source, query, filter) => {
    const needle = normalize(query);
    const status = FILTERS.has(filter) ? filter : 'all';
    return source.filter(record => {
      const searchable = normalize([record.title, record.summary, ...record.tags].join(' '));
      return (status === 'all' || record.status === status) && searchable.includes(needle);
    });
  };

  function readPreferences(storage) {
    if (!storage || typeof storage.getItem !== 'function') return { query: '', filter: 'all' };
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return {
        query: typeof parsed.query === 'string' ? parsed.query.slice(0, 80) : '',
        filter: FILTERS.has(parsed.filter) ? parsed.filter : 'all',
      };
    } catch {
      return { query: '', filter: 'all' };
    }
  }

  function createModel({ storage = null, schedule = global.setTimeout, cancel = global.clearTimeout, source = records } = {}) {
    const initial = readPreferences(storage);
    let state = { query: initial.query, filter: initial.filter, status: 'ready', error: null, results: matching(source, initial.query, initial.filter) };
    let sequence = 0;
    let active = null;

    const save = () => {
      if (!storage || typeof storage.setItem !== 'function') return;
      try { storage.setItem(STORAGE_KEY, JSON.stringify({ query: state.query, filter: state.filter })); } catch { /* private mode or quota */ }
    };
    const snapshot = () => copyState(state);
    const finish = (next, resolve) => { state = next; active = null; resolve(snapshot()); };

    function search(query = state.query, filter = state.filter) {
      const nextQuery = String(query).slice(0, 80);
      const nextFilter = FILTERS.has(filter) ? filter : 'all';
      if (active) {
        cancel(active.timer);
        active.resolve({ ...snapshot(), status: 'cancelled', cancelled: true });
        active = null;
      }
      const id = ++sequence;
      state = { ...state, query: nextQuery, filter: nextFilter, status: 'loading', error: null };
      save();
      return new Promise(resolve => {
        const timer = schedule(() => {
          if (id !== sequence) return resolve({ ...snapshot(), status: 'cancelled', cancelled: true });
          const needle = normalize(nextQuery);
          if (needle === 'error') {
            finish({ ...state, status: 'error', error: 'synthetic_transport', results: [] }, resolve);
            return;
          }
          const result = matching(source, nextQuery, nextFilter);
          finish({ ...state, status: result.length ? 'success' : 'empty', error: null, results: result }, resolve);
        }, delayFor(nextQuery));
        active = { id, timer, resolve };
      });
    }

    function cancelSearch() {
      if (!active) {
        state = { ...state, status: 'cancelled' };
        return snapshot();
      }
      cancel(active.timer);
      active.resolve({ ...snapshot(), status: 'cancelled', cancelled: true });
      active = null;
      sequence += 1;
      state = { ...state, status: 'cancelled' };
      return snapshot();
    }

    return {
      state: snapshot,
      search,
      cancel: cancelSearch,
      setQuery: value => search(value, state.filter),
      setFilter: value => search(state.query, value),
      storageKey: STORAGE_KEY,
    };
  }

  function mount(doc, storage) {
    const form = doc.querySelector('#search-form');
    const search = doc.querySelector('#search');
    const filter = doc.querySelector('#filter');
    const submit = doc.querySelector('#submit');
    const cancelButton = doc.querySelector('#cancel');
    const status = doc.querySelector('#status');
    const resultList = doc.querySelector('#results');
    if (!form || !search || !filter || !status || !resultList) return null;
    const model = createModel({ storage });

    const announce = state => {
      const messages = { ready: 'Ready.', loading: 'Searching locally…', success: `${state.results.length} project${state.results.length === 1 ? '' : 's'} found.`, empty: 'No projects match that search.', error: 'Could not load projects. Try again.', cancelled: 'Search cancelled.' };
      status.textContent = messages[state.status] || 'Ready.';
      status.dataset.state = state.status;
      cancelButton.hidden = state.status !== 'loading';
      if (submit) submit.disabled = state.status === 'loading';
      search.value = state.query;
      filter.value = state.filter;
    };
    const render = state => {
      announce(state);
      resultList.replaceChildren();
      if (state.status === 'error') {
        const item = doc.createElement('li');
        item.className = 'error';
        item.dataset.state = 'error';
        item.textContent = 'Could not load projects. Try again.';
        resultList.append(item);
      } else if (state.status === 'empty') {
        const item = doc.createElement('li');
        item.className = 'empty';
        item.dataset.state = 'empty';
        item.textContent = 'No projects match that search.';
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
          const stateChip = doc.createElement('span');
          stateChip.className = 'chip';
          stateChip.textContent = record.status;
          meta.append(stateChip);
          for (const tag of record.tags) {
            const chip = doc.createElement('span');
            chip.className = 'chip';
            chip.textContent = tag;
            meta.append(chip);
          }
          resultList.append(item);
        }
      }
    };
    const run = () => { render(model.state()); model.search(search.value, filter.value).then(render); };
    form.addEventListener('submit', event => { event.preventDefault(); run(); });
    search.addEventListener('input', run);
    filter.addEventListener('change', run);
    cancelButton.addEventListener('click', () => render(model.cancel()));
    search.addEventListener('keydown', event => { if (event.key === 'Escape') render(model.cancel()); });
    render(model.state());
    global.__rpmWebModel = model;
    return model;
  }

  global.__rpmWeb = { createModel, matching, normalize, records: copyRecords(records), storageKey: STORAGE_KEY };
  if (typeof document !== 'undefined' && document.querySelector) mount(document, typeof localStorage === 'undefined' ? null : localStorage);
})(globalThis);
