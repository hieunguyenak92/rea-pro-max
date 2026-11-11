(function bootstrap(global) {
  'use strict';

  const seed = [
    { id: 'alpha', title: 'Inbox triage', summary: 'Decide what needs attention before stand-up.', status: 'open', tags: ['ops', 'daily'] },
    { id: 'bravo', title: 'Release checklist', summary: 'Confirm the build can ship.', status: 'done', tags: ['release', 'qa'] },
    { id: 'charlie', title: 'Café handoff', summary: 'Keep the Tokyo support notes with the handoff.', status: 'open', tags: ['東京', 'support'] },
    { id: 'delta', title: 'Offline export', summary: 'Prepare a local copy for review.', status: 'done', tags: ['privacy', 'export'] },
  ];
  const STORAGE_KEY = 'rpm-web-filter-v1';
  const VALID_FILTERS = ['all', 'open', 'done'];
  const WAIT = new Map([['slow', 180], ['fast', 20], ['error', 65]]);
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').trim();
  const cloneRows = rows => rows.map(row => ({ ...row, tags: [...row.tags] }));
  const isFilter = value => VALID_FILTERS.includes(value);
  const delayFor = query => WAIT.get(normalize(query)) ?? (normalize(query) ? 45 : 20);
  const findRows = (rows, query, filter) => {
    const term = normalize(query);
    const selected = isFilter(filter) ? filter : 'all';
    return rows.filter(row => {
      const text = normalize([row.title, row.summary, ...row.tags].join(' '));
      return (selected === 'all' || row.status === selected) && text.includes(term);
    });
  };

  function loadSaved(storage) {
    if (!storage || typeof storage.getItem !== 'function') return { query: '', filter: 'all' };
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return { query: typeof value.query === 'string' ? value.query.slice(0, 80) : '', filter: isFilter(value.filter) ? value.filter : 'all' };
    } catch {
      return { query: '', filter: 'all' };
    }
  }

  class CatalogModel {
    constructor({ storage = null, schedule = global.setTimeout, cancel = global.clearTimeout, rows = seed } = {}) {
      const saved = loadSaved(storage);
      this.storage = storage;
      this.schedule = schedule;
      this.cancelTimer = cancel;
      this.rows = rows;
      this.serial = 0;
      this.pending = null;
      this.current = { query: saved.query, filter: saved.filter, status: 'ready', error: null, results: findRows(rows, saved.query, saved.filter) };
    }

    snapshot() { return { ...this.current, results: cloneRows(this.current.results) }; }
    state() { return this.snapshot(); }

    persist() {
      if (!this.storage || typeof this.storage.setItem !== 'function') return;
      try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ query: this.current.query, filter: this.current.filter })); } catch { /* unavailable storage is allowed */ }
    }

    settlePendingAsCancelled() {
      if (!this.pending) return;
      this.cancelTimer(this.pending.timer);
      this.pending.resolve({ ...this.snapshot(), status: 'cancelled', cancelled: true });
      this.pending = null;
    }

    search(query = this.current.query, filter = this.current.filter) {
      this.settlePendingAsCancelled();
      const nextQuery = String(query).slice(0, 80);
      const nextFilter = isFilter(filter) ? filter : 'all';
      const serial = ++this.serial;
      this.current = { ...this.current, query: nextQuery, filter: nextFilter, status: 'loading', error: null };
      this.persist();
      return new Promise(resolve => {
        const timer = this.schedule(() => {
          if (!this.pending || serial !== this.serial) {
            resolve({ ...this.snapshot(), status: 'cancelled', cancelled: true });
            return;
          }
          this.pending = null;
          if (normalize(nextQuery) === 'error') {
            this.current = { ...this.current, status: 'error', error: 'synthetic_transport', results: [] };
          } else {
            const results = findRows(this.rows, nextQuery, nextFilter);
            this.current = { ...this.current, status: results.length ? 'success' : 'empty', error: null, results };
          }
          resolve(this.snapshot());
        }, delayFor(nextQuery));
        this.pending = { serial, timer, resolve };
      });
    }

    cancel() {
      this.settlePendingAsCancelled();
      this.serial += 1;
      this.current = { ...this.current, status: 'cancelled' };
      return this.snapshot();
    }

    setQuery(value) { return this.search(value, this.current.filter); }
    setFilter(value) { return this.search(this.current.query, value); }
  }

  function renderResult(doc, row) {
    const item = doc.createElement('li');
    item.className = 'result';
    item.dataset.id = row.id;
    const title = doc.createElement('p');
    title.className = 'result-title';
    title.textContent = row.title;
    const summary = doc.createElement('p');
    summary.className = 'result-summary';
    summary.textContent = row.summary;
    const meta = doc.createElement('div');
    meta.className = 'result-meta';
    for (const value of [row.status, ...row.tags]) {
      const chip = doc.createElement('span');
      chip.className = 'chip';
      chip.textContent = value;
      meta.append(chip);
    }
    item.append(title, summary, meta);
    return item;
  }

  function mount(doc, storage) {
    const form = doc.querySelector('#search-form');
    const input = doc.querySelector('#search');
    const filter = doc.querySelector('#filter');
    const status = doc.querySelector('#status');
    const list = doc.querySelector('#results');
    const cancel = doc.querySelector('#cancel');
    if (!form || !input || !filter || !status || !list || !cancel) return null;
    const model = new CatalogModel({ storage });
    const render = state => {
      input.value = state.query;
      filter.value = state.filter;
      const messages = { ready: 'Ready.', loading: 'Searching locally…', success: `${state.results.length} project${state.results.length === 1 ? '' : 's'} found.`, empty: 'No projects match that search.', error: 'Could not load projects. Try again.', cancelled: 'Search cancelled.' };
      status.textContent = messages[state.status] || 'Ready.';
      status.dataset.state = state.status;
      cancel.hidden = state.status !== 'loading';
      list.replaceChildren();
      if (state.status === 'error') {
        const item = doc.createElement('li');
        item.className = 'error';
        item.dataset.state = 'error';
        item.textContent = 'Could not load projects. Try again.';
        list.append(item);
      } else if (state.status === 'empty') {
        const item = doc.createElement('li');
        item.className = 'empty';
        item.dataset.state = 'empty';
        item.textContent = 'No projects match that search.';
        list.append(item);
      } else {
        for (const row of state.results) list.append(renderResult(doc, row));
      }
    };
    const run = () => { render(model.snapshot()); model.search(input.value, filter.value).then(render); };
    form.addEventListener('submit', event => { event.preventDefault(); run(); });
    input.addEventListener('input', run);
    filter.addEventListener('change', run);
    input.addEventListener('keydown', event => { if (event.key === 'Escape') render(model.cancel()); });
    cancel.addEventListener('click', () => render(model.cancel()));
    render(model.snapshot());
    global.__rpmWebModel = model;
    return model;
  }

  const api = { CatalogModel, createModel: options => new CatalogModel(options), findRows, matching: findRows, normalize, records: cloneRows(seed), storageKey: STORAGE_KEY };
  global.__rpmWeb = api;
  if (typeof document !== 'undefined' && document.querySelector) mount(document, typeof localStorage === 'undefined' ? null : localStorage);
})(globalThis);
