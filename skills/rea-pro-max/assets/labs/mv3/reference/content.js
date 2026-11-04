// This fixture is injected only into the disposable local lab origin.
if (document.querySelector('[data-rpm-owned-fixture]')) {
  const send = document.createElement('button'); send.textContent = 'Clip selected fixture text';
  send.addEventListener('click', async () => {
    const text = window.getSelection().toString() || 'Synthetic article clip';
    const response = await chrome.runtime.sendMessage({ lab: 'rpm-owned-lab', type: 'save', text });
    document.querySelector('#clip-result').textContent = JSON.stringify(response, null, 2);
  });
  document.body.append(send);
}
