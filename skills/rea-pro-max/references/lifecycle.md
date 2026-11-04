# Lifecycle experiments

Separate page reload, popup close/open, worker cold start, renderer restart, main-process restart, browser-profile restart and device/app restart. Each persistence claim needs the corresponding boundary and reset.

For MV3, popup/content/page/worker contexts have different lifetimes and APIs. Service-worker global variables can disappear on termination; extension storage has different lifetime semantics. Record the selected extension build/profile/context and whether an observer was attached. DevTools inspection can keep the worker active. A handle reused by an automation library does not establish a process/worker boot identity.

Use a disposable owned fixture/profile for destructive reset or controlled termination. Observe a changed qualified boot identity after the normal waking action and retained/lost state; classify forced termination separately from natural idle suspension. Do not poll/evaluate the worker while waiting for an idle boundary. Host UI/runtime tool policies and target access still apply.

For Electron, renderer UI, preload bridge, main handler and local file output are distinct boundaries. A renderer reload does not prove main-process persistence. Preserve request/event correlations, ordering requirements, duplicate effects and callback failures. Temporal proximity and equal strings alone cannot establish causality.
