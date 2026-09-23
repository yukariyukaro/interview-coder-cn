# AGENTS.md

## Project Overview

**Interview Coder CN** (截屏解题助手) is a desktop application that captures screenshots of on-screen problems (coding challenges, exam questions, or anything else) and uses AI (vision models) to generate solutions in real-time. The window is invisible to screen-sharing software, making it suitable for use during coding interviews and online assessments.

Key capabilities:
- Global shortcuts trigger screenshot capture → AI analysis → streamed solution display
- Frameless, transparent, always-on-top overlay window invisible to screen-sharing
- Mouse passthrough mode (window ignores mouse events)
- Multi-screenshot conversation continuity (append screenshots to existing context)
- Follow-up questions within the same conversation
- Real-time speech transcription (DashScope Fun-ASR) — transcribed text is attached to screenshots when sent to AI
- Configurable AI provider (OpenAI, SiliconFlow, OpenRouter, or any OpenAI-compatible API)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 37 (electron-vite 4) |
| Frontend | React 19, TypeScript 5.8 |
| Styling | Tailwind CSS v4, shadcn/ui (New York style), Radix primitives |
| State | Zustand 5 (5 stores, 2 with localStorage persistence) |
| Routing | react-router v7 (HashRouter, 3 routes) |
| AI | Vercel AI SDK (`ai` + `@ai-sdk/openai`), streaming via `streamText()` |
| Build | electron-vite (Vite 7), electron-builder 25 |
| Linting | ESLint 9 (flat config), Prettier |

## Directory Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry: lifecycle, error handling, app.whenReady()
│   ├── index.d.ts           # global.mainWindow type declaration
│   ├── core/                # Shared settings, runtime state, IPC sender validation
│   ├── input/               # Global shortcuts, scroll input, speech transcription
│   │   ├── shortcuts.ts     # Registers bindings on the system or hook channel
│   │   ├── hook-runtime.ts  # Invisible-shortcut runtime (install/health/degrade/status)
│   │   ├── native-addon.ts  # Loads the optional native hook addon from resources/native
│   │   └── native-addon.d.ts# Contract of that addon
│   ├── solution/            # AI client, screenshot pipeline, solution session/events
│   ├── sync/                # Desktop mobile-sync client and network URL resolution
│   ├── updater/             # electron-updater integration
│   └── windows/             # Main/toolbar windows, lifecycle, resize, silent mode
├── preload/
│   ├── index.ts             # contextBridge API: exposes window.api to renderer
│   └── index.d.ts           # Type declarations for window.electron and window.api
└── renderer/
    ├── index.html            # SPA entry
    └── src/
        ├── main.tsx          # React root render
        ├── App.tsx           # Router + settings sync + shortcut init + Toaster
        ├── coder/            # Main page: screenshot display + AI solution stream
        │   ├── index.tsx     # CoderPage layout + state sync + transcription lifecycle
        │   ├── AppHeader.tsx # Draggable title bar with nav buttons
        │   ├── AppContent.tsx# Screenshots gallery + markdown solution + error banner
        │   ├── AppStatusBar.tsx    # Loading indicator, follow-up dialog, shortcut hints
        │   ├── TranscriptionBar.tsx # Absolute-positioned real-time transcription overlay
        │   ├── OverlayToolbar.tsx  # Contents of the toolbar window (route `/toolbar`)
        │   └── PrerequisitesChecker.tsx  # Modal for API key setup
        ├── settings/         # Settings page
        │   ├── index.tsx     # AI config, coding, appearance, shortcuts, privacy
        │   ├── SelectModel.tsx     # Combobox with custom model input
        │   ├── HookStatusBanner.tsx # Visible/degraded state of the invisible shortcuts
        │   └── CustomShortcuts.tsx # Shortcut key recorder
        ├── help/             # Help page
        │   ├── index.tsx     # Quick start guide, shortcuts, toolbar, FAQ
        │   ├── Shortcuts.tsx
        │   ├── OverlayToolbar.tsx  # Toolbar section (buttons + meanings + shortcuts)
        │   ├── FAQ.tsx
        │   └── components/index.tsx  # HelpSection wrapper
        ├── components/
        │   ├── MarkdownRenderer.tsx   # react-markdown + remark-gfm + rehype-highlight
        │   ├── ShortcutRenderer.tsx   # Platform-aware shortcut key badges
        │   ├── WindowResizeHandles.tsx # Edge/corner drag targets that drive window-resize.ts
        │   └── ui/           # shadcn/ui primitives (button, dialog, select, etc.)
        ├── lib/
        │   ├── store/        # Zustand stores
        │   │   ├── app.ts       # ignoreMouse state, synced from main process
        │   │   ├── settings.ts  # API config, model, prompt scenes, opacity, toolbar (persisted v8)
        │   │   ├── shortcuts.ts # Shortcut bindings (persisted v9, with migration)
        │   │   ├── hook.ts      # Invisible-shortcut status mirrored from main (not persisted)
        │   │   ├── solution.ts  # Loading state, solution chunks, screenshots, errors
        │   │   └── transcription.ts # Transcription state: isTranscribing, text, error
        │   ├── toolbar-actions.ts # Toolbar button list (action + icon + label), shared with help
        │   ├── utils/
        │   │   ├── index.ts     # cn() helper, getCloneableFields()
        │   │   ├── env.ts       # isMac, platformAlt, platform
        │   │   └── keyboard.ts  # Accelerator string conversion
        │   └── audio-capture.ts # System audio capture via getDisplayMedia for transcription
        └── assets/
            ├── base.css      # Tailwind @import, CSS variables, app layout styles
            └── main.css      # Tailwind + typography plugin + theme variables (oklch)

