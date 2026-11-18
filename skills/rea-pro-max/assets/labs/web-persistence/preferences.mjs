const preference = document.querySelector('#value');
const status = document.querySelector('#status');
let sequence = 0;
let rendered = 0;

async function save(value, defer = false) {
  const revision = ++sequence;
  const response = await fetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, revision, defer }),
  });
  await response.json();
  if (revision < rendered) return;
  rendered = revision;
  status.textContent = response.ok ? 'Saved' : 'Save failed';
}

document.querySelector('#save').onclick = () => save(preference.value);
document.querySelector('#race').onclick = () => Promise.all([save('earlier value', true), save(preference.value)]);
document.querySelector('#read').onclick = async () => {
  const response = await fetch('/api/preferences');
  const result = await response.json();
  status.textContent = response.ok ? result.value : 'No saved preference';
};
