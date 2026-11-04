import { searchNotes } from './search.mjs';
const records = [{id:'0001',text:'Café at sunrise'},{id:'0002',text:'東京 planning notes'},{id:'0003',text:'A decision that survives reload'}];
const input = document.querySelector('#query');
function update() {
  const results = searchNotes(records, input.value);
  document.querySelector('#results').replaceChildren(...results.map(record => {
    const item = document.createElement('li'); item.textContent = `${record.id} · ${record.text}`; return item;
  }));
  document.querySelector('#receipt').textContent = JSON.stringify({query:input.value, ids:results.map(record=>record.id), behavior:'NFKC + en-US lowercase substring, stable input order'},null,2);
}
input.addEventListener('input',update); update();
