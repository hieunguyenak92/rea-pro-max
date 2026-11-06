# Recovered local save operation

This receiving extension implements [contract.json](contract.json) independently
from the documented message behavior. Its UI is copied from the starter. Its
worker was authored without reading the durable reference, regression worker or
acceptance corpus.

Load this directory as an unpacked Manifest V3 extension and open `runner.html`.
Only the `storage` permission is used. Data and the first 256 successful mutation
receipts are persisted in one `chrome.storage.local` item before acknowledgement.
No network request, startup polling or long-lived port is used.

Run the independent storage-model tests from the repository root:

```sh
node --test tests/receiving-recovery.test.mjs
```

These tests exercise the actual worker script with a controlled storage model.
Reinitializing that model's worker context is not actual Chromium lifecycle
evidence. Actual page reopen, forced worker termination and natural idle/wake
replay must be recorded separately by the runtime workflow; a fresh `boot_id` is
required to qualify a worker restart. This implementation does not claim
correctness for a storage write interrupted before acknowledgement, corrupted
storage or arbitrary concurrent external writers.
