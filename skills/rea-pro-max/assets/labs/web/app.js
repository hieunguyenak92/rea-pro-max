const seed = [{ id: '0001', text: 'Café at sunrise' }, { id: '0002', text: '東京 planning notes' }, { id: '0003', text: 'A decision that survives reload' }];
let notes;
try { const saved = JSON.parse(localStorage.getItem('rpm-owned-notes') || 'null'); notes = Array.isArray(saved) ? saved : seed; } catch { notes = seed; }
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('en-US');
function render() {
  const query = normalize(document.querySelector('#search').value);
  const found = notes.filter(item => normalize(item.text).includes(query));
  document.querySelector('#results').replaceChildren();
  for (const note of found) { const li = document.createElement('li'); li.textContent = `${note.id} · ${note.text}`; document.querySelector('#results').append(li); }
  document.querySelector('#observation').textContent = JSON.stringify({ query, results: found, storage: 'localStorage', evidence_kind: 'owned-web-runtime-output' }, null, 2);
}
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#add').addEventListener('click', () => { const id = String(notes.length + 1).padStart(4, '0'); notes.push({ id, text: `Synthetic note ${id}` }); localStorage.setItem('rpm-owned-notes', JSON.stringify(notes)); render(); });
render();
