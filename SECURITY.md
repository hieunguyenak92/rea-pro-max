# Security

The toolkit reads local artifacts and writes investigation files. Static `inspect` does not execute target code. `demo` executes this project's owned scripts under a controlled model; `shrink` explicitly imports and executes the oracle module supplied by the user with Node's permissions. The VM model is not a sandbox for untrusted applications.

Reports and receipts can contain source, paths and observed values. Inspect them before sharing. The CLI performs no telemetry upload; AI hosts and external investigation tools follow their own policies. See [privacy and execution boundaries](docs/PRIVACY.md).

## Report a vulnerability

If GitHub's **Security → Advisories → Report a vulnerability** option is available for this repository, use it for a sensitive report. Otherwise, open an issue requesting a private contact without including the exploit or private data. Do not publish credentials, proprietary binaries or another user's captured session in an issue.

Include the affected version, operating system, Node version, command, expected boundary and a minimal owned reproduction. Distinguish an unintended execution or file-access issue from the documented execution of an explicitly supplied oracle. No response-time or supported-version commitment is implied by this document.
