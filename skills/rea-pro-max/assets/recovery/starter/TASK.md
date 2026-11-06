# Recover a save operation that survives worker restart

This receiving project is a runnable Manifest V3 extension with a deliberate defect: its state and mutation receipts live only in the worker's memory. Normal save/read and page-reopen examples can succeed, while a real worker restart loses the result.

Repair the receiving implementation against [contract.json](contract.json). Preserve the existing message protocol and usable UI. Deliver the edited extension, a reproducible command for actual-browser replay, the resulting evidence and any unverified behavior. The durable reference is an observation target, not a file to copy into this project.

Start by loading this directory unpacked in an isolated Chromium profile, or by using REA Pro Max's runtime recovery workflow. Use `runner.html` as the extension page. All messages are local; no credentials, websites or host permissions are needed.

A successful warm save is insufficient. Demonstrate that a completed mutation and its request ID survive a qualified worker stop/restart, that retry does not reapply an old operation, and that invalid inputs preserve state. Keep page reopen, forced termination and natural idle/wake evidence separate. The UI does not poll or hold a port open.

This owned fixture is intentionally small. Its contract does not claim recovery of arbitrary extensions, proof of whole-program equivalence or correctness during a storage operation interrupted before acknowledgement.
