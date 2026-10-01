# SwahiliPro VS Code coding-agent plan

Status: proposed implementation; documentation only.
Date: 2026-09-30.
Revised 2026-10-01 for Firebase Authentication, Firestore, and Next.js client authorization.
Inspected master commit: 0dc2d6b053bd5a0d08d090ea8e51c094ca8e5a67.
Companion plans:
- https://github.com/bonnieace/swahilipro_web/blob/docs/agent-platform-plan/docs/agent-platform-plan.md
- https://github.com/bonnieace/swahilipro-compiler/blob/docs/cli-agent-plan/docs/cli-agent-plan.md

## Goal and ownership

Provide a dedicated SwahiliPro chat sidebar alongside existing language tooling, with browser sign-in, shared credits, model selection, explicit file context, streamed responses, reviewed edits, approved commands, and resumable sessions. Add native VS Code Chat participation as a later integration. Website identity uses Firebase Authentication; native clients use Next.js-issued application grants; paid requests go through the Next.js gateway.

The Python agent engine lives in the compiler repository and ships in the same standalone swa binary already bundled by this extension. The extension owns editor UI, credentials, document buffers, and approval surfaces. The engine owns model/tool orchestration and protocol-independent policy. Next.js owns billing, model adapters, and backend authorization. Avoid a second TypeScript implementation of the agent loop.

## Verified current state

| File | Finding |
| --- | --- |
| package.json | CommonJS entry extension.js; version 0.1.2; publisher masota; VS Code ^1.88.0; only Programming Languages category; no chat views, authentication, or model contribution. |
| extension.js | Run File, Open REPL, New File, Enable CLI commands; runtimePath override or bundled runtime; PATH injection for new integrated terminals; optional copy to ~/.swahilipro/bin and user PATH setup. |
| diagnostics.js | Debounced swa check - subprocess on in-memory document text; compiler stderr mapped to diagnostics; generation counters reject stale results. No process timeout/output cap or complete process/timer disposal is evident. |
| hover.js and language files | Existing hover and SwahiliPro highlighting/configuration to retain. |
| scripts/package-with-runtime.js | Copies supplied binary under swa and swahilipro aliases, builds target VSIX, then removes generated runtime files. |
| .github/workflows/ci.yml | Node 20; npm install --no-package-lock; syntax/JSON checks, package listing, and runtime injection with a shell-script fake runtime. No editor integration test suite. |
| .github/workflows/package-platform.yml | Downloads compiler release asset by tag with compiler token; supports win32-x64, linux-x64, darwin-x64, darwin-arm64; optional Marketplace publication. |
| Repository tree | No AGENTS.md, lockfile, agent modules, chat frontend, or test directory. |

Existing Run File sends a swa command to an integrated shell; Open REPL uses the resolved binary directly. A configured runtime can differ from PATH's swa. Account/agent execution must use the exact resolved, validated binary through argv-based spawn, not terminal shell text.

No runtime or live account/model tests were executed for this documentation change.

## User experience

Installation keeps language features immediately usable. Add an Activity Bar SwahiliPro view and Open Chat command. Opening the sidebar shows Sign in to SwahiliPro, account information, or the current session; it never launches a browser merely because installation occurred.

Sidebar elements:
- Account menu, shared available credits, usage/account links, and sign out.
- New session, session list/resume/delete, model selector with server capabilities.
- Message composer, send/stop controls, optional English/Kiswahili preference.
- Explicit context chips for selection, active file, and user-selected files.
- Streaming answers, tool progress, errors, and usage summary.
- Readable change previews with Apply/Reject; command cards with Run/Reject.

Context inclusion is visible before sending; there is no default whole-workspace upload. Start chat without a folder for conversational help, and require a selected workspace root for repository tools. For multi-root workspaces, select a root per session; another root requires an explicit scope change. Keep the user's VS Code theme, keyboard navigation, screen-reader labels, and reduced-motion settings.

Chat remains available for general repository work, not only .swa files. Add Explain Selection and Fix SwahiliPro Diagnostic commands as contextual entry points. Syntax validation is identified as syntax checking, not correctness.

## Manifest and module changes