native/input-hook/           # Optional native addon behind the invisible shortcuts
├── binding.gyp              # node-gyp target (win32 / darwin only)
└── src/                     # state.h + hook_win.cc (WH_KEYBOARD_LL) / hook_mac.mm (CGEventTap)

packages/shortcut-tokens/    # Shared vocabulary for the sacrificial right-side modifiers
```

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────┐
│  Main Process (src/main/)                           │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │   core   │  │ windows  │  │       input       │ │
│  │ settings │  │ lifecycle│  │ shortcuts / ASR   │ │
│  │   state  │  │ resize   │  └─────────┬─────────┘ │
│  └────┬─────┘  └────┬─────┘            │           │
│       │              │          ┌───────┴─────────┐ │
│       │              │          │    solution     │ │
│       │              │          │ capture / AI    │ │
│       │              │          │ session / events│ │
│       │              │          └───────┬─────────┘ │
│       │              │                  │           │
│       │              │          ┌───────┴─────────┐ │
│       │              │          │      sync       │ │
│       │              │          │ mobile WebSocket│ │
│       └──────────────┼──────────┴─────────────────┘ │
│              IPC (ipcMain.handle)                    │
├─────────────────────────────────────────────────────┤
│  Preload (src/preload/)                             │
│  contextBridge → window.api                         │
├─────────────────────────────────────────────────────┤
│  Renderer (src/renderer/)                           │
│  React app with Zustand stores                      │
│  window.api.on*() for events from main              │
│  window.api.*() for invoke calls to main            │
└─────────────────────────────────────────────────────┘
```

### Data Flow: Screenshot → Solution

1. User presses global shortcut (e.g., `Alt+Enter` on macOS)
2. `input/shortcuts.ts` delegates to `solution/solution-controller.ts`
3. `solution/take-screenshot.ts` uses `desktopCapturer` to create a base64 PNG
4. Main sends `screenshot-taken` and `ai-loading-start` to renderer
5. `solution/ai.ts` calls Vercel AI SDK `streamText()`
6. Stream chunks are sent to renderer via `solution-chunk` IPC events
7. Renderer accumulates chunks in `useSolutionStore` and renders via `MarkdownRenderer`
8. On completion: `solution-complete`; on error: `solution-error`; on abort: `solution-stopped`

