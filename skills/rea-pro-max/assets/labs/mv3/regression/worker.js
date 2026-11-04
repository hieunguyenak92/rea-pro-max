// Deliberately faulty owned fixture: state lives only in one worker instance.
const bootId = crypto.randomUUID();
let clips = [], nextId = 1;
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || message.lab !== 'rpm-owned-lab') return false;
  if (message.type === 'save') {
    const text = String(message.text ?? '').trim();
    if (!text || text.length > 2000) { respond({ ok: false, error: 'Use 1–2000 non-whitespace characters.', boot_id: bootId }); return false; }
    clips.push({ id: String(nextId++).padStart(4, '0'), text });
  } else if (message.type === 'reset') { clips = []; nextId = 1; }
  else if (message.type !== 'read') { respond({ ok: false, error: 'Unknown message type.', boot_id: bootId }); return false; }
  respond({ ok: true, clips, boot_id: bootId, context: 'service-worker' }); return false;
});
