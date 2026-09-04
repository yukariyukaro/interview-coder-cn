# React Native 移动端同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让 Electron 助手可无闪屏地静默运行，并把截图解题的实时结果经受控 WebSocket 中继同步到 React Native Android/iOS 客户端。

**架构：** Electron 主进程持有静默状态和解题事件总线，渲染进程只负责展示；桌面同步客户端将同一份领域事件发送到内存型中继服务。移动端通过配对码加入房间，按 `sessionId + seq` 校验并还原当前答案，截图本身和 AI Key 不离开桌面端。

**技术栈：** Electron 37、React 19、TypeScript、Vitest、WebSocket、Zod、Expo/React Native、Jest、React Native Testing Library、React Native DevTools。

---

### Task 1：建立测试基线并实现静默后台模式

**文件：**
- 创建：`src/main/silent-mode.ts`
- 创建：`src/main/silent-mode.test.ts`
- 修改：`src/main/main-window.ts`
- 修改：`src/main/index.ts`
- 修改：`src/main/settings.ts`
- 修改：`src/main/toolbar-window.ts`
- 修改：`src/main/shortcuts.ts`
- 修改：`src/renderer/src/lib/store/settings.ts`
- 修改：`src/renderer/src/settings/index.tsx`
- 修改：`package.json`

- [ ] **Step 1：编写失败测试**

测试覆盖首次启动静默、重复进入静默、退出静默和工具栏不可泄露：

```ts
it('keeps both windows hidden when silent mode is enabled', () => {
  controller.setEnabled(true)
  expect(mainWindow.hide).toHaveBeenCalledOnce()
  expect(toolbar.hide).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2：确认测试先失败**

运行：`npm test -- src/main/silent-mode.test.ts`

预期：测试因 `silent-mode.ts` 不存在而失败。

- [ ] **Step 3：实现主进程权威状态**

`silent-mode.ts` 暴露以下契约：

```ts
export type SilentModeWindow = Pick<
  BrowserWindow,
  'hide' | 'isDestroyed' | 'isVisible' | 'show' | 'showInactive'
>

export function isSilentModeEnabled(): boolean
export function setSilentModeEnabled(enabled: boolean): void
export function applySilentMode(window: BrowserWindow): void
export function revealMainWindow(window: BrowserWindow): void
```

静默时主窗口和工具栏均隐藏；退出静默时恢复内容保护与置顶。`ready-to-show` 和 `activate` 必须查询该状态，禁止启动闪屏。

- [ ] **Step 4：接入设置**

增加 `silentMode` 设置，并在隐私设置中使用 `Switch` 即时切换。主进程收到设置后立即执行窗口可见性变更，不依赖 renderer 路由。

- [ ] **Step 5：运行测试与类型检查**

运行：

```bash
npm test -- src/main/silent-mode.test.ts
npm run typecheck
```

预期：全部通过。

### Task 2：定义共享同步协议

**文件：**
- 创建：`packages/sync-protocol/package.json`
- 创建：`packages/sync-protocol/tsconfig.json`
- 创建：`packages/sync-protocol/src/index.ts`
- 创建：`packages/sync-protocol/src/index.test.ts`
- 修改：`package.json`

- [ ] **Step 1：编写协议校验失败测试**

```ts
expect(parseSyncEvent({ version: 2, type: 'solution.delta' }).success).toBe(false)
expect(parseSyncEvent(validDelta).success).toBe(true)
```

- [ ] **Step 2：实现版本化白名单协议**

```ts
export type SyncEvent =
  | EventEnvelope<'session.reset', {}>
  | EventEnvelope<'screenshot.updated', { total: number }>
  | EventEnvelope<'request.started', {}>
  | EventEnvelope<'solution.delta', { text: string }>
  | EventEnvelope<'request.completed', {}>
  | EventEnvelope<'request.stopped', {}>
  | EventEnvelope<'request.failed', { message: string }>
```

每个事件包含 `version`、`eventId`、`sessionId`、`seq`、`timestamp`、`type` 和 `payload`。未知类型、缺字段和类型异常必须拒绝，不能注入默认展示文本。

- [ ] **Step 3：运行协议测试**

运行：`npm test -w @interview-coder/sync-protocol`

预期：全部通过。

### Task 3：实现 WebSocket 中继服务

**文件：**
- 创建：`apps/sync-server/package.json`
- 创建：`apps/sync-server/tsconfig.json`
- 创建：`apps/sync-server/src/server.ts`
- 创建：`apps/sync-server/src/index.ts`
- 创建：`apps/sync-server/src/server.test.ts`

- [ ] **Step 1：编写真实 WebSocket 集成测试**

测试两个角色用同一配对码入房、错误配对码拒绝、事件只从桌面转发到移动端、后来连接的移动端收到最新快照。

- [ ] **Step 2：实现内存房间和帧限制**

```ts
export type SyncServerOptions = {
  port: number
  host?: string
  maxPayloadBytes?: number
}