### IPC Channels

**Renderer → Main (invoke):**
- `getAppSettings` / `updateAppSettings` — settings CRUD
- `updateAppState` — sync `inCoderPage`, `ignoreMouse`
- `initShortcuts` / `getShortcuts` / `updateShortcuts` — shortcut management
- `getHookStatus` — whether right-modifier bindings are currently swallowed by the native hook
- `setHookSuspended` — stand the hook down while the shortcut recorder listens for a right-side modifier
- `stopSolutionStream` — abort current AI stream
- `sendFollowUpQuestion` — follow-up within conversation
- `triggerAction` / `setToolbarVisible` — overlay toolbar: run a shortcut action, toggle the window
- `window-resize-start` / `window-resize-stop` (`send`, not `invoke`) — begin/end a cursor-tracked window resize
- `start-transcription` / `stop-transcription` — speech transcription lifecycle
- `get-transcription-text` / `clear-transcription-text` — read/clear accumulated text

**Main → Renderer (send):**
- `sync-app-state` — push state changes (e.g., mouse ignore toggle)
- `screenshot-taken` / `screenshots-updated` — screenshot data (`screenshots-updated` also carries the untruncated conversation total)
- `solution-clear` / `solution-chunk` / `solution-complete` / `solution-stopped` / `solution-error` — AI streaming lifecycle
- `ai-loading-start` / `ai-loading-end` — loading state
- `scroll-page-up` / `scroll-page-down` — keyboard-driven scroll
- `toggle-transcription` — trigger start/stop transcription from shortcut
- `sync-toolbar-settings` — push toolbar-only settings (hover dwell) into the toolbar window
- `hook-status-changed` — the invisible-shortcut channel changed (installed, degraded, re-installed)
- `transcription-text` / `transcription-error` / `transcription-stopped` / `transcription-cleared` — transcription events

### Zustand Stores

| Store | File | Persisted | Key State |
|-------|------|-----------|-----------|
| `useSettingsStore` | `lib/store/settings.ts` | Yes (v10) | `apiBaseURL`, `apiKey`, `model`, `customModels`, `scenes` (prompt scenes), `activeSceneId`, `customPrompt` (derived from active scene), `opacity`, `resizable`, `showOverlayToolbar`, `toolbarHoverDelay`, `screenshotDisplay`, `screenshotAutoSave`, `answerAutoSave`, `screenshotDir`, `dashscopeApiKey` |
| `useShortcutsStore` | `lib/store/shortcuts.ts` | Yes (v9) | `shortcuts` (action → key mapping with categories; a right-side modifier token marks a binding as invisible-capable) |
| `useHookStatusStore` | `lib/store/hook.ts` | No | `available`, `reason`, `hookedCount` mirrored from main |
| `useSolutionStore` | `lib/store/solution.ts` | No | `isLoading`, `solutionChunks`, `screenshotData`, `errorMessage` |
| `useTranscriptionStore` | `lib/store/transcription.ts` | No | `isTranscribing`, `transcriptionText`, `errorMessage` |
| `useAppStore` | `lib/store/app.ts` | No | `ignoreMouse` |

Settings are bidirectionally synced: renderer persists to localStorage, and on mount syncs to main process via `updateAppSettings()`. Main process `.env` values serve as initial defaults only.

Adding a settings key needs no `version` bump: zustand shallow-merges the persisted object over the defaults, so a key missing from localStorage falls back to its default. Bump `version` only when an existing key changes shape or meaning.

## Key Patterns & Conventions

### Window Stealth

