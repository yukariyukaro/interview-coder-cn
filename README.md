# 截屏解题助手 / 编码面试助手 / 在线考试助手

![使用演示](https://github.com/user-attachments/assets/19781594-3108-4711-a54b-9d36496787bc)

## 项目简介

这是一个面向中文用户的截屏解题助手：按下快捷键截取屏幕，AI 实时分析屏幕上的题目并给出解答。窗口对屏幕分享软件隐身，且不会抢占焦点。适配国内 AI 生态，简单易用。

### 核心能力

- **截屏解题**：通过快捷键抓取屏幕内容（可附带电脑声音的实时转录文字），发送给视觉大模型分析，流式展示解答；支持追加截图和追问，保持对话上下文连续
- **场景化解题**：每个场景可独立配置快捷键、模型、reasoning effort 和提示词；按对应快捷键即可切换场景并截图
- **屏幕分享隐身**：即使被要求分享屏幕，对方也看不到本助手的窗口
- **静默后台运行**：主窗口和悬浮工具条完全隐藏后，截图和 AI 快捷键仍可继续工作
- **移动端同步**：通过配对码将解题状态和流式答案同步到 Android/iOS 客户端，不传输截图和 AI Key
- **不抢占焦点**：窗口置顶半透明展示，不会导致原页面失焦，可规避“跳出网页”检测

### 适用场景

- **编程面试 / 笔试**：分析屏幕上的题目，实时给出解题思路和代码，支持 Python、JavaScript、Java、C++ 等主流编程语言
- **英语机试**：切换到「英语考试」场景，还可结合语音转录处理听力题
- **能力测评 / 行测**：逻辑推理、归纳（图形）推理、数字推理题，切换到「能力测评」场景，直接给出选项和关键依据
- **在线考试**：单选、多选、解答等通用题型，切换到「通用问答」场景即可
- **其他场景**：添加自定义提示词场景，自行扩展

## 如何使用

> 注意：项目有编译安装包，你也可以直接下载安装包使用（如何安装，以及安装完后如何配置，请参考 [Wiki 教程](https://github.com/ooboqoo/interview-coder-cn/wiki/%E7%9B%B4%E6%8E%A5%E4%B8%8B%E8%BD%BD%E5%AE%89%E8%A3%85%E5%8C%85%E4%BD%BF%E7%94%A8)）。

> 注意：详细的使用教程请移步本项目的 [Wiki](https://github.com/ooboqoo/interview-coder-cn/wiki) 页面查看。

### 1. 安装依赖

注：项目运行依赖 Node.js 环境，如未安装请先安装 [下载地址](https://nodejs.org/zh-cn/download)。

```bash
$ npm install
```

### 2. 启动程序开始正常使用

```bash
$ npm run dev
```

### 3. 配置 API Key

> 注意，应大家的要求，从 1.6 版本开始，添加了对「硅基流动」API 的支持，方便大家使用国内模型。

启动程序后，进入「设置」页面，配置 `API Base URL` 和 `API Key`。

API 地址和 API Key 需要从支持 OpenAI API 的代理服务商处获取。如国内的 [硅基流动](https://cloud.siliconflow.cn/i/SG8C0772) 或国外的 [OpenRouter](https://openrouter.ai/) 等服务商，支持支付宝付款。

当然，如果你（人在海外）可以直接使用 OpenAI 官方的 API 更好，只需要配置 `API Key` 就够了。

> 也可以在项目根目录创建 `.env` 文件预配置，程序启动后会自动读取作为默认值。

```env
API_BASE_URL="https://openrouter.ai/api/v1" # 聚合服务的 API 地址，这里以 OpenRouter 为例
API_KEY="sk-1234567890" # 代理服务商的 API Key，这里只是示例，需要改成你自己的
```

### 4. 配置场景快捷键

进入「设置 → 解题设置」，每个场景可以分别配置：

- 截图快捷键
- 模型（留空时使用 AI 设置中的默认模型）
- reasoning effort（仅对支持该参数的推理模型生效）
- 系统提示词

默认快捷键：

- 解算法题：macOS `Option+Enter`，Windows `Ctrl+Enter`
- 能力测评/选择题：macOS `Option+P`，Windows `Ctrl+P`
- 英语考试：macOS `Option+E`，Windows `Ctrl+E`
- 通用问答：macOS `Option+G`，Windows `Ctrl+G`

### 5. （可选）配置语音转录

语音转录功能可以实时将电脑播放的声音（如面试官讲话、听力音频）转为文字，并在截图时一起提交给 AI 辅助分析题意。

目前该功能固定使用 Fun-ASR 模型 (0.02元/分钟，新用户有10小时免费额度)，需要配置阿里云百炼平台的 API Key：

1. 访问 [百炼平台控制台](https://help.aliyun.com/zh/model-studio/get-api-key) 注册并创建 API Key
2. 在应用「设置」页面的「语音转录」部分填入 API Key
3. 使用快捷键（默认 `Alt+T` / `Ctrl+T`）开始/暂停语音转录

### 6. （可选）启动移动端同步

先启动 WebSocket 中继服务：

```bash
npm run dev:sync
```

再启动桌面端：

```bash
npm run dev
```

桌面端进入「设置 -> 移动端同步」，填写同步服务地址、生成 32 至 64 位桌面密钥并启用同步。手机端点击「扫描电脑端二维码」即可保存连接配置并建立连接；手动输入保留为故障兜底。桌面密钥不要发送到手机或其他设备。

- 电脑端向上/向下翻页快捷键会同步控制同一配对房间内的所有手机，每次按当前可视高度的 75% 滚动；生成期间即时滚动，生成结束后使用平滑滚动，长按时自动切换为连续小步滚动
- 翻页指令仅实时发送，不会保存到答案快照，也不会在手机重连后补执行

- Android 模拟器访问本机中继：`ws://10.0.2.2:8787`
- iOS 模拟器访问本机中继：`ws://127.0.0.1:8787`
- Android 真机通过 USB 调试连接时，先执行 `adb reverse tcp:8787 tcp:8787`，再使用 `ws://127.0.0.1:8787`
- 真机通过局域网或公网连接时，需要使用可访问的 HTTPS/WSS 测试域名；桌面端仅允许远端 `wss://`

首次运行 Android 客户端前，需要安装 Android Studio，并通过 SDK Manager 安装 Android SDK、Platform Tools 和 Emulator。创建并启动 AVD，或连接已开启 USB 调试的真机，然后安装 Development Build：

```bash
cd apps/mobile
npx expo run:android --device
```

扫码功能使用业务 App 内置相机，不依赖 Expo Development Build 首页的「Scan QR Code」。新增或升级 `expo-camera` 后需要重新构建 Development Build，仅刷新 Metro Bundle 不会更新原生模块。

`expo run:android` 会同时启动 Metro。后续调试无需重复原生构建：

```bash
cd ../..
npm run android -w @interview-coder/mobile
npm run ios -w @interview-coder/mobile
npm run devtools -w @interview-coder/mobile
```

React Native DevTools 已作为开发依赖安装；Metro 启动后也可以按 `j` 打开内置 DevTools。

### 7. 测试

```bash
npm test --workspaces --if-present
npm run typecheck
npm run typecheck --workspaces --if-present
npm run lint
npm run build
```

## 关于隐身能力的说明

目前隐身功能适配市面上大部分会议软件(如 腾讯会议 等)，但很少部分软件和浏览器可能无法正常隐身。使用前自己做好测试，本项目不承担任何责任。相关问题欢迎大家提 Issue 讨论。

## 视频教程

具体可到 [Wiki](https://github.com/ooboqoo/interview-coder-cn/wiki) 页面查看。

## 许可协议（License）

本项目采用 **[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh)** 协议许可。

您可以自由使用、复制、修改本项目代码，但 **禁止任何形式的商业用途**，包括但不限于售卖、集成入商业产品、SaaS 服务等。

如需商业授权，请联系作者获得书面许可。

## 类似项目

原 [Interview-Coder](https://github.com/ibttf/interview-coder) 项目在网络上爆火之后，出现了很多类似的项目（本项目也是其中一个），每个项目都各有特色，这里列举一些比较火的项目供参考。

- https://github.com/sohzm/cheating-daddy 作者是前段时间在硅谷大热的争议程序员 Soham Parekh
- https://github.com/pickle-com/glass
- https://github.com/j4wg/interview-coder-withoupaywall-opensource
