# zcode-statusbar · ZCode 底部数据统计条

在 [ZCode](https://z.ai)（Z.ai Agentic Development Environment）窗口的输入框正下方，显示当前会话的实时数据统计条：

```
本问 ⏳ 44 tok/s · 16.7k tok │ 累计 3 轮 41 步 · 40 tok/s │ 🛢 2.79M tok
```

鼠标悬停在条上会弹出「会话统计」面板：模型用时、工具调用用时、首 token 平均等待（TTFT）、输出速度、缓存命中率，以及本问明细和累计输入/输出。

## 核心优点

| | 优点 | 说明 |
| --- | --- | --- |
| 🚀 | **即下即用** | 零 npm 依赖、零构建、零配置——只用 Node 内置模块，下载解压后双击启动器即可 |
| 🎯 | **精确，不是猜** | 指标读的是 ZCode 自己落盘的 SQLite 统计表（`turn_usage` / `model_usage`），不是从 DOM 里猜 |
| 🛡️ | **不碰安装目录** | 完全不修改 `app.asar`，ZCode 怎么更新都不用重做；走 Electron 官方 CDP 调试协议注入 |
| 🩺 | **会自愈** | 页面刷新自动重装、条被改掉自动恢复、注入器挂了 15 秒内自己隐藏并还原输入框布局 |
| 🔒 | **只读，纯本地** | 只读 ZCode 的 SQLite（只读方式打开），无网络请求、不 spawn 子进程 |

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| 操作系统 | Windows 10/11（启动脚本为 cmd/VBS） |
| Node.js | ≥ 22（用到内置 `node:sqlite` 和全局 `WebSocket`），`node -v` 可查 |
| ZCode | 桌面版（Electron 应用） |

## 快速开始

**1. 获取**（二选一）：

```bash
git clone https://github.com/xyqmbyl/zcode-statusbar.git
cd zcode-statusbar

# 或者：GitHub 页面绿色 Code 按钮 → Download ZIP，解压后进入目录即可
```

**2. 启动**：双击 **`启动ZCode(带状态栏).cmd`**，它会自动：

1. 检查 Node 和 ZCode.exe（找不到就把 ZCode.exe 的完整路径填进文件里的候选列表）；
2. ZCode 已在运行时询问是否重启（调试端口只能在启动时开启）；
3. 带 `--remote-debugging-port=9222` 启动 ZCode，等端口就绪后后台拉起注入器；
4. 统计条出现在 ZCode 窗口输入框正下方。

ASCII 名字的 `start-zcode.cmd` 是同一个入口的转发（有些终端处理不了非 ASCII 文件名），双击哪个都一样。

**3. （可选）装个桌面快捷方式**：双击 `创建桌面快捷方式.vbs`，之后点桌面图标就能带统计条启动。

## 常用命令

```bash
node zcode-statusbar.mjs --print          # 只打印当前指标，不注入（自检）
node zcode-statusbar.mjs --port 9222      # 指定调试端口
node zcode-statusbar.mjs --interval 1200  # 指定采样间隔（毫秒，最低 500）
node zcode-statusbar.mjs --session sess_xxx  # 锁定跟踪某个会话
```

日志与停止：

- 注入器日志写在同目录 `statusbar.log`；
- **停止**：关闭那个最小化的「ZCode 状态栏」控制台窗口（退出时会把统计条撤掉、输入框布局还原）。

## 工作原理

1. ZCode 以 `--remote-debugging-port=9222` 启动（代码里没有任何地方剥离该开关，官方调试协议直接生效）；
2. 注入器通过 CDP 往渲染进程注入一段自包含的 `overlay.js`，只把自己挂到 `document.body` 同级、`position:fixed` 摆放，不依赖 ZCode 的类名/DOM 结构/打包 chunk 文件名，永远鼠标穿透不挡按钮；
3. 指标由注入器从 ZCode 自己的 SQLite 统计表算好推给页面（`~/.zcode/cli/db/db.sqlite`），SQL 按实际列自适应拼接，页面侧只负责画；
4. 注入器长期无推送时，页面端 15 秒看门狗自动藏条、还原输入框内边距——守护进程被杀也不会留下一串过期数字。

条会跟随**屏幕上当前打开的会话**（读 ZCode 侧栏的选中项），而不是「最近有动静的会话」；认不出时退化到最近有活动的会话并在日志里说明。

## 常见问题

- **条一直不出现**：确认 ZCode 是用本启动器（或带 `--remote-debugging-port=9222`）启动的。调试端口只能在启动时开启；ZCode 设置了关闭时最小化到托盘，普通关闭不会退出进程，需要先在托盘里彻底退出。
- **ZCode 已经在运行，没开调试端口**：启动器会询问是否强制重启（调试端口只能在启动时传）。静默模式下会以退出码 3 交回给调用方。
- **更新 ZCode 后要重装吗？** 不用。不修改 asar、不依赖打包后的文件名/类名，ZCode 更新后照常工作。
- **在杀毒软件报毒 / 误报？** 本工具只是调 `127.0.0.1:9222` 的本地调试端口读数据，无网络行为，可加白名单。
- **如何确认工具本身是好的？** `node zcode-statusbar.mjs --print` 能打印指标即正常；连不上端口会明确报错并提示重启方式。

## 卸载

关闭那个最小化的「ZCode 状态栏」控制台窗口即可（或任务管理器结束 `node` 运行的 `zcode-statusbar.mjs`）。不留下任何常驻服务、不修改 ZCode 任何文件。

## License

[MIT](LICENSE)
