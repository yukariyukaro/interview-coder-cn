# 场景快捷键与流式滚动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 支持用不同全局快捷键直接选择解题场景并截图，每个场景独立配置模型、提示词和 reasoning effort，同时保证 AI 流式渲染不阻塞桌面与手机滚动。

**架构：** 场景配置继续由 renderer Zustand 持久化，并完整同步到 Electron 主进程。renderer 将场景快捷键转换为 `captureScene:<sceneId>` 动作注册；主进程解析动作、切换权威场景后复用现有截图解题流程。AI 输出通过 `smoothStream` 拆分上游大块文本，再由主进程定时合并 delta，减少两端 Markdown 全量重渲染；生成期间滚动取消动画以避免持续布局变化中断滚动。

**技术栈：** Electron、React、Zustand、Vercel AI SDK、Vitest、React Native、Jest。

---

### Task 1：扩展场景配置

**文件：**

- 修改：`src/renderer/src/lib/store/settings.ts`
- 修改：`src/main/settings.ts`
- 修改：`src/main/settings.test.ts`

- [x] 为 `PromptScene` 增加 `model`、`reasoningEffort`、`shortcut`。
- [x] 预设场景提供跨平台默认快捷键，能力测评和英语考试默认使用较低推理强度。
- [x] 设置存储升级到 v9，迁移时补齐旧场景缺少的字段。
- [x] 主进程严格校验场景数组后再保存。

### Task 2：实现动态场景快捷键

**文件：**

- 创建：`src/renderer/src/lib/scene-shortcuts.ts`
- 创建：`src/renderer/src/lib/scene-shortcuts.test.ts`
- 修改：`src/renderer/src/App.tsx`
- 修改：`src/main/shortcuts.ts`
- 修改：`src/main/shortcuts-ipc.test.ts`
- 修改：`src/preload/index.ts`

- [x] 将非空场景快捷键转换为 `captureScene:<sceneId>` 注册项。
- [x] 主进程只接受已同步场景 ID，切换场景后调用现有新会话截图流程。
- [x] 场景切换事件同步回 renderer，使界面与持久化状态保持一致。
- [x] 重新初始化时注销已删除或改名场景遗留的全局快捷键。

### Task 3：增加场景模型、推理强度和快捷键界面

**文件：**

- 创建：`src/renderer/src/settings/ShortcutRecorder.tsx`
- 修改：`src/renderer/src/settings/index.tsx`
- 修改：`src/renderer/src/settings/SelectModel.tsx`

- [x] 当前场景可选择独立模型；留空时继承默认模型。
- [x] 当前场景可选择模型默认、minimal、low、medium、high。
- [x] 当前场景可录制或清除全局快捷键。

### Task 4：改善流式输出

**文件：**

- 修改：`src/main/ai.ts`
- 创建：`src/main/ai.test.ts`
- 创建：`src/main/solution-delta-buffer.ts`
- 创建：`src/main/solution-delta-buffer.test.ts`
- 修改：`src/main/shortcuts.ts`

- [x] 所有 AI 请求使用 Unicode 安全的 `smoothStream` 拆包。
- [x] 根据当前场景配置向 reasoning model 传递 reasoning effort。
- [x] 合并短时间内的 `solution.delta`，终态事件前立即冲刷。

### Task 5：让滚动独立于流式布局

**文件：**

- 修改：`src/renderer/src/lib/scroll.ts`
- 修改：`src/renderer/src/lib/scroll.test.ts`
- 修改：`src/renderer/src/coder/AppContent.tsx`
- 修改：`apps/mobile/App.tsx`
- 修改：`apps/mobile/src/__tests__/App.test.tsx`

- [x] 生成期间使用即时滚动，生成结束后保留整页平滑滚动。
- [x] 桌面和手机都基于实时视口高度计算距离，不引入固定像素滚动值。

### Task 6：验证

- [x] 运行 `npm test`。
- [x] 运行 `npm test -w @interview-coder/mobile`。
- [x] 运行 `npm run typecheck` 和移动端 typecheck。
- [x] 运行 `npm run lint`。
- [x] 运行 `npm run build`。
