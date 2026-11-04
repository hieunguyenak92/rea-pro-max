// Owned reference fixture. No target application or remote service is contacted.
const bootId = crypto.randomUUID();
let pending = Promise.resolve();
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || message.lab !== 'rpm-owned-lab') return false;
  pending = pending.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get({ clips: [], nextId: 1 });
    if (message.type === 'save') {
      const text = String(message.text ?? '').trim();
      if (!text || text.length > 2000) throw new Error('Use 1–2000 non-whitespace characters.');
      stored.clips.push({ id: String(stored.nextId++).padStart(4, '0'), text });
      await chrome.storage.local.set(stored);
    } else if (message.type === 'reset') {
      stored.clips = []; stored.nextId = 1;
      await chrome.storage.local.set(stored);
    } else if (message.type !== 'read') throw new Error('Unknown message type.');
    respond({ ok: true, boot_id: bootId, clips: stored.clips, context: 'service-worker' });
  }).catch(error => respond({ ok: false, error: error.message, boot_id: bootId }));
  return true;
});