export function createSyncServer(options: SyncServerOptions): {
  url: string
  close(): Promise<void>
}
```

服务端不记录截图、AI Key 或答案日志；只保留每个配对房间的有界事件缓冲。

- [ ] **Step 3：运行集成测试**

运行：`npm test -w @interview-coder/sync-server`

预期：配对、转发、重放和非法帧测试全部通过。

### Task 4：把 Electron 解题结果接入同步服务

**文件：**
- 创建：`src/main/solution-events.ts`
- 创建：`src/main/solution-events.test.ts`
- 创建：`src/main/mobile-sync.ts`
- 创建：`src/main/mobile-sync.test.ts`
- 修改：`src/main/shortcuts.ts`
- 修改：`src/main/settings.ts`
- 修改：`src/renderer/src/lib/store/settings.ts`
- 修改：`src/renderer/src/settings/index.tsx`

- [ ] **Step 1：编写事件顺序和重连测试**

```ts
publisher.resetSession()
publisher.publish('solution.delta', { text: 'A' })
publisher.publish('solution.delta', { text: 'B' })
expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
```

- [ ] **Step 2：实现统一事件发布器**

发布器继续发送现有 Electron IPC，同时将白名单事件交给 `mobile-sync.ts`。截图事件只发送数量，绝不发送 base64 图片。

- [ ] **Step 3：实现桌面 WebSocket 客户端**

支持 `syncEnabled`、`syncServerUrl` 和 `syncPairingCode`，使用指数退避重连。禁用同步或配置不完整时不建立连接。

- [ ] **Step 4：替换流式出口**

将 `shortcuts.ts` 中的 `solution-clear`、`screenshots-updated`、`ai-loading-start/end`、`solution-chunk`、`solution-complete/stopped/error` 接入事件发布器，保留现有桌面 UI 行为。

- [ ] **Step 5：运行桌面测试**

运行：

```bash
npm test -- src/main/solution-events.test.ts src/main/mobile-sync.test.ts
npm run typecheck
```

预期：全部通过。

### Task 5：实现 React Native Android/iOS 客户端

**文件：**
- 创建：`apps/mobile/package.json`
- 创建：`apps/mobile/app.json`
- 创建：`apps/mobile/tsconfig.json`
- 创建：`apps/mobile/index.ts`
- 创建：`apps/mobile/App.tsx`
- 创建：`apps/mobile/src/sync/session-reducer.ts`
- 创建：`apps/mobile/src/sync/use-sync-connection.ts`
- 创建：`apps/mobile/src/storage/connection-settings.ts`
- 创建：`apps/mobile/src/components/ConnectionPanel.tsx`
- 创建：`apps/mobile/src/components/SolutionView.tsx`
- 创建：`apps/mobile/src/__tests__/session-reducer.test.ts`
- 创建：`apps/mobile/src/__tests__/App.test.tsx`

- [ ] **Step 1：编写 reducer 和连接界面测试**

测试增量拼接、重复序号丢弃、会话重置、协议错误、配置缺失时不连接，以及连接成功后的状态展示。

- [ ] **Step 2：实现连接状态机**

```ts
export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'error'; message: string }
```

连接地址和配对码通过 `expo-secure-store` 保存；后端字段缺失时拒绝事件，不生成默认答案内容。

- [ ] **Step 3：实现移动端界面**

界面采用克制的深色工作台风格：顶部连接状态、主区域 Markdown 解题结果、底部连接设置。使用图标表达连接和设置操作，保证窄屏文本不溢出。

- [ ] **Step 4：安装 React Native DevTools**

安装 React Native 后确认其内置的 `@react-native/debugger-frontend` 已下载；同时安装独立 `react-devtools` 开发依赖用于无法通过 Metro 快捷键打开时的回退。

- [ ] **Step 5：运行移动端测试和导出检查**

运行：

```bash
npm test -w @interview-coder/mobile
npm run typecheck -w @interview-coder/mobile
npm run export -w @interview-coder/mobile
```

预期：Jest、TypeScript 和 Expo Android/iOS bundle 导出全部通过。

### Task 6：完整验证和运行说明

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-03-react-native-mobile-sync.md`

- [ ] **Step 1：启动同步服务与 Electron**

```bash
npm run dev:sync
npm run dev
```

验证静默开关后主窗口和工具栏不可见，快捷键仍注册，关闭静默后窗口恢复。

- [ ] **Step 2：启动 Metro 和 DevTools**

```bash
npm run start -w @interview-coder/mobile
npm exec -w @interview-coder/mobile react-devtools
```

确认 Metro 正常启动且 DevTools 进程可运行。

- [ ] **Step 3：执行全量质量门禁**

```bash
npm test --workspaces --if-present
npm run typecheck
npm run typecheck --workspaces --if-present
npm run lint
npm run build
```

预期：全部通过。若本机缺少 JDK、Android Emulator 或 Xcode，只能记录原生构建未执行，不能宣称真机或模拟器验证通过。

- [ ] **Step 4：自审计划覆盖**

确认静默启动、移动端实时结果、协议白名单、配对鉴权、断线恢复、DevTools 下载和测试执行均有对应代码与验证证据。
