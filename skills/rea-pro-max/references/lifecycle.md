# Lifecycle experiments

Separate page reload, popup close/open, worker cold start, renderer restart, main-process restart, browser-profile restart and device/app restart. Each persistence claim needs the corresponding boundary and reset.

For MV3, popup/content/page/worker contexts have different lifetimes and APIs. Service-worker global variables can disappear on termination; extension storage has different lifetime semantics. Record the selected extension build/profile/context and whether an observer was attached. DevTools inspection can keep the worker active. A handle reused by an automation library does not establish a process/worker boot identity.

Use a disposable owned fixture/profile for destructive reset or controlled termination. Observe a changed qualified boot identity after the normal waking action and retained/lost state; classify forced termination separately from natural idle suspension. Do not poll/evaluate the worker while waiting for an idle boundary. Host UI/runtime tool policies and target access still apply.

For Electron, renderer UI, preload bridge, main handler and local file output are distinct boundaries. A renderer reload does not prove main-process persistence. Preserve request/event correlations, ordering requirements, duplicate effects and callback failures. Temporal proximity and equal strings alone cannot establish causality.

## Built-in Chromium capture

The optional provider supports `rpm-kv-v1` with `message`, `page-reopen`, `worker-stop`, `idle` and `storage-snapshot` actions. It creates a fresh profile and extension snapshot for each target. The scenario uses an extension page to send messages; it does not attach a debugger to the worker. `worker-stop` enables the ServiceWorker domain to request a forced stop, observes stopped status and checks a changed boot ID after wake. Natural idle waits without worker polling, checks worker-target absence before wake, then checks a changed boot ID. A missing qualification leaves incomplete/unknown evidence.

Boot IDs are part of the documented owned protocol and remain target-reported evidence. They are retained in raw responses; only their declared top-level observational field is excluded from finite message comparison. Reused automation Worker objects or absence of a new serviceworker event do not disprove a restart. Instrumentation and browser version matter; do not promote one observed build into a guarantee for every Chromium version.

The message contract covers serial operations and persistence after completed acknowledgement. Mid-write termination, storage corruption/migration, arbitrary concurrent writers, browser-profile restart and generic UI/network/file equivalence are outside this first provider's acceptance scope. The host agent must use another qualified tool/adapter for claims outside it.