The app is designed to be invisible to screen-sharing software:
- `BrowserWindow` options: `transparent: true`, `frame: false`, `skipTaskbar: true`
- `setContentProtection(true)` prevents screen capture of the window itself
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`
- `keepWindowInFront()` repeatedly reasserts always-on-top for 5 seconds after show
- `showInactive()` on macOS/Windows to avoid stealing focus

### Overlay Toolbar

A second `BrowserWindow` (`src/main/windows/toolbar-window.ts`) that renders the `/toolbar` route, so the shortcut actions can be driven with the mouse instead of the keyboard:
- Owns its own visibility state: the renderer calls `setToolbarVisible()` (main page + `showOverlayToolbar` setting), main additionally requires the main window to be visible. Never call `showInactive()` on it directly — go through `showToolbar()` / `hideToolbar()`.
- `focusable: false` so clicking a button never pulls focus away from the app underneath
- Opacity is applied at the window level to match the main window, which applies its own via `document.body.style.opacity`
- It is a separate renderer process, so its Zustand store is a **separate copy** that does not see changes made in the main window. Settings it needs must be pushed from main (`sync-toolbar-settings`), not read from the store.
- Buttons carry no `title`: native tooltips are drawn outside the window and are not covered by content protection
- `TOOLBAR_ACTIONS` (`lib/toolbar-actions.ts`) drives both the toolbar and its help page section; `triggerAction` is validated against `clickableActions` in `shortcuts.ts`
- Resizing the toolbar window never rescales its buttons: `OverlayToolbar` measures the bar and renders only the actions that fit, dropping the rest from the end

### Window Resizing

Both windows are created with `resizable: false` — toggling Electron's native resizable style breaks transparency on Windows — so resizing is implemented by hand:
- `WindowResizeHandles` renders eight fixed-position edge/corner divs — or, with `axis="x"`, just the two side edges — and sends only `window-resize-start` (pointerdown) and `window-resize-stop`
- `src/main/windows/window-resize.ts` then polls `screen.getCursorScreenPoint()` and calls `setBounds()`. The cursor is sampled in main because the toolbar is a non-activating panel on macOS and never receives a drag's pointer moves
- The drag is ended by a `window`-level `pointerup`/`pointercancel`/`blur` listener, with a 30s safety timeout in main as the last resort
- The handles sit at `z-index: 2147483647`; anything flush against a window edge (e.g. `#app-header .actions`) must raise itself above them or it becomes unclickable
- The main window's handles are gated by the `resizable` setting; the toolbar's are always on but width-only (`axis="x"` — its height is the button row), with the resize cursor suppressed in `main.css`

### AI Integration

- All AI calls go through `src/main/solution/ai.ts` using Vercel AI SDK's `streamText()`
- Provider: `@ai-sdk/openai` with custom `baseURL` (works with any OpenAI-compatible API)
- Model fallback: `Qwen/Qwen3-VL-32B-Instruct` for SiliconFlow, `gpt-5-mini` otherwise
- System prompts are maintained in the renderer settings store (`PRESET_SCENE_PROMPTS` in `lib/store/settings.ts`) as "prompt scenes"; the active scene's prompt is synced to the main process as `customPrompt`
- Three streaming functions: `getSolutionStream` (first screenshot), `getFollowUpStream` (follow-up), `getGeneralStream` (multi-screenshot)
- Conversation history (`conversationMessages`) is maintained in `solution/solution-controller.ts` as `ModelMessage[]`

### Stream Abort Pattern

- `StreamContext` with `AbortController` and `reason` (`'user'` | `'new-request'`)
- New requests automatically abort previous streams
- User can manually stop via shortcut or UI button
- Abort reason determines which IPC event to send (`solution-stopped` for user, silent for new-request)

### Real-time Speech Transcription

- Uses DashScope (Alibaba Cloud) Fun-ASR real-time ASR via WebSocket (`src/main/input/transcription.ts`)
- Requires a separate `dashscopeApiKey` configured in settings
- Audio is captured in the renderer via `getDisplayMedia()` (system audio), downsampled to 16kHz PCM, and streamed to main process via IPC
- `TranscriptionBar` is absolute-positioned at the top of the coder page, shows up to 3 lines with auto-scroll
- On screenshot (`takeScreenshot` / `appendScreenshot`), accumulated transcription text is automatically attached to the AI prompt, then cleared
- `clearTranscription` shortcut clears text without submitting to AI
- Transcription shortcuts are disabled in settings UI when `dashscopeApiKey` is not configured

