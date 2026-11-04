const byId = id => document.getElementById(id);
async function action(type) {
  try {
    const result = await chrome.runtime.sendMessage({ lab: 'rpm-owned-lab', type, text: byId('clip').value });
    if (!result?.ok) throw new Error(result?.error || 'The worker did not return a response.');
    byId('clips').replaceChildren();
    for (const clip of result.clips) {
      const li = document.createElement('li'); li.textContent = `${clip.id} · ${clip.text}`; byId('clips').append(li);
    }
    byId('status').textContent = `${result.clips.length} clip(s). Worker boot ${result.boot_id}.`;
    byId('receipt').textContent = JSON.stringify({ schema_version: 1, evidence_kind: 'visible-extension-response', action: type, observed_at: new Date().toISOString(), ...result }, null, 2);
  } catch (error) { byId('status').textContent = error.message; }
}
byId('save').addEventListener('click', () => action('save'));
byId('read').addEventListener('click', () => action('read'));
byId('reset').addEventListener('click', () => action('reset'));