Add viewsContainers/activitybar and a WebviewView contribution, command/menus for openChat, signIn, signOut, newSession, attachSelection, and explainSelection. Use an appropriate bundled monochrome Activity Bar icon. Add descriptions/categories reflecting language support and AI assistance.

Keep existing commands and runtimePath setting. Make runtimePath and API/auth-origin settings restricted under Workspace Trust; only user-controlled configuration can choose a binary or credential destination. Do not let a repository redirect credentials or execute an arbitrary configured runtime silently.

Proposed modules:
| Module | Responsibility |
| --- | --- |
| src/chat/view.js and media/ | Bundled sidebar UI and validated messages |
| src/auth/session.js | Browser approval and application token lifecycle |
| src/agent/process.js | Runtime resolution, spawn, handshake, lifecycle |
| src/agent/protocol.js | JSON-lines framing, schemas, correlation, limits |
| src/workspace/context.js | Selected roots, file/selection snapshots, exclusions |
| src/workspace/edits.js | Diff previews, document versions, WorkspaceEdit |
| src/approvals.js | Exact tool/argument approvals, denials, cancellation |
| src/accounts.js | Gateway identity, credits, permitted model reads |
| src/sessions.js | Workspace-bound session UI and engine history references |

Keep CommonJS initially; do not make a TypeScript rewrite a prerequisite. Add a lockfile, lint, meaningful unit/integration tests, and a bundling step only as needed for the UI. Keep account and engine startup lazy so ordinary highlighting/hover remains fast and usable offline.

## Firebase accounts, client authorization, and SecretStorage

Use the same application authorization protocol as the CLI and web plan. Firebase handles browser account sign-in, not an OAuth authorization server for the extension.

On explicit Sign in, generate a verifier and send S256 challenge/client label to Next.js /api/v1/auth/client/start. Keep its high-entropy polling secret in host memory. Open the returned trusted website verification URL with vscode.env.openExternal and show the matching confirmation phrase/code. The user signs into Firebase and explicitly approves that request. Poll with bounded intervals/expiry, then complete using polling secret plus verifier; the server returns short-lived application access and rotating refresh credentials.

No callback URI or UriHandler token exchange is needed for the initial flow. This also supports remote-host login in a local browser using the shared Next.js approval/polling protocol. Do not claim RFC 8628/OAuth compliance for this application protocol. Test wrong verifier, stolen URL, approval to wrong account, denial, expiry, duplicate completion, polling limits, cancellation and multiple simultaneous sign-in attempts.

Store application refresh credentials in context.secrets; access credentials stay in memory where feasible. No tokens in globalState, webview state, settings, process arguments, logs or URLs. Isolate by trusted origin/account. Serialize refresh and follow the server's tested reuse and lost-response policy. Never request/store website passwords or Firebase Admin/service-account credentials.

The host passes only short-lived application credentials to the Python engine over private stdio IPC. Renewal stays in the host. CLI and extension use separate revocable grants with one Firebase UID and shared credit wallet; never copy refresh tokens between them.

Sign out cancels active work, clears SecretStorage and requests grant revocation. Account disable/delete/sign-out-everywhere must coordinate Firebase account state and Next.js grant invalidation. Firebase account-wide refresh-token revocation is not sufficient to revoke application credentials. Offline remote revocation remains unconfirmed and is reported clearly.

The extension uses Next.js for credits, models and inference, not direct Firestore financial writes. Trusted endpoint configuration is user-controlled and cannot be overridden by repository content.

## Shared compiler engine interface

Spawn the resolved bundled swa agent --stdio using child_process.spawn with no shell. Validate runtime version and protocol/capability handshake before sending credentials or workspace content. An older user-provided runtime must produce an actionable compatibility message while existing runtime commands continue working.

Use a versioned JSON-lines protocol for session start/resume, prompt, text/tool deltas, approvals, token renewal, cancellation, completion, and shutdown. Correlate session/request/tool IDs; cap frame size, buffered data, and stderr. Stdout is protocol-only. Unknown incompatible versions fail clearly.

