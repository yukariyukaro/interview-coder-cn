# 电脑快捷键控制手机端翻页实施计划

## Summary

在保留电脑端现有翻页行为的同时，让 `Cmd/Ctrl+J`（向上翻页）和
`Cmd/Ctrl+K`（向下翻页）通过已经建立的配对 WebSocket，控制同一配对房间内
所有已连接手机同步翻页。静默模式不关闭主进程或 WebSocket，因此电脑窗口不可见时
同样可以发送控制指令。

翻页属于瞬时控制命令，不属于可恢复的答案状态。实现时新增独立的
`control.scroll` 消息，不写入服务端快照、不参与答案事件序号，也不在手机重连后重放。

## Current State Analysis

- `src/main/shortcuts.ts`
  - `pageUp` / `pageDown` 目前只向 Electron renderer 发送
    `scroll-page-up` / `scroll-page-down` IPC。
  - 快捷键要求 `state.inCoderPage`，静默模式下 coder 页面仍然挂载，因此该条件不会阻止
    后台控制。
- `src/renderer/src/coder/AppContent.tsx`
  - 电脑端原先使用固定像素重叠；改为按滚动容器当前可视高度计算。
- `src/main/mobile-sync.ts`
  - 桌面端已维护经过认证和自动重连的 WebSocket，但目前只能发送 `SyncEvent`。
- `packages/sync-protocol/src/index.ts`
  - 当前协议只有可恢复的答案事件，事件带 `sessionId` / `seq`，服务端会据此维护快照。
- `apps/sync-server/src/server.ts`
  - 只允许已认证桌面端发送消息，并把合法答案事件转发给同房间手机。
  - 每个房间支持一个桌面端和最多五个手机端，天然适合把控制命令广播给所有已配对手机。
- `apps/mobile/src/sync/use-sync-connection.ts`
  - 手机端认证后只解析答案事件，未暴露瞬时控制信号。
- `apps/mobile/App.tsx`
  - 页面使用一个外层 React Native `ScrollView`，可通过 ref 执行平滑的绝对位置滚动。

## Proposed Changes

### 1. 增加独立的瞬时控制协议

修改 `packages/sync-protocol/src/index.ts`：

- 新增严格结构 `SyncControlMessage`：
  - `version`: 当前协议版本。
  - `type`: 固定为 `control.scroll`。
  - `commandId`: 桌面端生成的唯一 ID。
  - `timestamp`: 发送时间。
  - `payload.direction`: `up` 或 `down`。
- 新增 `parseSyncControlMessage()`。
- 保持 `SyncEvent` 不变，控制消息不携带 `sessionId` 和 `seq`，避免与答案恢复逻辑耦合。
- 不调整二维码与鉴权协议。

修改 `packages/sync-protocol/src/index.test.ts`：

- 验证上下翻页消息可以解析。
- 验证非法方向、缺失字段、额外字段和错误版本被拒绝。

### 2. 从现有桌面 WebSocket 发送控制命令

修改 `src/main/mobile-sync.ts`：

- 为 `MobileSyncClient` 增加 `sendScrollCommand(direction)`。
- 仅在 WebSocket 已认证且处于 OPEN 状态时发送。
- 使用可注入的 `createCommandId` 和 `now` 生成命令元数据，便于稳定测试。
- 导出主进程入口 `sendMobileScrollCommand(direction)`。
- 发送失败只返回 `false`，不影响电脑端本地翻页，也不触发额外重连。

修改 `src/main/shortcuts.ts`：

- `pageUp` 继续发送本地 `scroll-page-up` IPC，同时发送远端 `up` 命令。
- `pageDown` 继续发送本地 `scroll-page-down` IPC，同时发送远端 `down` 命令。
- 保留现有 `mainWindow`、销毁状态和 `state.inCoderPage` 校验。
- 不增加新快捷键，沿用用户已有的自定义快捷键配置。

修改 `src/main/mobile-sync.test.ts`：

- 覆盖认证前拒绝发送、认证后正确序列化、Socket 非 OPEN 时拒绝发送。
- 验证连续同方向命令具有不同 `commandId`。

修改 `src/main/shortcuts-ipc.test.ts`：

- 验证 `pageUp` / `pageDown` 同时触发本地 IPC 和对应的移动端控制命令。
- 验证不在 coder 页面时两端都不触发。

### 3. 服务端只转发、不持久化控制命令

修改 `apps/sync-server/src/server.ts`：

- 已认证桌面端消息先按控制消息解析，再按答案事件解析。
- `control.scroll` 直接广播给当前房间所有 OPEN 的手机连接。
- 不调用 `updateSnapshot()`，不修改 `snapshotBytes`、答案序号或房间恢复状态。
- 未认证客户端、手机端上行、非法控制结构仍按现有策略以 1008 关闭。
- 继续复用现有 payload、连接数和 backpressure 限制。

修改 `apps/sync-server/src/server.test.ts`：

- 验证控制命令广播给同一房间全部手机。
- 验证其他配对房间收不到命令。
- 验证控制命令不会出现在新连接手机收到的快照中，也不会改变快照序号。
- 验证非法控制命令关闭桌面连接。

