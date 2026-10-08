# Account and chat preview

This extension uses the Next.js account/gateway in swahilipro_web (draft PRs #6–8)
and the compiler's protocol-v1 engine (swahilipro-compiler draft PRs #10–11).
Firebase auth remains on the website. The extension uses the website's browser
approval flow and opaque client grants; no Firebase admin or Bedrock keys belong
in VS Code settings. The gateway must be deployed/configured before live use.

## First run

1. Install a platform VSIX containing a compiler with `swa agent --stdio` protocol 1.
   Older released compilers still support language features, but chat refuses them.
2. Open and trust a local workspace. Remote SSH, WSL, containers and virtual
   workspaces are not supported in this preview.
3. Set `swahilipro.apiOrigin` in **user settings** to the deployed HTTPS origin.
   Workspace settings cannot choose the gateway or runtime. Optionally set the
   user `swahilipro.runtimePath` to a matching standalone compiler.
4. Open the SwahiliPro activity bar and choose **Sign in**. Compare the eight-character
   code in VS Code with the browser approval page, then authorize the device.
5. Choose an available model, optionally attach a selected editor range, and send.
   The sidebar displays credits in the backend's native microcredit unit.

The extension automatically refreshes account/catalog data when the view opens.
Refresh updates credits and model availability after a chat. Gateway inference is
still disabled by default; configuring Firebase alone does not enable paid calls.
Each Send/Explain Selection action requests one text completion. Stop does not
promise a refund. A client receipt is retained in the sidebar even if the stream
fails before the server's first event. Check request status uses GET recovery only.
Start a new chat after an incomplete response; nothing automatically resends it.

## Context and edits

Only messages and explicitly attached selections are sent. Attachment labels show
file/line/size; the selected snapshot is rejected if the editor version changed.
Context excludes ignored files, common credential files, traversal, links and
special files. These rules cannot detect every secret; review your selection.
Messages/history stay in extension memory. Closing the view, switching workspace,
changing origin/runtime, signing out, or New Chat cancels the process. New Chat and
account/workspace switches discard the conversation. Stop leaves visible partial
text and request metadata for inspection. There is no transcript resume feature.

**Review Proposed Edit** is an explicit local tool: open a target workspace file,
choose a UTF-8 replacement-text file, inspect VS Code's diff, and approve Apply.
The shared compiler generates and binds the proposal. The extension rereads dirty
buffers, checks their version/hash after review, and applies a WorkspaceEdit.
Existing dirty documents are never silently saved. VS Code's normal Undo handles
host edits. Approvals expire with the process and cannot be reused or changed.
The API has no atomic version-bound applyEdit overload, so an independent editor
change can race the final check; the host confirms post-edit content before success.
Model responses are plain text and never interpreted as commands or tool calls.
Autonomous agent loops, editor-aware search, command execution, native chat
participants and automatic extraction of model code blocks remain later work.

## Credentials and runtime lifecycle

Only the origin-scoped refresh grant is stored in VS Code SecretStorage. Access
credentials are held in host memory and sent through private stdio only when the
engine's initialized origin/UID match. No credentials go to the webview, settings,
globalState, argv, source files or logs. The engine validates the account before
inference. Proper-lockfile serializes refresh/login/logout across windows sharing
this extension storage. A refresh-attempt marker is written before rotation; a
lost response or failed persistence requires sign-out/login instead of replaying
an already consumed refresh token. Local sign-out always deletes its secret and
reports when server revocation could not be confirmed; revoke the device on the
website in that case.

The webview has restricted local resources, a nonce CSP with no network access,
validated message actions, and textContent rendering. Language hover remains
available in restricted mode; runtime diagnostics, terminal execution, CLI setup,
account access and editor tools require workspace trust. Subprocess stdout is
bounded JSONL; stderr is drained without logging source or credentials. Stop
invalidates host approvals immediately and allows at most 35 seconds for engine
shutdown. Runtime diagnostics have bounded input, stderr and duration.

## Build and validation

```
npm ci
npm run check
npm run lint
SWA_ENGINE_BINARY=/absolute/path/to/matching/swa npm test
xvfb-run -a npm run test:editor  # Linux; a display is required
npm run package:runtime -- /absolute/path/to/swa linux-x64 COMPILER_COMMIT
```

Unit tests cover authorization binding, refresh uncertainty/storage failures,
cross-session locking, framing, interrupted streams, trust, file policy, stale
buffers, denial and changed approvals. With SWA_ENGINE_BINARY set, tests exercise
the real packaged compiler's host read/edit protocol. The editor suite activates
the extension in VS Code 1.88.1 and verifies dirty-buffer reads, real WorkspaceEdit,
disk preservation and native Undo. CI runs this suite under Xvfb. No paid cloud
calls are part of tests. Real browser authorization/SecretStorage behavior across
OS installations, AWS streaming/billing, and Windows/macOS binaries still require
rollout validation.

Packaging preserves all existing development runtime files even on failure. It
records compiler reference, target and SHA256 in runtime/provenance.json. It checks
the hello protocol when packaging for the current platform; cross-platform builds
are explicitly marked unverified and must pass a matching-platform runtime smoke
check before release. The extension always performs its own runtime handshake.
The CI shell fixture validates injection only; it is not a compiler distribution.
No Marketplace publish, backend deployment, or compiler release is included here.