Editor integration requires a host-tool adapter in the compiler engine protocol:
- Host reads supply current in-memory text and document versions, including unsaved buffers, subject to approved scope.
- Proposed edits are delivered to the host for preview and application.
- The host returns the actual post-edit text/hash or refusal to the engine.
- Commands run under a documented executor with exact cwd/argv, timeout, bounded output, and lifecycle control.
- The engine does not write directly behind VS Code for host-managed document edits.
This refines the compiler plan's shared protocol; both repositories must implement matching capabilities before rollout.

Bind approval to exact workspace, operation, call ID, content hash, and arguments. Reject stale or duplicated responses. UI visibility is not permission. If the webview or host disappears, default pending approvals to denied/cancelled. Reopening a view must not resend a paid turn or rerun tools automatically.

Maintain backend idempotency through the compiler engine. The extension never blindly resends a prompt on reconnect: recover status from durable request identifiers/keys. Show an incomplete-response state if output cannot be recovered.

## Editor context and change review

Snapshot selected text with URI, range, document version, and hash. Read open documents through VS Code APIs; use workspace.fs for supported file access and distinguish unsupported URI schemes. Untitled text can be sent as explicit context, but saving it needs user selection of a destination.

Present edits in a virtual-document diff. Before Apply, recheck document versions and file hashes. Use WorkspaceEdit to preserve the editor undo workflow; do not overwrite unsaved buffers from a Python disk write. Do not silently save dirty documents. For multi-file operations, prevalidate all changes and document partial-failure handling; editor APIs do not make a cross-file disk transaction automatic.

Reject stale edit proposals and offer regeneration against current content. Undo must use validated session changes or normal editor undo, preserving unrelated user work. Never issue blanket git reset/checkout. File creation/deletion, renaming, outside-root access, and command execution require explicit appropriate approval.

Use shared ignore/secret/context-limit policy from the engine and enforce host-side scope too. Repository instructions and model output cannot authorize tools, change trusted endpoints, or disable exclusions.

## Trust, process safety, and disposal

Declare limited support for untrusted workspaces: keep declarative language features and account UI, but gate agent repository reads/mutations/commands, Run File/REPL, custom runtime execution, automatic diagnostics subprocesses, and PATH setup on explicit trust policy. Changing trust requires disposing/reinitializing affected resources safely.

For agent commands, prefer argv-based controlled subprocesses with captured progress. An interactive command can open an approved terminal, but reliable exit/output tracking needs shell-integration support or a documented alternative. Do not parse shell text heuristically to claim a test passed. Process execution is not sandboxed by file-tool workspace restrictions.

Track child processes and terminate their process groups on Stop, account switch, workspace close, deactivation, or crash where supported. Bound diagnostics runtime/output and dispose timers/children; retain generation guards. Separate cancellation from billing settlement: the server reconciles consumed inference usage.

Use a strict webview CSP, bundled local scripts/styles, minimal localResourceRoots, and sanitized Markdown with no executable HTML. Validate all messages and URLs; prevent model-produced command links from triggering actions. The webview gets presentation data, not tokens, arbitrary filesystem access, or direct authenticated API access. Tool authorization occurs in the host plus shared engine, never solely in frontend JavaScript.

## Desktop, remote, and web support

Initial launch targets desktop VS Code on the existing four supported native platforms. Explicitly declare unsupported native execution in browser-only/virtual workspaces; keep language features where supported.

The agent must execute in the workspace extension host for Remote SSH/WSL/containers so tools act on the correct filesystem. Audit extensionKind and callback/token flow accordingly; do not assume process.platform is the local computer's platform. Verify remote installed VSIX matches the remote OS/architecture and libc compatibility. Alpine/ARM Linux remain unsupported until artifacts exist.

Add remote support only after integration tests verify URI callbacks, root mapping, SecretStorage behavior, child cleanup, and correct command location. Where unavailable, disable agent execution with a clear explanation; do not run local commands against a remote workspace accidentally. Do not implement a browser-native agent engine as part of this phase.

## Native VS Code Chat and model picker

Phase 1 is the independent sidebar. Phase 2 adds @swahilipro via the Chat Participant API with shared sessions/engine and appropriate cancellation/approval adaptation. A participant contribution and a language-model provider are separate capabilities.

