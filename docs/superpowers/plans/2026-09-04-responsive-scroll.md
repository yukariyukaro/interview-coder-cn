# 响应式滚动体验改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将电脑端和手机端的同步翻页统一为视窗高度的 75%，并为快捷键长按提供连续小步滚动，同时保证答案流式生成期间仍可滚动。

**Architecture:** 在同步协议中携带可选的滚动距离比例，未携带时按 75% 兼容旧消息。主进程将一次按键与系统按键重复区分为完整翻页和连续小步滚动；桌面端和移动端都基于当前滚动位置、内容高度和视窗高度计算并钳制目标位置。

**Tech Stack:** Electron globalShortcut、React、React Native ScrollView、TypeScript、Vitest、Jest。

---

### Task 1: 更新共享滚动协议

**Files:**

- Modify: `packages/sync-protocol/src/index.ts`
- Test: `packages/sync-protocol/src/index.test.ts`

- [x] 将默认翻页比例定义为 `0.75`，连续滚动比例定义为 `0.1`，并让 `control.scroll.payload.distanceRatio` 可选且限制在 `(0, 1]`。
- [x] 保留不带 `distanceRatio` 的旧消息兼容性。
- [x] 增加接受完整翻页、连续滚动和拒绝非法比例的测试。

### Task 2: 实现主进程长按识别

**Files:**

- Create: `src/main/scroll-input.ts`
- Test: `src/main/scroll-input.test.ts`
- Modify: `src/main/mobile-sync.ts`
- Test: `src/main/mobile-sync.test.ts`
- Modify: `src/main/shortcuts.ts`
- Test: `src/main/shortcuts-ipc.test.ts`

- [x] 新增可注入时钟和定时器的滚动输入控制器：首次触发返回 `0.75`，同方向且在系统重复窗口内再次触发返回 `0.1`，超时后恢复完整翻页。
- [x] 让桌面 IPC 事件和手机同步控制消息都携带同一个 `distanceRatio`。
- [x] 保证答案生成状态不参与滚动快捷键的拦截条件。

### Task 3: 修复桌面端目标位置计算

**Files:**

- Create: `src/renderer/src/lib/scroll.ts`
- Test: `src/renderer/src/lib/scroll.test.ts`
- Modify: `src/renderer/src/coder/AppContent.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [x] 按 `scrollHeight - clientHeight` 计算最大位置，向上和向下都钳制在合法范围。
- [x] 连续小步滚动使用当前目标位置继续计算，避免动画尚未结束时重复事件互相覆盖。
- [x] 滚动事件继续注册在 Coder 页面，不依赖 `isLoading`，覆盖流式生成中的答案。

### Task 4: 修复移动端目标位置计算

**Files:**

- Modify: `apps/mobile/src/sync/page-scroll.ts`
- Test: `apps/mobile/src/__tests__/page-scroll.test.ts`
- Modify: `apps/mobile/App.tsx`
- Test: `apps/mobile/src/__tests__/App.test.tsx`

- [x] 让 `getNextPageOffset` 接收协议传入的 `distanceRatio`，缺失时使用 75%。
- [x] 将远端命令的距离比例带入手机端目标位置计算，连续命令从上一个目标位置继续累加。
- [x] 在内容高度变化时重新钳制目标位置，确保 AI 流式增长后仍可继续翻页。

### Task 5: 全量验证

**Files:**

- Verify: `packages/sync-protocol/src/index.test.ts`
- Verify: `src/main/scroll-input.test.ts`
- Verify: `src/main/mobile-sync.test.ts`
- Verify: `src/main/shortcuts-ipc.test.ts`
- Verify: `src/renderer/src/lib/scroll.test.ts`
- Verify: `apps/mobile/src/__tests__/page-scroll.test.ts`
- Verify: `apps/mobile/src/__tests__/App.test.tsx`

- [x] 运行协议、主进程和渲染端 Vitest 测试。
- [x] 运行移动端 Jest 测试。
- [x] 运行 Node、Web 及 workspace 类型检查。
- [x] 运行差异格式检查，确认没有引入非预期文件。