### 4. 手机端消费命令并执行稳定翻页

修改 `apps/mobile/src/sync/use-sync-connection.ts`：

- 认证后的消息先识别 `SyncControlMessage`。
- 返回新增字段 `scrollCommand`，包含 `commandId` 和 `direction`。
- 控制命令不进入 `sessionReducer`，因此不改变答案、请求状态和 `lastSeq`。
- 使用最近一个 `commandId` 去重，连续两个同方向但 ID 不同的命令仍会分别执行。
- 非法控制消息与非法答案事件统一进入现有协议错误流程。

新增 `apps/mobile/src/sync/page-scroll.ts`：

- 提供纯函数计算下一页目标位置。
- 每次移动当前可视高度的 85%，保留 15% 上下文重叠区域。
- 将目标限制在 `0` 到 `contentHeight - viewportHeight`。
- 内容不足一屏时保持在顶部。

修改 `apps/mobile/App.tsx`：

- 为外层 `ScrollView` 添加 ref。
- 通过 `onLayout`、`onContentSizeChange` 和 `onScroll` 维护视口高度、内容高度及当前目标位置。
- 监听 `scrollCommand.commandId`，调用
  `scrollTo({ y: target, animated: true })`。
- 用户手动滚动时同步目标位置，避免随后远程翻页跳回旧位置。
- 不新增可见按钮或说明文字，手机端交互外观保持不变。

修改移动端测试：

- `apps/mobile/src/__tests__/use-sync-connection.test.ts`
  验证控制消息被暴露、重复 ID 被忽略、答案状态不变。
- 新增 `apps/mobile/src/__tests__/page-scroll.test.ts`
  覆盖上下翻页、不同视窗高度的响应式步长、首尾边界和短内容。
- `apps/mobile/src/__tests__/App.test.tsx`
  更新 hook mock 契约，并验证新命令触发 ScrollView 滚动。

### 5. 更新帮助文案

修改：

- `src/renderer/src/help/Shortcuts.tsx`
- `src/renderer/src/settings/CustomShortcuts.tsx`

将“向上翻页 / 向下翻页”说明调整为电脑和已连接手机同步翻页，不改变快捷键默认值。

更新 `README.md` 的移动端同步说明，注明：

- 翻页控制使用现有配对连接。
- 指令仅实时发送，不会在重连后重放。
- 同一配对房间内的所有手机会同时响应。

## Data Flow

1. 用户按下电脑端 `Cmd/Ctrl+J` 或 `Cmd/Ctrl+K`。
2. 主进程保留原有 renderer IPC，使电脑端继续翻页。
3. `MobileSyncClient` 在已认证 WebSocket 上发送 `control.scroll`。
4. 同步服务校验消息结构，并广播给该配对房间内所有手机。
5. 手机端连接 hook 将命令与答案事件分流。
6. `App.tsx` 根据当前视口和滚动位置计算目标位置，平滑滚动一页。

## Assumptions & Decisions

- 已确认采用“电脑和手机同步翻页”。
- 一个配对房间内没有“主手机”概念，因此所有已连接手机同时响应。
- 命令采用 best-effort 实时交付；手机离线时不缓存、不补发。
- 不添加控制回执。WebSocket 已提供有序传输，翻页失败不会影响答案同步。
- 控制协议是单仓库内的增量能力；桌面端、同步服务和手机端需一起升级。
- 本功能只改变翻页控制，不扩展为手机端反向控制电脑。

## Verification

### 自动化验证

执行：

```bash
npm run typecheck
npm run typecheck -w @interview-coder/sync-protocol
npm run typecheck -w @interview-coder/sync-server
npm run typecheck -w @interview-coder/mobile
npm test
npm test -w @interview-coder/sync-server
npm test -w @interview-coder/mobile
npm run lint
```

重点断言：

- 控制命令严格校验且不携带答案、截图或 API Key。
- 服务端不持久化、不重放控制命令。
- 同房间多手机收到相同命令，其他房间隔离。
- 断线时快捷键仍能正常滚动电脑端，不产生未处理异常。
- 手机手动滚动后，下一次远程翻页以新的位置为基准。

### Android 真机验收

1. 启动同步服务、桌面端和已配对 Android Development Build。
2. 准备超过两屏的答案，记录手机首屏可见段落。
3. 电脑窗口显示时按 `Cmd/Ctrl+K`，确认电脑和手机都向下平滑翻一页。
4. 按 `Cmd/Ctrl+J`，确认两端向上翻一页且不会越过顶部。
5. 启用电脑端静默模式，再按上下翻页快捷键，确认手机仍响应。
6. 连续快速按两次同方向快捷键，确认手机执行两次而非合并为一次。
7. 将手机滚到底部或顶部后继续按对应快捷键，确认无越界和抖动。
8. 断开手机网络后按快捷键，确认电脑端仍正常；手机重连后不补执行离线期间的命令。
9. 使用 React Native DevTools 检查命令到达时只更新瞬时控制状态，不导致答案树不必要重渲染。
