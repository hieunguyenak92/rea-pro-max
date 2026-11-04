document.querySelector('#export').addEventListener('click', async () => {
  try {
    const result = await window.rpmLab.exportRecords([{ id: '0001', text: 'Café at sunrise' }, { id: '0002', text: '東京 planning notes' }]);
    document.querySelector('#result').textContent = JSON.stringify({ evidence_kind: 'owned-electron-runtime-response', ...result }, null, 2);
  } catch (error) { document.querySelector('#result').textContent = error.message; }
});
