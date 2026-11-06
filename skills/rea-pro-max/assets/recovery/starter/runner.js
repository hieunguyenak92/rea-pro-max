const key = document.querySelector('#key');
const value = document.querySelector('#value');
const status = document.querySelector('#status');
const response = document.querySelector('#response');
async function send(message) {
  status.textContent = 'Waiting for worker…';
  try {
    const result = await chrome.runtime.sendMessage(message);
    response.textContent = JSON.stringify(result, null, 2);
    status.textContent = result?.ok ? 'Worker acknowledged.' : 'Worker returned an error.';
  } catch (error) { status.textContent = error.message; }
}
document.querySelector('#save').addEventListener('click', () => send({ type: 'put', key: key.value, value: value.value, requestId: crypto.randomUUID() }));
document.querySelector('#read').addEventListener('click', () => send({ type: 'get', key: key.value }));
document.querySelector('#remove').addEventListener('click', () => send({ type: 'remove', key: key.value, requestId: crypto.randomUUID() }));
document.querySelector('#snapshot').addEventListener('click', () => send({ type: 'snapshot' }));
// No polling, ports or startup message: the page must not keep the worker alive.