### Shortcut System

- Two channels, decided per binding by its accelerator string:
  - **hook** — any binding containing a sacrificial right-side modifier (`RightControl`, `RightAlt`, `RightShift`, and `RightCommand` on macOS). Registered through the native hook, which swallows the whole key sequence, so the focused window (and any page JS in it) never sees a keydown/keyup — not even an orphan modifier press.
  - **system** — everything else, registered via Electron's `globalShortcut` as before. An orphan modifier press does reach the focused window here; that is the pre-existing behaviour, not a regression.
- **Using one of those tokens is what enables the hook** — there is no separate "invisible mode" switch.
- The hook is installed lazily (only while at least one binding needs it) and torn down when none does.
- Degrading is key-for-key identical: `toFallbackAccelerator(defaultKey)` maps e.g. `RightControl+H` back to `CommandOrControl+H`. `src/renderer/src/lib/store/shortcuts.test.ts` asserts this invariant for every default on both platforms.
- Renderer stores shortcut config in Zustand (persisted, v9); sends to main on init. The v7→v8 migration upgrades untouched defaults to the right-side modifiers and leaves customised bindings alone; v8→v9 folds the short-lived `hookKey` field back into `key`. Bump `version` whenever the shape changes — a mismatch there leaves the hook silently unused.
- On Windows, `Alt`-based *system* shortcuts also register a `Ctrl+Alt` variant for compatibility.
- Shortcut actions are string-keyed callbacks in `src/main/input/shortcuts.ts`; hook triggers dispatch through the very same callbacks, so the `state.inCoderPage` guards are unchanged.
- Default shortcuts use `platformAlt` for their fallback meaning only; the stored values are the sacrificial right-side forms.

### Invisible Shortcuts (native hook)

- Vocabulary lives in `packages/shortcut-tokens` (shared by both processes — a drift there would silently fall back to the leaking channel).
- `src/main/input/hook-runtime.ts` compiles accelerators into keycodes, installs the addon, watches its health and reports status; `src/main/input/shortcuts.ts` only decides which channel each binding uses.
- The native addon (`native/input-hook`, node-gyp, N-API) is **optional**:
  - Built by `npm run build:native`, which is prepended to `build:win` / `build:mac`, writes `resources/native/input-hook-<platform>-<arch>.node`, and **exits 0 with a warning when the C++ toolchain is missing** so `npm ci` and `npm run dev` never depend on it.
  - Built with N-API, so no `electron-rebuild` step is needed and `npmRebuild: false` in `electron-builder.yml` stays correct.
  - Windows needs the "Desktop development with C++" workload, and the SDK must be **registered on the VS instance** — node-gyp reads the instance's package list, so an SDK that merely exists on disk still reports `missing any Windows SDK`. macOS needs Xcode Command Line Tools plus the Accessibility / Input Monitoring grant.
  - `node-gyp` is an explicit devDependency on v11+: the bundled gyp of v9 imports `distutils`, which Python 3.12 removed.
- The state machine lives in C++ (`native/input-hook/src/state.h`) because a macOS `CGEventTap` must decide synchronously on the tap thread, where calling back into JS is not allowed. Rule: a prefix is always swallowed, and while any prefix is held every key is swallowed; a modifier that was pressed *before* the prefix keeps leaking (its keydown already reached the window) and its keyup leaks too, so no orphan keyup is created.
- Because a prefix is swallowed system-wide, our own shortcut recorder would never see it. `setHookSuspended(true)` therefore uninstalls the hook for as long as the recorder is listening, and `refreshHookBindings()` refuses to bring it back up meanwhile.
- Health:
  - Windows silently removes a low-level hook that keeps timing out, so `hook-runtime` compares "ms since the system last saw input" with "ms since the hook last saw a key" and reinstalls on a gap.
  - macOS re-enables the tap in place when it receives `kCGEventTapDisabledByTimeout` / `ByUserInput`.
