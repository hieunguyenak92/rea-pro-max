import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes } from '../examples/recovered-search/search.mjs';
const records = [{id:'0001',text:'Café at sunrise'},{id:'0002',text:'東京 planning notes'},{id:'0003',text:'A decision that survives reload'}];
for (const [name,query,expected] of [
  ['empty preserves source order','','0001,0002,0003'],
  ['fullwidth Latin','Ｃａｆé','0001'],
  ['decomposed accent','Cafe\u0301','0001'],
  ['Japanese input','東京','0002'],
  ['case normalization','DECISION','0003'],
  ['accents are significant','Cafe',''],
  ['whitespace is not silently trimmed',' Café',''],
  ['no matches is empty','missing',''],
]) test(`recovered search: ${name}`,()=>assert.equal(searchNotes(records,query).map(x=>x.id).join(','),expected));
test('recovered search retains duplicates and neither sorts nor mutates source',()=>{
  const input=[{id:'0020',text:'Same'},{id:'0001',text:'same'},{id:'0001',text:'Same'}];
  const before=JSON.stringify(input); assert.deepEqual(searchNotes(input,'SAME').map(x=>x.id),['0020','0001','0001']); assert.equal(JSON.stringify(input),before);
});