Phase 3 optionally contributes gateway models to VS Code's model picker using the Language Model Chat Provider API. Route every invocation through Next.js with SwahiliPro identity and metering. Do not put Bedrock credentials into editor model settings. Provider access by other extensions needs an explicit user consent and usage policy; shared credits must not be consumed silently.

Verify stable APIs, minimum VS Code version, API availability, and any host requirements before raising engines.vscode. Current ^1.88.0 cannot be assumed sufficient for all native AI APIs. Feature-detect or declare an appropriate minimum; avoid proposed APIs in Marketplace production. Document when VS Code's own chat loop owns tools versus SwahiliPro's engine, so there are not two competing orchestration loops.

## Packaging and release alignment

Add package-lock.json and npm ci to CI/package flows. Bundle webview assets and protocol schemas, and inspect .vscodeignore so required runtime/UI files remain and tests/development artifacts are excluded.

Preserve runtime aliases and four target VSIX files. Validate compiler version/protocol capabilities and checksum provenance before packaging. Coordinate the compiler release-resilient workflow, which currently packages extension master: pin the extension commit and record the exact compiler, extension, protocol, and gateway contract versions. Keep extension-only packaging able to reference a known compatible compiler tag.

Existing CI's fake runtime confirms file injection only. Add a real compiler fixture for handshake tests and actual packaged smoke tests on supported OSes. Packaging scripts must clean up generated files on all failure paths without deleting developer-owned binaries unexpectedly.

Keep Marketplace publishing manual/controlled under existing workflows; no publication or credential changes are requested by this plan.

## Ordered implementation and acceptance

1. **Foundation and sidebar:** add manifest contribution, themed accessible UI, modules, lockfile, test harness, and a fake agent host. Existing language/run features pass regression checks.
2. **Accounts:** gated on the Firebase web/client-grant implementation; browser login, SecretStorage, account/credits/models UI. Test wrong verifier, stolen verification URL, timeout, replay, refresh races, denied access, offline logout, and secret redaction.
3. **Engine connection and read-only chat:** gated on compiler protocol and gateway. Test split frames, startup failure, incompatible binary, stream disconnect, credit exhaustion, cancellation, and safe view reload without duplicate paid requests.
4. **Editor tools and approvals:** host buffer adapter, context chips, diff views, WorkspaceEdit, command execution. Test dirty buffers, stale patches, multi-root boundaries, denied/duplicate approvals, ignored secrets, process timeout, and undo preserving user changes.
5. **History and native chat:** bind sessions to root/account/origin, list/resume/delete; add @swahilipro only after native API spike. Verify no automatic command replay or competing loops.
6. **Packaging and beta:** four platform builds with pinned matching runtime, editor integration tests, compiler release dry-run, a small-budget staging account, and manual task evaluation. Native model-provider integration and remote support are separately gated milestones.

Web prerequisites: deployed Auth, credit/model endpoints, inference contract, revocation policy. Compiler prerequisites: agent --stdio, host tool/credential adapters, versioned events, idempotency recovery, cancellation, and history. UI and mock integration can proceed before these services are live.

## Validation and references

Use unit tests for framing, approval binding, auth state, and edit conflict handling, plus VS Code extension-host tests for activation, sidebar/commands, diagnostics, SecretStorage integration, dirty-document edits, and disposal. Test multiple windows and shared account credit updates. CI uses fake services; real-model smoke tests have explicit small budgets.

Evaluate explaining a selection, fixing a syntax diagnostic, reviewing a multi-file change, running an approved test, cancelling a running task, and resuming a session with pre-existing user edits. Record correctness, cost, latency, approval behavior, and failures before claiming parity with other coding agents.

Official references checked:
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/extension-guides/workspace-trust
- https://code.visualstudio.com/api/advanced-topics/remote-extensions
- https://code.visualstudio.com/api/extension-guides/virtual-workspaces
- https://code.visualstudio.com/api/extension-guides/ai/chat
- https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider

This plan changes no extension behavior and does not establish that the Firebase project and application authorization protocol, native chat APIs, or live gateway integrations have passed compatibility tests.