- The hook cannot filter by device: a swallowed key never produces a Raw Input packet, and a low-level hook carries no device handle. Triggers are therefore chosen to be unambiguous (a right-side sacrificial modifier), not device-specific.

### UI Component Patterns

- shadcn/ui components in `src/renderer/src/components/ui/` — do NOT edit these directly, use the shadcn CLI to add/update
- `cn()` utility (clsx + tailwind-merge) for conditional class merging
- `getCloneableFields()` strips functions from store state before sending over IPC
- Platform-aware shortcut display via `ShortcutRenderer` (⌘, ⌥, ⇧ on Mac; Ctrl, Alt, Shift on Windows)

## Development

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Start in dev mode (electron-vite dev)
npm run build        # Typecheck + build (electron-vite build)
npm run build:mac    # Build macOS distributable
npm run build:win    # Build Windows distributable
npm run build:native # Compile the optional native hook addon (skips with a warning if unavailable)
npm run typecheck    # Run TypeScript type checking (node + web)
npm run lint         # Run ESLint
npm run format       # Run Prettier
```

### Configuration

The `.env` file at project root configures the AI provider:

```env
API_BASE_URL="https://openrouter.ai/api/v1"  # OpenAI-compatible API endpoint
API_KEY="sk-..."                               # API key
MODEL="gpt-5-mini"                             # Optional: override default model
```

These are read by dotenv in the main process and merged with renderer-side settings (renderer settings take priority when set).

### Path Aliases

- `@renderer/*` and `@/*` both resolve to `src/renderer/src/*`
- Configured in `tsconfig.web.json` and `electron.vite.config.ts`

### Code Style

- Prettier: single quotes, no semicolons, 100 char print width, no trailing commas
- ESLint: TypeScript + React + React Hooks + React Refresh rules
- UI text and user-facing strings are in **Chinese** (中文)
- Code comments and variable names are in **English**

## Important Notes for AI Agents

1. **Three TypeScript configs**: `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). The root `tsconfig.json` is a project references file only.

2. **System prompts live in the renderer**: All preset scene prompts are defined in `src/renderer/src/lib/store/settings.ts` (`PRESET_SCENE_PROMPTS`). The main process only consumes the synced `customPrompt` and has no built-in prompt of its own.

3. **`global.mainWindow`**: The main window reference is stored as a global variable, declared in `src/main/index.d.ts`.

4. **Settings flow**: `.env` → main process `settings` object → renderer reads on mount via IPC → renderer persists to localStorage via Zustand. Renderer-side changes are sent back to main via `updateAppSettings`.

5. **No shared types directory**: Main process types (`AppSettings`, `AppState`) are imported directly by the preload script from `../main/core/settings` and `../main/core/state`. This works because preload shares the Node.js tsconfig.

6. **Streaming orchestration is in `solution/solution-controller.ts`**: It manages conversation history, abort controllers, screenshot requests, and solution lifecycle events. `input/shortcuts.ts` only maps global shortcuts and IPC actions onto those operations.

7. **Window movement**: The window can be moved via keyboard shortcuts in 200px steps (up/down/left/right), and resized by dragging its edges (see Window Resizing).

8. **macOS auto-update is disabled**: `publish: null` in electron-builder.yml for mac target. Auto-update only works on Windows.

9. **macOS and Windows only**: Linux is not a supported or built target.

10. **Prompt files are Prettier-ignored**: `src/renderer/src/lib/store/prompts/` is listed in `.prettierignore` — Prettier rewrites the literal ``` fences inside those prompts, which changes what the model is told.

---

## Mobile App（Expo）Windows 本地开发笔记

> 本节补充 `apps/mobile`（Expo / React Native 开发版）在 **Windows 本地**启动与真机调试的踩坑记录，适用于含桌面端 + 移动端 workspace 的分支。

### 依赖与启动

- 仓库使用 **npm workspaces**（根 `package.json` 的 `workspaces: ["apps/*","packages/*"]`，`devEngines.packageManager = npm`）。**不要用 pnpm 安装**：`@interview-coder/sync-protocol` 等内部包只存在于本地 workspace，pnpm 会尝试从 registry 拉取而报 `ERR_PNPM_FETCH_404`。
- 安装依赖：在仓库根执行 `npm install`（workspace 依赖一并安装）。
- 启动顺序：
  1. 移动端同步中继：`npm run dev:sync`（监听 8787）
  2. 桌面端：`npm run dev`
  3. Mobile Metro：`npm run start -w @interview-coder/mobile`（等价于在 `apps/mobile` 下 `node scripts/start-dev-server.mjs --dev-client`）

### Metro 在 monorepo 下的入口 URL（重要，容易误判为 bug）

- `expo/metro-config` 会把 Metro 的 **serverRoot 自动提升到 workspace 根**（`interview-coder-cn/`），而 projectRoot 仍是 `apps/mobile`。这是 expo 的**正常设计**（为了让 monorepo 内共享源码的 URL 稳定），不是配置错误，在 macOS 上行为一致。
- 因此 bundle 入口 URL **不是** `/index.bundle`，而是相对 serverRoot 的路径：
  `http://<host>:8081/apps/mobile/index.ts.bundle?platform=android&dev=true&...`
- 想拿到真实 URL：`curl -H "expo-platform: android" http://127.0.0.1:8081/` 取 manifest 的 `launchAsset.url`。
- 用 `/index.bundle` 这类错误入口请求会得到 `Unable to resolve module ./index from D:\...\interview-coder-cn/...`，属于**入口 URL 用错**而非工程损坏。

### Windows 终端跑 expo 的怪癖

- 本环境直接跑 `expo.cmd start` / `npm run start -w ...` 时，expo CLI 主进程可能以 **exit code 0 提前退出**，但 **Metro 子进程仍持续监听 8081**。判断 Metro 是否可用以端口监听 / `GET http://127.0.0.1:8081/status`（返回 `packager-status:running`）为准，不要只看命令退出码。
- 需要命令保持前台运行以便看日志时，用 node 直跑 CLI 的 JS 入口（cwd 必须是 `apps/mobile`）：
  `node node_modules/expo/node_modules/@expo/cli/build/bin/cli start --dev-client`

### Android 真机白屏排查 Checklist

白屏 = Development Build 未拿到 JS bundle，按序排查：

1. Metro 是否存活：`http://127.0.0.1:8081/status`。
2. 手机浏览器访问 `http://<电脑局域网IP>:8081/status`（如 `192.168.31.92`）。打不开 → 检查：手机与电脑是否同一 WiFi 网段、路由器是否开启 AP 隔离、Windows 防火墙是否放行 TCP 8081。
3. Windows 防火墙放行（需管理员）：
   `netsh advfirewall firewall add rule name="expo-metro-8081" dir=in action=allow protocol=TCP localport=8081`
4. 电脑局域网 IP 以 `ipconfig` 的 WLAN 网卡为准；不要信 expo 打印的连接地址，它可能选中 VMware 等虚拟网卡的 169.254.x.x 地址导致真机不可达。
5. Dev Launcher 中输入 `http://<电脑IP>:8081` 即可（服务端按请求 Host 生成 bundle URL）。若进入 Dev Launcher 界面本身白屏，把 App 从后台任务完全划掉重开。
6. 首次加载会编译整个 bundle（1~3 分钟、约 8MB+），耐心等待；也可用 `curl` 对 bundle URL 预热缓存。
7. 真机需访问同步中继（8787）时必须走 USB + `adb reverse tcp:8787 tcp:8787`（同理 8081 也可 reverse）。注意：手机 USB 模式要选「文件传输 / MTP」，否则 adb 枚举不到设备。
