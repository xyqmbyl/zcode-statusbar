# ZCode 底部数据统计条

给 **ZCode**（Z.ai Agentic Development Environment）在**输入框正下方**的空隙里加一条和 DSH 一样的数据统计条：

```
◐ 本问 94 tok/s · 6.0k tok  │  累计 26 轮 196 步 · 74 tok/s  │  ▤ 17M tok
```

左边是**本问**（最近一轮：这一问问得值不值），右边是**累计**（整个会话）。
它压在**输入框卡片正下方**（右端与输入框卡片右端对齐），**没有背景色、没有边框**，
就是一行右对齐的字（靠一层同色系的柔光保证压到聊天内容上也还看得清）。
为了让它放得舒服，脚本会把输入框**往上抬 15px**（详见第二节「摆放与空隙」）。

它**只在工作区出现**：一进设置页就整条隐藏、顺手把输入框的内边距还回去，
点「返回工作区」它自己回来（不用刷新）；ZCode 刚启动时的欢迎页 / 项目列表上
同样不显示 —— 判据是「输入框在不在、贴不贴底」，不是去认页面
（详见第二节「只在工作区显示」「欢迎页 / 项目列表也藏掉」）。

---

## 一、结论先说：为什么不能用「插件」

ZCode 的插件系统（`~/.zcode/cli/plugins/`）**没有 UI 扩展点**。

一个 ZCode 插件能贡献的东西只有四种：`skills` / `commands` / `agents` / `hooks` / `mcpServers`
（见官方市场里的开发文档 `plugin-features-reference.md`，以及任一插件的 `plugin.json` 结构）。
Claude Code 的 `statusLine` 设置在 ZCode 3.11.2 里**没有实现** —— 在 `app.asar` 里搜索
`statusLine` 命中数为 0。

所以「装一个插件就有统计条」这条路不存在。**能用的是脚本**，本目录就是。

#### 参考过的一个现成项目：`shy3130/zcode-tps-monitor`

立项之后看过一个已经有人写好的同类：**[shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor)**。
结论是**它和本项目不冲突，但也不能替代** —— 顺带它也从反面印证了上面那条判断：

* 它是一个**真正的 ZCode 插件**（自带 `marketplace.json`，`plugins/zcode-tps-monitor/` 里有
  `.zcode-plugin/plugin.json` + `.claude-plugin/plugin.json` + `.mcp.json`），
  装了之后提供 `/tps`、`/tps 10`、`/tps-doctor`、`/zcode-tps-monitor:dashboard` 四个命令，
  以及 `tps_snapshot` / `tps_watch` 两个 MCP 工具，另有一个跑在
  `http://127.0.0.1:7423` 的看板（空闲 180 分钟自动退出）。
  它读的**是同一张表** `~/.zcode/cli/db/db.sqlite`，tok/s 的算法也和我们一致
  （Σ 输出 token ÷ Σ(生成时长 − 首 token 等待)）。
* **但它的统计条不出现在 ZCode 界面里。** 它靠 hook + 一个 model-run 脚本
  **把这一行写进助手的回复正文**；README 里那个「悬浮条」是
  `dashboard/overlay.ps1` —— 一个**独立的、总在最前的 Windows PowerShell 窗口**，
  和 ZCode 是两扇窗。这正是「ZCode 插件没有 UI 扩展点」的直接后果：
  想要一条**真的长在输入框底下**的条，插件做不到，只能从外面注入。
* 它额外做了一件我们现在没做的事：**按轮（本问）的指标** —— 本轮的 tok/s、首字延迟
  （TTFT）、输出 token / 生成时长、段数与峰值，以及一个防串台的 `--current` 护栏
  （免得把上一轮的数显示成本轮）。想要「本问」这一档的话，这是现成参考。
* 它要求 Node ≥ 22.5（用了 `node:sqlite`），并且两条已知限制值得记一下：
  纯问答轮不出行；「业务 TPS」那半在没有配 `metrics_url` 时显示的是**演示数据**。
* 本机**没有装它**（`~/.zcode/plugins`、`~/.zcode/marketplaces`、
  `tps-monitor.config.json` 都不存在；`~/.zcode/cli/plugins` 下只有官方那批：
  browser-use / computer-use / document-skills / github / skill-creator）。

**没采用它的原因**：我们要的恰是「贴在输入框正下方」这一条，而它做不到这一点；
反过来说，它擅长的「命令 / MCP / 看板 / 按轮体检」我们也没做。
两者可以并存，互不覆盖。

---

## 二、它是怎么做到「一直适配」的

核心原则：**绝不修改 `app.asar`。**

| 做法 | 能不能扛住 ZCode 更新 |
|---|---|
| 改 `app.asar`（解包→改渲染层代码→重新打包） | ✗ ZCode 每次更新整个覆盖 `resources/app.asar`；渲染层 chunk 名是内容哈希（如 `IntlProvider-Db46X9QF.js`）且压缩混淆，每次更新都要重做，改坏还开不了机 |
| 装第三方主题 / 覆盖 CSS 文件 | ✗ 同上，文件会被覆盖 |
| **本项目：外部 CDP 注入** | ✓ 不碰 ZCode 任何文件 |

本项目利用 Electron/Chromium 官方的调试协议（CDP）从「外面」把浮层注入渲染进程：

```
启动ZCode(带状态栏).cmd
      │
      ├─ 1. 以 --remote-debugging-port=9222 启动 ZCode.exe
      │
      └─ 2. 后台运行 zcode-statusbar.mjs
                │
                ├─ 读 ~/.zcode/cli/db/db.sqlite  →  算出 5 个指标
                │     （ZCode 自己的统计面板用的就是这几张表）
                │
                └─ 连 127.0.0.1:9222 的 CDP
                      ├─ Page.addScriptToEvaluateOnNewDocument(overlay.js)
                      │     → 新文档一建立就先注入一次
                      └─ Runtime.evaluate(...) 推送最新指标
                            · 指标一变就推（下一轮 tick，≤1.2s）
                            · 另每 ~2.5s 心跳重申一次
                            → overlay.js 只负责画一个 position:fixed 的文字条
```

**四层解耦，每一层都不认识 ZCode 的内部实现：**

1. **不依赖 DOM 结构** —— 浮层挂在 `document.body` 下、和 React 根节点**同级**，不插进 React 的树里，
   所以既不会被 React 的 diff 清掉，也不会影响 ZCode 的布局。附带 `MutationObserver`
   自愈：万一节点被移除就自动补回来。

   实测（ZCode 3.11.2）：

   ```
   bodyChildren: ["DIV#root", "DIV#zcsb-bar"]     ← 状态条是 React 根节点的兄弟
   rootClass:    "dark theme-zai-dark platform-windows-desktop zcsb-dark"
   ```

   刷新页面（`Page.reload`）后，React 根节点被整个重建。这里有个**实测踩到的坑**：
   `Page.addScriptToEvaluateOnNewDocument` 是在文档还**几乎空白**时执行的，那一刻
   `document.body` 还不存在（有时连 `document.documentElement` 都是 null），第一次挂载会落空。
   所以 `overlay.js` 里补了两件事：

   - **自举**：页面刚起来的那几秒内每 40ms 补挂一次，一等到 `<body>` 就位立刻挂上；
   - **本地缓存**：把上一轮指标写进 `localStorage`，重载后先按旧值画出来，
     不会出现「等待 ZCode 会话…」的空档。

   实测刷新后恢复时间：**271~767ms**（修这个坑之前要等下一次推送，长达 3.7s）。

   顺带一提，守护进程**不会**因为页面刷新就重新注入（日志里不会出现第二条
   「统计条已注入渲染进程」）—— 刷新后能恢复靠的是上面这套页面内自举 + 缓存，
   以及心跳推送兜底。这两条路都能独立把统计条找回来。
2. **不依赖类名/选择器** —— 那些是 hash 过的，每次构建都变。本项目一个都不用。
3. **不依赖打包 chunk 文件名** —— 同上。
4. **不依赖固定数据格式** —— 指标从 SQLite 读，SQL 按 `PRAGMA table_info` 的实际列拼接，
   ZCode 以后加列/减列不会直接崩，会自动降级。

**真正会随更新失效的只有一处**：数据库表名/列名如果被大改。出现这种情况时，
`node zcode-statusbar.mjs --print` 会打印警告，按提示改 `readMetrics()` 里的列名即可
（只用改一个文件，不涉及重新打包）。

### 摆放与空隙（v3 的重点，v5/v6 补的护栏，v7/v8/v9 改的横向对齐、字号与看门狗，v10 加的「只在工作区显示」，v11 扩到欢迎页/项目列表，v12/v13 修的反应速度，v14 修的窄窗口错位，v15 加的「本问」，v16 把横向对齐改成「对齐优先」，v17 修的本问口径与「条显示另一个会话的数字」，v18/v19 修的「条压在输入框上」，v20 修的量测口径（自检改量「空隙有没有出来」），v21 改用「画了底的卡片」认输入框、把「贴底」容差拆成两个用途，v22 修回的 tooltip，v23 把悬浮卡片升级成「会话统计」面板。**代码里的 `VERSION` 常量现在是 `23`**。v18 → v21 的机制说明见本节末尾，v22 / v23 见第三节末尾）

最早的版本是个「胶囊」，实测**会压住输入框底部那排按钮**。原因是量出来的：

```
输入框可编辑区   DIV[contenteditable]  x=294 y=826 w=744 h=40  bottom=866
输入框卡片       rounded-2xl border…   x=282 y=813 w=769 h=105 bottom=919
卡片外面的包裹层 padding-bottom:16px   x=266 y=813 w=801 h=121 bottom=935  ← 贴住窗口底
窗口高 935
```

也就是说**卡片底下只有 16px 真实空隙**（`935 − 919`），一条 13px 的字塞进去，
上下各只剩 1.5px 的呼吸位，视觉上就是贴着按钮。

所以 v3 做了两件事，都不依赖任何 ZCode 类名：

1. **把条放进那条空隙**。`composerBox()` 从「可编辑元素」往上走，走到**最后一个还没贴到
   窗口底的祖先**（= 卡片底边）就停，这个值就是条能用的上界；条的 `bottom` 由剩余空间算出
   （`底边空间 − GAP − 条高`），空隙真不够时按 `1.15` 行高一路收字号（13px → 最低 11px），
   **保证永远不会越到输入框上**，而不是硬压。
   （两句都要按后来的实测打个补丁：v21 起「走到最后一个没贴底的祖先」换成了「撞上**画了底的
   卡片**就停」——因为 3.14.3 把会话栏往下垫了 4.1px，贴底判定失效，老判据会多算 16px；
   v18 又给「收字号」后面补了最后一道闸：**连最小字号都塞不下时整条藏起来**，不再硬挤。
   两处都在本节末尾「v18 → v21」里。）
2. **把输入框抬上去，让空隙变舒服**。`findComposerWrap()` 继续往上走到那个
   **贴住窗口底**的包裹层（就是它用 `padding-bottom` 留出了那 16px），把它的
   `padding-bottom` 从 16px 改成我们需要的宽度（v8 是 `6 + 15 + 8 + 2 = 31px`）。
   因为这个包裹层是**内容撑高 + 底部对齐**的，加多少内边距，它就整体往上长多少 ——
   卡片跟着上移，底下的空隙就从容得下这一条。
   聊天滚动区（`overflow-y-auto`）自己吸收掉这点高度损失，没有别的副作用。

   这个改写**完全可逆**：只在页面运行时写内联样式，原始值记在 `data-zcsb-base-pad` 上
   （这样守护进程重启、覆盖层重装都不会越加越厚），`remove()` 时还原并删掉该属性。
   上限 `MAX_LIFT = 28px`，万一 ZCode 换了个陌生布局也不会被改花。

实测（1719×935 窗口，v8）：

```
输入框可编辑区   textarea         x=318 y=805  w=998  h=40  bottom=845
输入框卡片       rounded-2xl …    x=306 y=793  w=1023 h=105 bottom=898 → 抬高后 904.6
卡片外面的包裹层 padding-bottom 16px → 31px（贴住窗口底，被我们加厚）
窗口高 935
统计条           top=912 bottom=927 right=1329 width=246 字号 13px
→ 条右端 1329 = 卡片右端 1329（对齐），条上方净空 7px，下方 8px
```

`window.__zcodeSB.probe()` 可以把这些数字原样打出来（含 `composerRight`），
`verify-injection.mjs` 会自动断言它们。

#### 两条护栏（v5 / v6 修掉的真实 bug）

「抬输入框」这件事只有在**会话页、输入框真的贴着窗口底**时才有意义。第一版没判断这一点，
于是踩了两个坑，都实测复现过：

**坑一：在设置页把整页容器给撑了（v5 修）。** 进「设置 → MCP 服务器」时输入框并不在窗口底部：

```
输入框底边 618 / 窗口高 935        ← 差 317px，中间隔着整块设置面板
```

这时从输入框往上走，第一个「贴住窗口底」的祖先是**整页容器**（高 935），给它加
`padding-bottom: 28px` 一点好处都没有，还把整页内容挤了一下（实测 `wrapPadBase 0 → 28`）。

现在两条限制同时生效：

- `reserveRoom()` 先看 `窗口高 − 输入框底边`，**超过 `BOTTOM_ZONE = 160px` 就认定「输入框不在底部」**，
  直接 `releaseRoom()` 还原，什么都不碰（设置页、终端面板展开、分栏都属于这种）；
- `findComposerWrap()` 再要求候选包裹层**不能太高**（`高度 ≤ 窗口高 − 输入框底边 + 220px`），
  否则那就是整页容器，不是输入框的包裹层。

**坑二：看门狗藏了条，心跳又把输入框抬起来（v6 修）。** 注入器超时 15s 没推送时看门狗会藏条
并还原内边距，但每 3s 的心跳照旧调 `layout()` → `reserveRoom()`，于是**条藏起来了、输入框却还一直被抬着**，
`probe().padded` 一直是 1。现在 `staleNow()` 是唯一判据，`layout()` 进门先问一句：
过期就 `releaseRoom()` 返回；`update()` 一到就顺手 `layout()` 一次，不用等下一次心跳。

**坑三：判过期的代码有两条路，只修了一条（v9 修）。** 加 `.zcsb-stale` 这件事原来只写在 4 秒的
`watch` 定时器里，而它前面横着一道旧护栏 `if (!el || !last) return;`；更要命的是 `ensure()`
在 React 重建节点时会造出一个**新的**条元素，class 留在被丢弃的旧节点上。结果就是 19 秒没推送、
条还亮着（实测 `display=flex stale=false padded=1 sincePushMs=19013`）。v9 把过期判定搬进
3 秒的 `beat` 心跳（`staleNow()` → `markStale(el)`），删掉 `!last` 这道护栏，并给 `probe()`
加了 `hasLast`，好把「从来没推过」（刚注入、还没数据）和「推过但现在过期」分开看。

这两条都有可重复的测试：`guardtest.mjs` 不去点 ZCode 的 UI，只把 overlay 自己会量的那几个元素
（输入框及其祖先链，实测 16 个）的 `getBoundingClientRect` 临时抬高 300px，让真实布局「看起来」
输入框不在底部，然后等心跳触发真实的 `layout()`，断言内边距和 `data` 标记都归零；
恢复量测后再断言抬升自己回来了、且基准没被污染（`16 → 31 → 16 → 31`，不是 `16 → 31 → 47`）。

#### 横向对齐与字号（v7 / v8 修的真实问题，v9 沿用）

v3~v6 的条一直是 `right:5px` —— 也就是**钉在窗口右下角**。纵向位置其实没错（确实在卡片下方），
但在 1719px 宽的窗口里，输入框卡片右端在 x=1329，窗口右端在 1719，于是条挂在了离输入框
**右边 385px 处**，看着像「右下角的状态字」，而不是「输入框下面的统计」：

```
条 rect.right 1714       卡片 right 1329       ← 差 385px，几乎在窗口角落
```

v7 改成按卡片右端对齐，实测从 `probe()` 里就能读出来：

```js
rightPx = window.innerWidth - composerBox().right       // = 1719 − 1329 = 390
```

即条的右端与卡片右端重合；没探到输入框（设置页 / 终端页）时退回 `right:5px`。
另外收紧并明确了纵向：条顶边离卡片底边 `GAP = 6px`（原来是「贴着窗口底 8px」，
离卡片 17px 显得飘），条底边至少留 `MIN_BOTTOM = 3px`。

字号同时从 11px 提到 **13px**（`MIN_FS` 从 9px 提到 11px，不再允许缩到看不清），
对比度也提了一档：暗色 `--zcsb-fg` 从 `rgba(238,238,242,.70)` 提到 `.92`，
亮色从 `.78` 提到 `.88`，副文本透明度 `.62 → .78`，图标透明度 `.66 → .80`；
图标尺寸从固定 `11px` 改成 `1em`，字号被收小时跟着缩，不会把行撑歪。

v8 只补了一个像素级的坑：包裹层要多少内边距是拿 `BASE_FS` 算的
（`want = GAP + ceil(13×1.15) + TAIL + 2`），如果卡着整数要地方，卡片底边那点小数
（实测 `935 − 904.57`）会让 `13px` 被判成放不下、白掉一级到 12px。加 2px 余量后稳定在 13px：

```
v7 实测: fontSize 12px, 包裹层 16 → 29px
v8 实测: fontSize 13px, 包裹层 16 → 31px, top=912 bottom=927 right=1329 width=246
```

验证脚本也跟着加了断言：字号必须 ≥ 12px、条右端必须与 `composerRight` 相差 ≤ 3px、
条上方净空必须在 2~14px（「正下方」而不是「飘到窗口底」）。

#### 只在工作区显示（v10）

要求是「**只有工作区才显示，设置时不显示**」。这条听起来像 `if (在设置页) 隐藏`，
但 ZCode 里**没有「当前在设置页」这种东西可以问**：

* **设置页不是路由**。它是一层全屏覆盖层，URL 和 hash 从头到尾不变
  （一直是 `index.html?restoreSession=true&supportsSettings=true&…`），
  所以没法从地址栏判断；
* **工作区的 DOM 没被卸载**。设置页盖上来的时候，下面的输入框 / `contenteditable`
  **还在**，并且 `getBoundingClientRect()` 出来是有宽高的（实测还是贴底的 904px）。
  所以「找不到输入框 ⇒ 在设置页」这条推断是**错的** —— 拿它当判据会在设置页里
  照样显示（等于没做），也会在欢迎页上把条误藏。

最后用的是**三个 `data-testid` 信号的「或」**，每个都先过一层「真的可见」的过滤。
全部只读、不改 ZCode 任何东西：

| 信号 | 判据 | 稳不稳 |
|---|---|---|
| `[data-testid="settings-page"]` | 存在且**真的可见** | ZCode 手写的 testid |
| `[data-testid="settings-back-button"]` | 同上 | 同上 |
| `[data-testid^="settings-section-nav-"]` | 可见的 ≥ 3 个（设置页左侧那排分栏） | 同上 |
| 「可见」的定义 | `isShown(el)`：没有 `hidden` 属性、rect 非零、`display` 不是 `none`、`visibility` 不是 `hidden`、`opacity` 不是 0，**且铺满视口宽高的 ≥50%** | 用来排除「节点留着但已被藏起来」的残留 |

实测到的设置页 DOM（1719×935，用来定这几个选择器）：

```
[data-testid="settings-page"]           0,0   1719×936     ← 全屏覆盖层
[data-testid="settings-back-button"]    12,64  240×32      ← 「返回工作区」
[data-testid="settings-section-nav-general"] / appearance / modelProvider / browser /
computerUse / memory / subagents / plugin / mcp / skill / commands / hooks / indexing / usage
[data-testid="task-settings-button"]                      ← 它的文案会从「设置」翻成「返回工作区」
```

> **这是全套里唯一一处主动依赖 ZCode 内部标识的地方**，所以特意选了
> `data-testid`：那是人手工写来给测试用的名字，不是构建时 hash 出来的类名，
> 也不是打包 chunk 文件名 —— 这两类东西本项目依旧一个都不碰。
> 万一 ZCode 真把它改名了，后果也只是**退回到「设置页里也显示条」**
> （等于回到 v9），不会影响工作区里任何摆放行为。

隐藏时做两件事，隐藏得干净：

1. 给条加 `.zcsb-hidden { display:none !important }`（和 v9 的 `.zcsb-stale` 一样的
   藏法，两个 class 各管各的场景、互不干扰：`stale` = 注入器没消息了，
   `hidden` = 当前不在工作区）；
2. `releaseRoom()` 把输入框的 `padding-bottom` 还回原值 —— 否则设置页底下会留着
   一条 15px 的空隙。

（`layout()` 里 `staleNow()` 那道闸在设置判定**前面**，所以「注入器已经挂了 + 人在设置页」
这种组合也不会漏出一根条 —— 过期那条路本身就是 `display:none`，只是 `probe().hidden`
会是 false、`stale` 是 true，看字段就能分清是哪种藏法。）

判定点放在 **`layout()` 里 `staleNow()` 那道闸的紧后面**，也就是
`ensure()` / `beat` 心跳 / `render()` / `update()` 四条路径**共用同一个决定**。
（这是 v9 踩过的教训：当时「判过期」写了两条路只修了一条，结果藏不住。
这次不再给任何一条路开小灶。）`probe()` 也随之多两个字段：
`hidden`（条是不是被设置页藏了）和 `inSettings`（当前是不是在设置页）。

回到工作区**不需要刷新页面**：指标推送（≤1.2s）或 3 秒心跳任一条先到就先恢复，
实测 `inSettings=false hidden=false display=flex`，输入框内边距重新变成 31px。

```powershell
node settingstest.mjs 9222 overlay.js     # 进设置 → 断言隐藏 → 返回 → 断言恢复 + 位置仍然对
```

#### 欢迎页 / 项目列表也藏掉（v11）

「设置里别显示」做完之后紧接着的要求是「**一起藏掉**」—— ZCode 启动后那个
「欢迎 / 最近项目」列表页，底下也没有输入框，条在那儿同样没有意义。

一开始想沿用 v10 的思路：再找几个 testid。但落地页几乎没有稳定的 testid，
而且这条路是**发散**的 —— 页面每多一种（项目列表 / 欢迎页 / 加载中 / 空状态），
就得多加一条规则，ZCode 一改版就重新赌一次。改成**收敛**的判据：

```js
composerAnchored()  ⇔  composerBox() 找到了  且  viewportH − box.bottom ≤ BOTTOM_ZONE(160)
```

也就是不看「这是哪个页面」，只看「**输入框在不在、贴不贴底**」。理由很直接：
这个条的全部意义就是贴在输入框底下，输入框不在视口底部（不存在 / 在很上面 /
被别的层盖住），条就没有归属。工作区、欢迎页、项目列表、加载态、还有 ZCode
把输入框甩到视口外面那种异常态（见下），**同一个判据全都覆盖**，而且没用任何
一个新的内部标识 —— 依旧只认 `textarea` / `[contenteditable]` 这种通用选择器。

这里有个和 v10 顺序相关的坑，值得单独记一笔：**设置页那道闸必须排在锚定判定前面**。
因为设置页是覆盖层、工作区 DOM 没卸载（v10 已实测），人在设置页时
`composerAnchored()` **仍然是 true**。顺序一颠倒，设置页就会从「v10 藏好的」
退回成「显示」。所以 `layout()` 里的顺序是死的：

```
staleNow()  →  settingsOpen()  →  !composerAnchored()  →  真正摆放
```

隐藏走的是和 v10 同一个出口（`.zcsb-hidden` + `releaseRoom()`），所以
`probe()` 字段语义不变：`inSettings` 表示「因为设置页」，`anchored=false`
表示「因为不在工作区」，`hidden=true` 表示「条现在没了」，`padded` 是 0/1。

#### 顺带摸清的三个 ZCode 行为（都是实测，不是猜的）

写测试的时候连着踩了三次，记下来省得下次再查：

1. **ZCode 不用浏览器历史。** `history.length` 永远是 `1`，`history.go(-k)`
   是空操作。所以 `overlay.js` 里包 `pushState` / `replaceState` 和监听
   `popstate` / `hashchange` 的那几行，实际上是**死代码**——留着当未来的保险，
   但现在它们不承担任何功能。（真正的过渡是 SPA 内部不动 URL 的重新渲染。）
2. **左上角那个「返回」不是返回。** `[data-testid="desktop-top-nav-back"]`
   是**会话切换器**：有两个以上近期会话时它就在 A↔B 之间来回弹。
   从任意工作区点它到不了项目列表。要**确定性地**回到项目列表，路线是
   `工作区 → 侧栏 [data-testid="task-new-button"]（新建任务） → desktop-top-nav-back`。
3. **有个 ZCode 自己的布局抖动。** 点某些侧栏会话项之后，
   `[data-testid="v4-composer"]` 会被甩到视口上面很远
   （实测 `composerY = −1723`，`v4-timeline` 的 `scrollTop` 是 `2538/2537`，
   `editorBottoms = [−1671]`）。**这不是我们弄出来的**：把条
   `window.__zcodeSB.remove()` 掉之后，坐标一个字节都不变。它是暂态的，
   再点一次同一个会话通常就恢复了。这种状态下我们的行为正好是
   `anchored=false hidden=true padded=0`（藏起来、把输入框内边距还回去），
   也就是**恰好按设想工作**。

`landingtest.mjs` 就是把上面 1~3 全写成断言的版本：

```powershell
node landingtest.mjs 9222            # 工作区 → 新建任务页（藏） → 退到项目列表（藏） → 点回工作区（恢复 + 位置仍对）
```

它会先读 `overlay.js` 里的 `VERSION` 做断言（不再写死版本号），
退项目列表那步用 `task-new-button` 这条确定路线；如果撞上行为 2 的
A↔B 弹回，会记 `landingSkipped` 而不是报红——**弹回本身是 ZCode 的行为，
不是回归**。最新一次跑是**全绿**，含真实项目列表那一步
（工作区标题里 `composerBottom null, title null`）。

#### 反应速度（v12 → v13）

「**现在消失的速度太慢了，不流畅**」。原因是心跳节奏：条只靠每 **3000ms**
一拍的心跳重新摆放，而点侧栏切页是 SPA 内部重渲染（`hideNav` / `showNav`
都是 `false`，根本没有整页导航）—— 于是从点击到条消失，最坏要等满 3 秒。

v12 的想法是给点击挂一个监听，出事就立刻 `layout()`。但第一版有个
**踢一脚就掉**的 bug：`click` 监听里同步跑 `layout()`，读到的还是**旧 DOM**
—— 捕获阶段的监听器比 React 提交早，量出来的位置是上一帧的，于是判定瞬时正确、
下一帧又错回去，看起来就是「闪一下再回来」。v13 定下来的做法：

* 点开的不是一个瞬间，是一个**可续期的爆发窗口**：`kick()` 把
  `burstUntil = performance.now() + BURST_MS(1200)` 往后推，
  窗口内每 `BURST_STEP(40ms)` 重跑一次 `layout()`。每次新交互都把窗口续到
  当前 +1200ms，所以边走边点不会漏。
* **第一拍用 `setTimeout(burstTick, 0)`，不是同步跑** —— 让 React 先把 DOM 提交了
  再量。这是上面那个闪烁 bug 的正解。
* 触发源是捕获阶段的 `click` / `pointerdown` / `keydown`，加
  `popstate` / `hashchange` / `visibilitychange` / `focus`，
  再把 `history.pushState` / `replaceState` 包一层（行为 1 说明现在用不上，
  算是买保险）。
* 心跳从 3000ms 降到 **500ms**，爆发窗口负责「立刻」，心跳负责兜底。

量出来的延迟（`lagtest.mjs`，单位 ms；`lagMs` 是「从点击到判据翻转」，
`totalMs` 是「从点击到位置真的落定」）：

```
v13 实测: hideLagMs 0   hideTotalMs 5    （藏）
          showLagMs ≤17 showTotalMs 17   （恢复）
          restored true
v14 复测: hideLagMs 0   hideTotalMs 2    （藏）
          showLagMs ≤59 showTotalMs 59   （恢复）
          restored true
```

恢复那一步打印 `≤17ms` 是因为窗口里第一次采样时判据已经翻好了，
所以只能给出上界——脚本会标 `lagIsUpperBound: true` 说明这一点，不假装是精确值。
脚本还加了两条防「其实没被测到」的断言：结束态不许 `stale === true`
（否则藏这一下是看门狗藏的，不是我们藏的），以及 `totalMs` 不许是 `null`。

#### 注入器自愈（同一版）

顺手补了一个真实的洞：`overlay.js` 暴露出 `window.__zcodeSB.remove()`，
一旦被调用，守护进程那边 `injected` 仍然是 `true`，于是**再也不重新注入**。
修法是把推送表达式变成带返回值的探针：

```js
"(window.__zcodeSB&&window.__zcodeSB.update)?(window.__zcodeSB.update(<json>),'live'):'missing'"
```

`tick()` 看到 `'missing'` 就把 `injected = false; lastPush = ""`，下一拍重新注入。
`revivetest.mjs` 就是专门验这条的：

```powershell
node revivetest.mjs 9222             # 主动 remove() 掉条 → 轮询等待守护进程重新注入 → 断言版本不变 / 回到工作区锚定
```

实测**约 0.9s 复活**，`{"ok": true}`。要说明的是：正常使用**碰不到**这个洞
（刷新页面会重跑 `Page.addScriptToEvaluateOnNewDocument`），它只在有人手动拆条时才有意义。

#### 「往上走」的 0.5px 判定把条摆歪了（v14）

这是**把 ZCode 窗口拖窄之后**才暴露出来的真 bug，也是本版唯一改摆放逻辑的地方。

现象：条右端比输入框多出 16px、底边高 30px（看着像「掉到窗口右下角」而不是
「贴在输入框正下方」），同时字号被压到最低的 11px、输入框也不再被抬高
（`padded=0`）——而且**时好时坏**，同一个窗口下隔几秒重读一次数字就换一个。

原因在 `composerBox()` 里那句「从输入框往上走，走到贴住窗口底的那层就停」：

```js
if (pr.bottom >= vh - 0.5) break;   // 旧：容差 0.5px
```

宽窗口（1719×935）下包裹层底边正好 = 935，判得出来，所以一直是好的。窗口拖到
860 宽之后实测包裹层底边是 **934.385**、视口 **935** —— 差 **0.615px**，
`>= 934.5` 不成立，于是判不出「贴底」，**多往上走了一层**，把包裹层的底边和右端
当成了输入框卡片的（实测卡片 903.71 / 右 829，包裹层 934.71 / 右 845）。
更糟的是这个小数每次量都可能变（**0.29 / 0.615 / 0.71 都见过**），
所以判定在阈值两边来回翻 —— 表现就是条一会儿对一会儿歪、内边距一会儿有一会儿没。

同一个容差在 `findComposerWrap()` 里也有一份，这就是 `padded=0` 的来源：
判不出「贴底」之后一路走到一个**高 15090px 的整页容器**，
而那个容器的高度超过预算（`budget`），于是直接 `return null`，「没找到包裹层」。

改法两条：

1. 抽出常量 `PIN_SLACK = 2`，`composerBox()` 和 `findComposerWrap()` **共用同一个容差**
   （原来两处各写各的 `0.5`，等于同一个假设在两个地方各赌一次）。2px 足够覆盖
   亚像素抖动，又不会把「真的没贴底」误判成贴底。
2. 再加一道保险：往上走时，如果某层**已经比输入框本身高得多**
   （`pr.height > max(r.height * 8, 260)`）就停 —— 那是整块面板，它的底边不是卡片底边。
   这道保险正是用来兜住上面那个 15090px 容器的：即使容差将来又被某个布局绕过，
   条也不会去对齐一整页的右边。

修完的实测（同一台机器、同一个会话）：

```
修前: composerBottom 934.385  composerRight 845  条={top:920,bottom:933,right:845}  fs=11px  padded=0
修后: composerBottom 903.901  composerRight 829  条={top:911,bottom:926,right:829}  fs=13px  padded=1
```

顺带写了个**宽度扫描**测试，把「一直适配」这句话变成可重复的数字。
它用 CDP 的 `Emulation.setDeviceMetricsOverride` 模拟各种宽度（**不改窗口大小**），
在每个宽度上等一拍再断言「条右端 == 输入框右端」「净空 1~14px」「字号没掉到 12px 以下」
「空隙确实腾出来了」：

```powershell
node widthstest.mjs 9222                       # 默认扫 520/700/900/1200/1719
node widthstest.mjs 9222 600,1000,1400         # 也可以自己给一串宽度
```

```
  520px  vw=520  composerBottom=903.93  composerRight=550   条={"right":550,"width":458}  净空=7.07  右差=0  fs=13px  padded=1  hidden=false
  700px  vw=700  composerBottom=903.93  composerRight=669   条={"right":669,"width":458}  净空=7.07  右差=0  fs=13px  padded=1  hidden=false
  900px  vw=900  composerBottom=903.93  composerRight=869   条={"right":869,"width":458}  净空=7.07  右差=0  fs=13px  padded=1  hidden=false
 1200px  vw=1200 composerBottom=903.93  composerRight=1121  条={"right":1121,"width":458} 净空=7.07  右差=0  fs=13px  padded=1  hidden=false
 1719px  vw=1719 composerBottom=903.93  composerRight=1329  条={"right":1329,"width":458} 净空=7.07  右差=0  fs=13px  padded=1  hidden=false
恢复真实窗口后: {"rect":{"right":1329,"width":458},"composerRight":1329,"viewportW":1719,"padded":1}
{"problems":[]}
GREEN
```

五个宽度上「右差」**全是 0**（条右端像素级等于输入框右端）。

#### v16：把横向对齐改成「对齐优先」，以及这个测试自己挖过的坑

条的右端算法原来是

```js
rightPx = min(对齐值, max(MIN_RIGHT, vw - 条宽 - MIN_RIGHT))   // 而且 alignRight 自己也 max(MIN_RIGHT, …)
```

两道 `max(MIN_RIGHT, …)` 的意思是「条右端至少离窗口右缘 5px」。窗口够宽时看不出问题，
但**窗口比 ZCode 自己的布局还窄**时输入框右端本来就在视口外面（实测 520px 视口里输入框右端在 550），
这两道钳位就把条往左推：条 458px 宽、视口 520px，结果条被推到 `right:130`，左端跑到 −328 ——
**「本问」那一整段直接看不见了**，而它恰恰是条上最重要的信息。

v16 改成**对齐优先，只保左端**：

```js
rightPx = vw - 输入框右端;                                    // 对齐，允许算成负数
if (vw - rightPx - 条宽 < MIN_RIGHT) rightPx = vw - 条宽 - MIN_RIGHT;   // 只兜「左端出屏」
```

输入框右端在视口外时条就跟着它一起被切掉同样多（和输入框同命运），左端永远留在屏幕里。
上表 520px 那一行 `右差 0` 就是修完的结果。

> **这个测试踩的坑（值得记住）**：`Emulation.setDeviceMetricsOverride` **清掉之后视口不会立刻恢复** ——
> 窗口尺寸没变就没有 resize 事件，`innerWidth` 会一直停在最后一次覆盖的宽度上（实测要几分钟才自己好，
> 期间 `innerWidth=520 / outerWidth=1719`）。于是原来那句「收尾 clear 一下」把 **520 留在了页面上**，
> 下一次跑又拿 520 当「真实宽度」，越跑越歪（真的见过一次 `composerRight=550` 被当成基准）。
> 现在 `widthstest.mjs` 开跑前先核对 `innerWidth == outerWidth`，对不上就**重载页面**复位
> （导航会按真实窗口重算布局视口，已验证立刻生效），跑完再复位一次并复核条回来了、还对齐着。

#### v17：条显示的是**另一个会话**的数字（最严重的一个 bug）

**现象**：侧栏点开 A 会话，条上却是 B 会话的统计。数字本身完全正确、格式完全正确、
位置完全正确 —— 就是**不是这一个会话的**。

**根因**：注入器靠一个「页面提示」来判断屏幕上开着哪个会话，提示的来源是 `location.href`。
但这一版 ZCode 的地址里**根本没有会话 id**：

```
file:///E:/ZCode/resources/app.asar/out/renderer/index.html?restoreSession=true&supportsSettings=true&zcodeLaunchMarks=…
location.hash  === ""        document.title === "ZCode"
```

于是提示永远是 `null`，`resolveSessionId` 每次都退回「`session.time_updated DESC` 最近有活动的会话」。
**只要你在看一个旧会话、同时另一个会话在后台跑，条就会显示后台那个的统计。**

顺着往下查，把三条路都试掉了：

| 候选钩子 | 实测结果 |
|---|---|
| `location.href` / `location.hash` | 没有 `sess_`，也没有任何会话标识 |
| `document.title` | 恒为 `"ZCode"` |
| `window.zcode` | **`Object.isFrozen() === true`、`Object.isExtensible() === false`**，所有属性 `writable:false, configurable:false` —— 连 `syncActiveTaskSession` 都包不了 |
| `[data-testid^="task-item-"].bg-selected` | ✅ **唯一可用**：选中项的 `data-testid` 就是 `task-item-sess_<uuid>` |

`bg-selected` 不是我们发明的东西，它是 ZCode 自己的设计令牌（样式表里有
`.bg-selected { background-color: var(--color-selected); }`），稳定性和
`task-new-button` / `v4-composer` 这些已经在用的钩子是同一档。
现在 `PAGE_HINT_EXPR` 就只走这一条：

```js
// 1. href 里如果有 sess_ 就用（将来 ZCode 改回去也不吃亏）
// 2. 否则认侧栏唯一那个选中项
// 3. 都没有 → null，退回「最近有活动的会话」并往日志里写一行说明
var s = document.querySelectorAll('[data-testid^="task-item-"].bg-selected');
if (s.length === 1) { … return m[1]; }
```

**怎么证明修好了**：写了一个**必须让屏幕上开着的会话 ≠ 最近有活动的会话**才有效的测试，
`_t\sidsync.mjs` —— 它先记下条的会话，然后点开**另一个**会话，等 4 秒，再点回来：

```
GREEN 条始终跟着屏幕上打开的那个会话
```

修之前这个测试是红的：点开了 `sess_cb707975`，条上还是 `sess_6d9a2ccc` 的数字。

> **这个测试第一次跑差点骗过我**：第一版报的是「条藏起来了」，看着像没问题。
> 其实是因为旧会话的输入框恰好被甩到视口外（见行为 3），条**按设计**就该藏 ——
> 那是个**假阴性**。修法是点完会话后强制 `scrollIntoView({block:'end'})`
> 把输入框拉回视野再读。**测试要能真的失败过，才算数。**

> 教训：**「最近有活动的会话」永远不是「屏幕上开着的会话」**，这两者在有后台任务时
> 必然分叉。任何靠 `time_updated DESC` 兜底的身份判定，都得先问一句
> 「什么时候它会猜错」。另外，`title` 是渲染后用 JS 设的，读它得等一帧，
> 而 `bg-selected` 读的是 DOM 属性，落盘即准。

#### v18 → v21：量测口径，以及「宁可藏起来，也绝不压住输入框」

这四版是同一件事的四次逼近：**条该摆在哪儿，以及摆不下的时候怎么办**。
上面 v1~v17 的说明都还是准确的历史，但有两处结论已经被后来的实测改掉了，看的时候连着这段一起看。

**症状（v18）**：偶尔出现 `padded=0` 而 `anchored=true` —— 条被摆到输入框上沿之上，
而且**一直不恢复**。

**根因不是「找不到空隙」，是「腾空隙腾错了地方」**：只有底边真的落在窗口底上的那一层，
给它加 `padding-bottom` 才会把输入框卡片**整体抬起来**。卡片自己（底边 919 / 窗口 935）
不是那一层 —— 给它加内边距只是把它自己往上撑高，卡片下沿纹丝不动，底下还是只有 16px，
条照样压住输入框。更糟的是这状态**自锁**：唯一的补救动作（腾空隙）失败了，
下一拍量到的还是同一个位置。

修法分两步，都不猜 ZCode 的结构（`overlay.js`:33-44）：

1. **选容器只看「底边贴不贴窗口底」**，容差保持 `PIN_SLACK = 2px`。放宽容差反而会选中
   卡片自己 —— v18 的第一版把容差放到 40px「防抖动」，正好踩了这个坑，有实测。
2. **写完内边距立刻自检**：写完必须真的多出一块放得下条的空隙。没多出来就地还原、
   把这层记进 `rejectedEl`（连同当时的卡片底边 `rejectedAt`），并让 `layout()` 走
   「宁可整条藏起来，也绝不压住输入框」那条路 —— `overlay.js`:538 那道闸把条设成
   `.zcsb-hidden`，等下一拍再试。否决是**有时效的**：卡片底边挪了 4px 以上就当没否决过、
   重新试一次，否则窗口从坏状态恢复之后条会永远不回来。

**v20：把「卡片底边」量准，并且自检改量「空隙」**。
用 `_t\wrapcheck.mjs` 把 v18 那个坏状态**主动造出来**（把承担底部留白的那层内边距清零，
卡片就贴到窗口底），然后 dump 整条祖先链，发现两处都还能被骗过去：

* a) `composerBox()` 往上走时，第一个碰到「底边贴住窗口底」的祖先就停。可是卡片贴底时，
  输入框自己那一层就是第一个贴底的祖先 —— 于是它返回**输入框自己的底边**（863.9）而不是
  卡片底边（935.6），凭空多出 71px「空地」，条正好被摆进卡片内部（卡片背景
  `rgb(43,43,43)`、圆角 16px，实测条落在卡片里、盖住底部那排按钮）。现在只有「某一层的底边
  比输入框自己的底边更靠下过」（`overlay.js`:291 的 `> +4px`）才算找到了卡片下沿；
  一层都没找到就按那个贴底祖先的底边算 —— 空间为 0，老实藏起来（`overlay.js`:299）。
* b) 自检比的是「卡片底边有没有往上走」（`cb - b2.bottom`）。选错容器时输入框会跟着卡片
  内边距一起往上挪，这个差值照样很大，自检被骗过去 → `padded=1` 但底下没地方。改成直接量
  剩余空隙（窗口底 − 卡片底边），和 `layout()` 用的是**同一个数、同一把尺**
  （`overlay.js`:409-411 的 `space2`）。

两处合起来：坏状态下 `padded=0` 且整条隐藏，**绝不落进卡片里**。回归用例 `_t\wrapcheck.mjs`。

**v21：改用「画了底的卡片」认输入框，并把「贴底」容差拆成两个用途**。
v20 那次祖先链 dump 顺手暴露出一个跨版本问题：3.11.2 里往上走正好撞到「贴住窗口底」的
包裹层、提前 break，所以老代码没错；**3.14.3 把会话栏往下垫了 4.1px**，那层停在 930.9
（窗口 935），贴底判定不再成立，于是老代码继续往上走、把 930.9 当成了卡片底边 ——
凭空多出 16px，条就被算成没地方放。

* 新增 `isPaintedCard(el, h)`（`overlay.js`:244-256）：卡片 = 编辑器外面那层**画了底/圆角**的
  盒子（`border-top-left-radius > 0`，或背景色 alpha ≠ 0），而且高度是「一行输入框那一块」
  （< 400px），不是整页容器 —— 不靠内部类名、不靠几何巧合。3.11.2 / 3.14.3 实测都只有
  一个这样的祖先，两版的位置、圆角、底色完全一致。撞上它就到**此为止**：卡片底边就是权威
  答案，再往上走的每一层都是布局脚手架，它们的底边不属于输入框（`overlay.js`:276-286）。
  认卡片之后，两版都返回卡片自己的底边（904.57 / 914.91）。
* 「贴住窗口底」的容差**不再共用一个常量**（`overlay.js`:327-335）：探测卡片底边仍然认
  `PIN_SLACK = 2`（越紧越好）；挑「加内边距的那一层」放宽到 `PIN_TOL = 8`，才容得下 ZCode
  自己垫的那 4.1px，同时显式排掉「画了底的卡片」。实测卡片底边离窗口底 20.09（3.14.3）/
  30.4（3.11.2）px，远在 8px 之外，所以放宽到 8 仍然不会误选卡片本身；选错的代价由上面
  那个 `space2`（真空隙）自检兜底。

---

## 三、条上的指标怎么算的

数据源是 **`~/.zcode/cli/db/db.sqlite`** —— ZCode 自己「设置 → 用量统计」和
「开发者工具 → Token 调试」用的就是这几张表。

> 为什么不读 `~/.zcode/cli/rollout/model-io-*.jsonl`？
> 因为那份数据里 `cacheReadTokens` **恒为 0**（实测三个会话文件全部为 0），
> 缓存命中率根本算不出来。缓存数据只落在 SQLite 里。

| 显示 | 来源 | 算法 |
|---|---|---|
| `N 轮` | `turn_usage` | 当前会话的行数（一行 = 一轮用户消息） |
| `N 步` | `turn_usage.model_request_count` | 主轮模型请求数累加（一次「思考→行动」= 一步） |
| `N tok/s` | `model_usage` | `Σ output_tokens ÷ Σ(duration_ms - time_to_first_token_ms)`，只算 `main_turn` 且 `completed` 的记录，扣掉首 token 等待时间，得到真实解码速度 |
| `N.M tok` | `turn_usage.computed_total_tokens` | 累计 token |
| 本问 `N tok/s` / `N.M tok` | `model_usage` + `turn_usage` | **同一个公式，但只算「当前这一轮」**（见下） |

条上就这五个数（本问 tok/s · 本问 tok · 累计轮步 · 累计 tok/s · 总 tok）—— 再塞就看不清了。
悬浮卡片里另有一组「会话统计」指标（模型用时 / 工具调用用时 / 首 token 平均 / 输出速度 /
缓存命中），口径单独列在本节末尾「v22 → v23」那一节。

#### 「本问」是怎么认出「这一轮」的（v15）

条的左半段是**本问**：最近一轮的 tok/s 和输出 token。算它要回答两个问题。

**一、哪一轮是「本问」？** 取 `model_usage` 里最新一条 `query_source='main_turn'` 的 `turn_id`
（`compact` 压缩轮有自己独立的 `turn_id`，且不会出现在 `turn_usage` 里，所以必须按 `main_turn` 过滤）；
万一查不到，退回 `turn_usage` 最新一行。认出来后按同一个公式聚合这一轮的 `main_turn/completed` 记录。

**二、这一轮开始了吗？** 这里有个实测出来的时序，值得记下来：

* `turn_usage` 里**没有 `running` 状态的行** —— 现有 181 行只有 `cancelled 39 / completed 111 / error 31`，
  **行是轮次结束时才落盘的**。所以「现在在跑第几轮」不能从 `turn_usage` 推。
* `model_usage` 是**每个请求**落一行（`main_turn 2306 / compact 25 / subagent 160 / session_title 13`），
  所以一轮刚开跑就能从它身上看出当前的 `turn_id`。
* 用户刚回车、模型还没回第一个 token 的那几百毫秒里，**连 `model_usage` 都还没有**。这时显示
  `本问 -- tok/s · 0 tok`（图标转圈），**绝不拿上一轮的数字充数** —— 那正是最容易被误读的时刻。
* 判据：`session_input` 里 `kind='sendText'` 的行**在轮次开始前约 40ms** 写库；
  而 `todo_reminder` / `backgroundNotification` 这类注入**不产生 `sendText` 行**，
  所以「`MAX(sendText.time_created)` 比这一轮最后一次活动还新」= 有新问题在飞，
  这个信号在轮次中途**不会误报**（实测全程跟踪过）。
* 于是 `turnRunning = 刚发了问（sendText 更新）|| 查不到状态 || 状态是 running`；
  running 时图标转圈，结束就停。

> 一个反面例子也记一下：`message` 表里助手行是「请求开始就插入、结束时更新」，
> 看起来很像是「这轮还没结束」的证据，但用 `data NOT LIKE '%"completed":%'` 这种判据
> 在整库里只命中 3 行，**不可靠，所以没有采用** —— 轮次身份和运行状态都只走上面那两条路。

> **缓存命中率已经从条上去掉了**（按使用反馈）。`cacheHit` 这个字段在
> `zcode-statusbar.mjs` 里**照样算、照样打印**：`--print` 和 `statusbar.log` 里还能看到，
> 需要用的时候不必改代码。
> **v23 起它在悬浮卡片上回来了**，作为「会话统计」的一行（`overlay.js`:664），
> 条上仍然不显示 —— 条上那五个数的位置一个都没让给它。
> 算法：`turn_usage.cache_read_input_tokens ÷ input_tokens`（`cache_read` 是 `input` 的子集）。

实测校验：`sess_c458a616` → `128146` 输入、`108672` 缓存读 → **84.8%**，与 ZCode 面板口径一致。

#### 「本问 tok」不能用 `turn_usage.output_tokens`（v17 修的坑）

**现象**：条上是 `本问 150 tok/s · 13k tok`。两个数摆在一起，谁都会下意识地除一下：
13k ÷ 150 = **86.7 秒**。可这一轮真实的纯生成时间是 **98.6 秒**。数字各自都对，
放在一起却互相矛盾。

**根因**：`turn_usage.query_source` 有两个取值 —— `main_turn` 和 `compact`。
一轮对话中途如果触发了**上下文压缩**，压缩本身也是一次模型请求，也产出 token：

```
turn_8ce5cf86  sess_6d9a2ccc
  main_turn × 7  =  5255 tok   生成 34971ms  →  150.3 tok/s   ← tok/s 的分子
  compact   × 1  =  7751 tok   生成 60063ms  →                ← 不在 tok/s 的分子里
  turn_usage.output_tokens = 13006  (= 5255 + 7751)           ← tok 的分子
```

tok/s 一直是按 `query_source='main_turn'` 过滤的，而「本问 tok」原先直接取
`turn_usage.output_tokens`（含压缩），**两边的分子不是同一个东西**。

**修法**：把「本问 tok」统一到主轮口径，和 tok/s 共用同一个分子；压缩掉的那部分
单独放到 `turnTotalOutputTokens` / `turnCompactTokens`，写进 tooltip 和 `--print`，
不占条上的位置：

```
条上    : 本问 150 tok/s · 5.3k tok  …   （5.3k ÷ 150 = 34.97s = 真实生成时长 ✓）
tooltip : 本问：completed，主轮输出 5255 tok / 7 个请求 / 首字 2.2s / 总耗时 100.8s
          本问：本轮合计 13k tok，其中上下文压缩 7.8k tok（不计入上面的 tok/s）
```

只有一条主轮明细都读不出来时才退回 `turn_usage.output_tokens`（否则会显示 0）。

> **补记（v22 才发现）**：v17 当时这段说明挂在 `el.title` 上，而条是 `pointer-events:none`，
> 浏览器原生的 tooltip **根本弹不出来** —— 上面那两行「tooltip :」一直到 v22 由自绘卡片
> 接手才真正显示得出来（见本节末尾「v22 → v23」）。`--print` 那一侧一直是好的。

**这个 bug 是怎么被抓到的**：不是靠肉眼看数字，而是 `_t\barcheck.mjs` 里加了一条
**自洽性断言** —— 条上既然同时给出 tok/s 和 tok，就必须满足
`tok ÷ tok/s ≈ duration_ms − time_to_first_token_ms`。容差按**条上实际显示的精度**算
（`5.3k` 的量化台阶是 100 → 1.9%；`150` 取整 → 0.33%；合计约 2.2%），
不能用固定百分比，否则大数字时会假失败。这条断言加进去立刻就红了，指回了压缩轮。

> 教训：**并排显示的两个派生指标，必须能互相推回去**。否则每个数字单独看都是对的，
> 组合起来却在说假话 —— 这种错误靠「数字和库一致」的测试永远发现不了，
> 因为库里的数确实就是那样。

#### v22 → v23：悬浮卡片，从死代码到「会话统计」面板

条是 `pointer-events:none` 的（它永远不挡 ZCode 自己的按钮，见第六节），代价是**浏览器原生的
`title` 提示永远弹不出来**。这两版都在处理这件事，最后把那张卡片做成了会话级的统计面板。

**v22：tooltip 复活。** 之前 `render()` 里认真拼了一大段说明（会话名、首字耗时、压缩量），
挂在 `el.title` 上 —— 因为鼠标穿透，那段字**一次都没显示过，是纯死代码**（v17 那节末尾的补记
说的就是这件事）。现在的做法是**页面自己监听 `mousemove`**（`onSbMouseMove`，
`overlay.js`:745-761）：光标落进条的矩形（左右各留 2px、上 3px 下 2px 的余量）就弹出一张
自绘小卡片，挪开就收起；卡片同样 `pointer-events:none`，**只展示、不拦截任何点击**；
条隐藏 / 过期时卡片跟着撤（过期看门狗里显式收掉，判据里也排除 `.zcsb-stale` / `.zcsb-hidden`）。
卡片主题跟着页面走（`--zcsb-tip-bg` / `--zcsb-tip-fg`，亮暗两套），宽度上限 460px，
定位在条的上方并夹进视口 —— 定位前先把 `left/top` 归零再量宽，否则上一次可能把卡片右缘顶到
视口外，量出来的宽度会失真（`overlay.js`:704-708）。

**v23：卡片从「一串说明文字」升级成「会话统计」面板。**
理由很直接：条上只放得下五个数（本问 tok/s · 本问 tok · 累计轮步 · 累计 tok/s · 总 tok），
再塞就看不清了；而「这个会话一共花了多少时间、多少花在等模型、多少花在跑工具、首字多慢、
缓存省了多少」属于同一类问题，且都值得一眼看到。所以卡片改成**标题「会话统计」
（`TIP_TITLE`，`overlay.js`:108）+ 五行指标**，左标签右数值、数值右对齐且等宽
（`grid-template-columns:auto 1fr`，`overlay.js`:179-181）：

| 卡片行 | 口径 |
|---|---|
| 模型用时 | Σ `model_usage.duration_ms`（口径与 tok/s 相同的那些主轮请求）。**含等首字的时间** —— 那是排队 + 预填充，用户一样得等 |
| 工具调用用时 | Σ `tool_usage.duration_ms`。与「模型用时」互不重叠，但两者相加**不等于**会话时长：还有解析、渲染，以及人自己想事情的时间 |
| 首 token 平均（TTFT） | `AVG(time_to_first_token_ms)`，只统计**真的等到过首字**的请求 |
| 输出速度（TPS） | `Σ output_tokens ÷ Σ(duration_ms − ttft_ms)`，和条上那格是**同一个累计口径**（不是本问的） |
| 缓存命中 | `cache_read ÷ input`，就是上面那句的老算法 |

下面再跟几条灰字附注（与指标之间有一条极淡的分隔线）：会话名/ID、本问明细（状态、主轮输出、
请求数、工具次数、首字、总耗时）、压缩量、累计轮步与输入/输出/合计。这些正是 v22 那张卡片的
原始内容 —— **升级不丢信息，只是把它降级成附注**。

全部数字仍由注入器从 SQLite 算好推过来，页面侧只负责画、不自己查库；字段缺失时显示 `--`，
绝不拿 0 冒充 —— 刷新后先按 `localStorage` 里那份旧 payload 画出来的那一瞬，旧值里没有这些字段。

> **现状（读代码时顺手记的，别当成已经好了）**：`readMetrics()` 里 v23 这几个时间类字段 ——
> `modelMs` / `toolMs` / `ttftAvgMs`（还有 `ttftCount` / `toolUsages`）—— 目前只在返回对象里
> **声明**了（`zcode-statusbar.mjs`:167-176），整个 `zcode-statusbar.mjs` 里**没有任何一处给
> 它们赋值**（`out.* =` 的赋值点全在轮次聚合、tok/s、缓存命中、本问那几处）。
> 后果是卡片上真正有数的只有「输出速度」和「缓存命中」；「首 token 平均」显示 `--`（初值是
> `null`），而「模型用时」「工具调用用时」显示的是 **`0s`** —— 初值 `0` 是有限数，
> 会一路走到 `fmtDur(0)` 的 `return "0s"`，正是旁边那句注释说的「拿 0 冒充」。
> 这三行的 SQL 还没接线（口径已经写在注释里），接线前不要把本节的这几行当成实测结果引用。

---

## 四、安装与使用

### 前置
- Windows
- Node.js **22 或更高**（用到内置 `node:sqlite` 和全局 `WebSocket`）—— 本机是 v24.20.0，OK
- ZCode 装在默认位置（否则改一下 `.cmd` 里的路径列表）

零第三方依赖，`npm install` 不需要。

### 日常使用
双击 **`启动ZCode(带状态栏).cmd`**（英文名入口 `start-zcode.cmd` 等价，供终端调用），它会：
1. 找到 Node 和 ZCode.exe
2. 检查 ZCode 是否已经在跑
   - 已经在跑且已有调试端口 → 直接挂接
   - 已经在跑但没有端口 → **询问**是否强制关闭并重启（调试端口只能在启动时开）
   - 没在跑 → 直接带端口启动
3. 等端口就绪，后台（最小化）启动注入器
   - 启动前先用 `--locked` 探一下：**已有注入器在跑就不再重复启动**
4. 8 秒后自动关窗

然后 ZCode 窗口右下角就会出现统计条。

> **桌面 / 开始菜单快捷方式已经改好了**（原来的两个都已备份到 `backup\`）：
>
> | 快捷方式 | 目标 |
> |---|---|
> | `桌面\ZCode.exe - 快捷方式.lnk` | `wscript.exe "<目录>\start-zcode-silent.vbs"` |
> | `开始菜单\Programs\ZCode.lnk` | 同上 |
>
> 也就是说**照原来的习惯双击图标就行**，不用去找 `.cmd`。
>
> ### 静默启动（不闪黑窗）
>
> `.cmd` 双击会弹一个黑底控制台窗口，虽然 8 秒后自己关掉，但期间很扎眼。
> 所以快捷方式指向 `start-zcode-silent.vbs`，它做三件事：
>
> 1. 用 `WScript.Shell.Run(cmd, 0, True)` **把 `.cmd` 完全藏起来跑**
>    （`0` = 不显示窗口，`True` = 等它结束并拿到退出码）；
> 2. 退出码为 `0` 时**再确认一次注入器是不是真的活了**（连着跑 5 次 `--locked`，每次间隔 1.5s）——
>    因为「ZCode 起来了」不等于「统计条挂上了」；
> 3. **只有失败时才把窗口亮出来**：
>    - 退出码 `1`（环境有问题：缺 Node / 缺 ZCode.exe）或 `3`（ZCode 已在跑但没有调试端口，
>      需要用户决策）→ 用**可见窗口**重新跑一遍 `.cmd`，把信息 / 选择权交回给人；
>    - 其他非 0（`4`：端口一直没起来）或注入器探针没过 → 弹一个**阻塞式对话框**，标题
>      「ZCode 状态栏 —— 启动未成功」，正文里贴出 `launch.log` 的尾部内容。

全链路实测（用桩替换 `.cmd` 制造各种退出码，桩会记录自己是被藏起来跑还是亮着跑）：

| 桩退出码 | 结果 |
|---|---|
| `0` | 不弹窗、不亮窗，静默完成（前提是注入器探针也通过） |
| `1` | 不弹窗，改为**可见窗口重跑** |
| `3` | 不弹窗，改为**可见窗口重跑** |
| `4` | 弹出阻塞式错误对话框，并附 `launch.log` 尾部 |

> 顺便验了个细节：`WScript.Shell.Run` 的第三参数为 `True` 时**确实会等待并返回子进程退出码**，
> `sh.Popup(..., 48)` **确实会阻塞**到用户点掉为止（48 = 信息图标 + 置顶）。

> **重复启动是安全的**：注入器带单实例锁（`.daemon.lock` 记 pid）。第二次启动会直接
> 写一行「已有注入器在运行（pid …），本次启动退出」然后结束，不会出现两条统计条。

### 停止
关掉任务栏里那个最小化的 **「ZCode 状态栏」** 窗口即可（结束的是注入器，ZCode 照常跑）。

关掉之后统计条**不会瞬间消失**，这点实测过：

| 你怎么做 | 条什么时候消失 | 依据 |
|---|---|---|
| 关掉「ZCode 状态栏」窗口 / `taskkill /PID` / `Stop-Process` | 最长约 15 秒后（看门狗过期），并同时把输入框内边距还原 | 实测 15096ms 时 `display=none && padded=0` |
| 顺手按一下 ZCode 窗口的 F5 | 立即（新文档里根本没有这个条） | `Page.addScriptToEvaluateOnNewDocument` 失效后自然消失 |

> 为什么不「关掉就立刻撤销」：Windows 上结束进程**不会**跑 Node 的 `SIGINT`/`SIGTERM`
> 处理器（`process.on` 那几个在 `Stop-Process`、`taskkill /PID`、关控制台三条路径上都
> 实测没被调用），所以优雅清理靠不住。真正兜底的是页面侧看门狗：注入器超时 15 秒没
> 推送，条自己藏起来、把改过的内边距还回去 —— 即使注入器是被强杀的也一样。
> 另外如果 ZCode 当时在后台（定时器被节流），这个 15 秒会拖长；切回 ZCode 后 ~3 秒内生效。

### 自检
```powershell
node "C:\Users\xyqmbyl\.zcode-statusbar\zcode-statusbar.mjs" --print
```
不注入、只读数据库，打印当前指标。用来确认数据侧是否正常。

```powershell
node "...\zcode-statusbar.mjs" --print --session 117599c6
```
指定会话查看。

### 日志
日志一共三份：

| 文件 | 内容 |
|---|---|
| `statusbar.log` | 注入器自己的日志（启动 / 连接 / 注入 / 报错） |
| `launch.log` | 静默启动时 `.cmd` 的全部输出 —— 窗口被藏了，只能落盘；启动失败时对话框会贴它的尾部 |
| `statusbar.err.log` | 注入器的 stderr（正常时是空的） |

`statusbar.log` 只记关键事件（启动 / 连接 / 注入 / 报错），带时间戳，例如：

```
[23:04:28] 守护进程已启动：db=C:\Users\xyqmbyl\.zcode\cli\db\db.sqlite  port=127.0.0.1:9222  interval=1200ms
[23:04:28] 已连接渲染进程 file:///E:/ZCode/resources/app.asar/out/renderer/index.html?restoreSession=true&supportsSe
[23:04:28] 统计条已注入渲染进程
```

`--quiet` 只压掉啰嗦的进度输出，上面这些关键行照样写盘，方便事后排查。

### 完整卸载
1. 关掉最小化的「ZCode 状态栏」窗口
2. 把桌面 / 开始菜单快捷方式的目标改回 `E:\ZCode\ZCode.exe`（或直接用 `backup\` 里的备份覆盖回去）
3. 删除 `C:\Users\xyqmbyl\.zcode-statusbar\` 整个目录

ZCode 自身**一个字节都没被改过**，所以卸载就是删目录 + 还原快捷方式。

---

## 五、参数

注入器支持命令行 / 环境变量：

| 参数 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `--port` | `ZCSB_PORT` | `9222` | CDP 调试端口 |
| `--interval` | `ZCSB_INTERVAL` | `1200` | 指标刷新间隔（毫秒） |
| `--print` | | | 只打印指标，不注入 |
| `--quiet` | | | 不输出常规进度日志（启动/连接/注入/报错仍写入日志）。注意「写盘」靠的是**启动器把 stdout/stderr 重定向到 `statusbar.log` / `statusbar.err.log`**；如果自己 `Start-Process node …` 手动起守护进程又没加重定向，就一个字都不会落盘（实测如此），要留证据记得带上 `-RedirectStandardOutput` / `-RedirectStandardError` |
| `--session` | | | 固定显示某个会话（支持 ID 片段） |
| `--locked` | | | 内部探针：已有注入器在跑则退出码 0，否则 1（启动器用它避免重复启动） |
| | `ZCSB_DB` | | 覆盖数据库路径 |
| | `ZCSB_ZCODE_HOME` | `~/.zcode` | 覆盖 ZCode 数据目录 |

`.cmd` 启动器自己的一个开关（不是注入器的）：

| 参数 | 说明 |
|---|---|
| `--hidden` | 静默模式：不打进度、不问问题，用退出码表意。`0` = 成功；`1` = 缺 Node 或缺 ZCode.exe；`3` = ZCode 正开着但没开调试端口（此时**什么都还没做**，需要人决定）；`4` = 调试端口 40 秒内没就绪。`start-zcode-silent.vbs` 就靠这套码决定「静默完成 / 亮窗重跑 / 弹错误框」。 |

> **推送节奏**：指标一变就在下一轮 tick 推（默认 ≤1.2s）；指标长期不变时每
> `HEARTBEAT_TICKS`（约 2.5s）心跳重申一次。心跳有两个作用——外部改掉统计条能自己
> 恢复，以及页面刷新后缓存的旧值最多只停留 2.5s。实测 26 秒内只发了 3 次
> `Runtime.evaluate`，而不是按 tick 数发 21 次。

---

## 六、需要知道的取舍与风险

1. **必须用启动器启动 ZCode。**
   调试端口是进程启动时的开关，ZCode 有单实例锁（`requestSingleInstanceLock`），
   第二个实例会直接退出并把命令行转发给已有实例 —— 所以**没法给已经跑着的 ZCode 补开端口**。
   这也是为什么把桌面 / 开始菜单快捷方式都指到了 `start-zcode-silent.vbs`：
   只要还从这两个图标启动，就不会踩到这个坑。

2. **会开一个本地调试端口 `127.0.0.1:9222`。**
   只监听回环地址，外网访问不到；但**同一台机器上的任何进程**都能连上它并获得
   该渲染进程的完全控制权（相当于 ZCode 窗口的远程控制台）。
   介意的话可以改 `--port`，但本质上只要用这个方案就存在这个暴露面。
   Chromium 对 `--user-data-dir` 和 Host 头都有校验，端口不会被局域网随意访问。

3. **浮层是 `pointer-events: none`。**
   它永远不会挡住 ZCode 的任何按钮。这个代价里「看不到任何提示」那一半**在 v22 已经补回来了**：
   悬浮说明改由页面自己监听 `mousemove` 画一张同样鼠标穿透的卡片，所以现在鼠标停在条上就能
   看到会话名/ID 和一组「会话统计」（见第三节末尾）。**浏览器原生的 `title` 仍然弹不出来** ——
   v22 之前那段挂在 `el.title` 上的说明就是这么白写的，不要再往 `title` 上挂东西。
   想看原始字段（含只在 `--print` 里才有的那些）和日志里的口径，仍然用 `--print`。

4. **脚本会改一下输入框的 `padding-bottom`（16px → 31px，即在它之上多加 15px）。**
   这是为了让输入框底下那条空隙变宽，条才放得舒服（见第二节）。
   改的是**页面运行时的内联样式**，不落盘、不碰 ZCode 文件，`__zcodeSB.remove()` 或刷新页面即还原。
   只有在**输入框贴着窗口底**的会话页才会改（差值 > `BOTTOM_ZONE = 160px` 就整段跳过，
   设置页 / 终端页不会被碰）；探测不到包裹层时也只收字号，不会乱改。
   注入器超时 15s 没推送时看门狗会把这条改动一并还原，所以不会出现「注入器早没了、
   输入框却一直被抬着」的残留（v5/v6 修的两个真 bug，第二节有复现数据）。

5. **跟随的会话是「最近有活动的会话」。**
   优先挑 `turn_usage.status='running'` 的轮次所属会话，其次是 `session.time_updated`
   最新的会话，如果能在渲染进程 URL 里匹配到 `sess_xxx` 就用它。
   如果你在 ZCode 里只是「切换查看」一个旧会话而没有产生新活动，统计条可能仍显示上一个会话。

6. **指标和 ZCode 自己的面板同源**，所以数字对得上；但「步数」的口径是
   `model_request_count`（模型请求数），不是 `tool_call_count`（工具调用数）。
   如果你的直觉里「步」= 工具调用，改 `zcode-statusbar.mjs` 里 `steps` 取哪个列即可。

---

## 七、验证记录（在真实 ZCode 上跑过：3.11.2 到 3.14.3）

> **版本变更提示（2026-09-28 整理时补）**：下面的记录最早是在 **ZCode 3.11.2.6792** 上取得的。
> 之后 ZCode 升到 **3.14.3.7762**，并且装在非 ASCII 路径 `E:\新建文件夹\ZCode\` 下（`E:\ZCode\ZCode.exe` 那份 3.11.2 已不再被使用，是僵留的旧安装）。
> `启动ZCode(带状态栏).cmd` 的 ZCode.exe 候选列表已把 `E:\新建文件夹\ZCode\ZCode.exe` 排在第一位，所以启动器能找到正确那份；注入与 `--print` 在 3.14.3 上同样工作。
> **另注**：本节的命令记录里提到的 ull-v10-stale.png、以及 L1064 那条 shotclip.mjs 9222 clip-v9.png，这些 v9/v10 截图已在 2026-09-28 整理时归档到 _trash\；本节保留的是当时的运行记录，不表示文件还在原地。

**数据侧**（只读数据库，不启动注入器）：

| 会话 | 输出 |
|---|---|
| 最新会话 | `6 轮 · 42 步 · 50 tok/s · 3.0M tok`（该会话走 CSU 无缓存通道，缓存命中 0% 属实） |
| `--session c458a616` | `1 轮 · 4 步 · 42 tok/s · 0.14M tok`（缓存命中 85%：128146 输入 / 108672 缓存读 = 84.8%） |

> 注：`--print` 仍然会多打一段 `缓存 …%`，那是给排查用的诊断字段，条上不显示。

**注入侧**（真实 ZCode 窗口 1719×935，端口 `127.0.0.1:9222`，`verify-injection.mjs --stale` 全绿）：

> 下面这段是 **v10 时期**留下的原始输出（含 `"v":10`、条位置 911/904.34 等当时的数值），
> 原样保留当历史记录；当前版本的位置实测见本节末尾的 `vercheck.mjs` 一行式回读
> 和 `verify-injection.mjs` 的最新一次「全部通过。」。看门狗时长、后台节流那几条结论至今仍然成立。

```
✓ WebSocket CDP 已连接（Node 内置全局 WebSocket，零依赖）
✓ Page.enable / Runtime.enable
✓ Page.addScriptToEvaluateOnNewDocument → {"identifier":"1"}
✓ 注入结果 {"ok":true,"v":10,"mounted":true}
✓ 指标已推送
  渲染文本: "2 轮 78 步 · 46 tok/s 4.8M tok"
  定位/穿透: {"pos":"fixed","right":"390px","bottom":"10px","z":"2147483647","pe":"none"}
  位置探针: {"rect":{"top":911,"bottom":926,"right":1329,"width":246},
             "composerBottom":904.3414001464844,"composerRight":1329,"viewportH":935,"viewportW":1719,
             "fontSize":"13px","wrapPadBottom":31,"wrapPadBase":16,"padded":1,
             "stale":false,"hidden":false,"inSettings":false,"hasLast":true,"sincePushMs":408}
✓ 条顶 911 ≥ 输入框底 904.3414001464844 → 在输入框下面，没遮挡
✓ 条右端对齐输入框右端（右边距 390px = 输入框 390px），不再挂在窗口右下角
✓ 底边距 9px，条宽 246px，字号 13px
✓ 字号 13px（≥12px，比原来大）
  空隙: 包裹层 padding-bottom 16px → 31px；条上方净空 7px
✓ 输入框已被抬高 15px，条紧贴在它正下方（净空 7px）
✓ 过期看门狗已就位（15s 无推送 → 自己藏起来并还原输入框）
… 已暂停守护进程 pid 22844（不然它每 2.5s 推一次，看门狗永远不会触发）
… 页面当前不是 visible（后台窗口，定时器被节流），先试着唤到前台
… 窗口唤不动（大概是最小化了），改用 90 秒轮询；前台正常情况是 ~15s 触发
… 后台节流下第 20 秒才触发（前台 ~15s）
  停推后: display=none stale=true padBase=null padNow=null padded=0 hasLast=true sincePushMs=20039
✓ 看门狗生效：条已隐藏，被改过的内边距已全部还原
✓ 重新推送后立即恢复（display=flex，padding 31px）
✓ 守护进程已重新拉起（pid 33852）
- 跳过 body 替换自愈测试（会清空页面 DOM，仅测试页可用 --destructive）
✓ 截图已保存 full-v10-stale.png

全部通过。
```

> 上面这一次的右边距是 390px，正好等于输入框卡片右端到窗口右端的距离（`1719 − 1329`）。
> 曾经实测到过一次 685px：当时 ZCode 自己开着右侧面板、卡片变窄了，条跟着卡片右端一起缩
> —— 这正是「对齐卡片」而不是「对齐窗口」的可观察证据。

**工作区 / 设置页切换侧**（`settingstest.mjs`，会真的去点 ZCode 的「设置」和「返回工作区」）：

```
✓ 已连接 file:///E:/ZCode/resources/app.asar/out/renderer/index.html?rest
✓ 注入结果 {"v":14}（脚本里的 VERSION=14）
… 进入设置：已点击：设置
设置页内: inSettings=true hidden=true display=none cls="zcsb-hidden" padded=0 wrapPadBottom=null
         底下输入框底边=918.81（贴底=true）
✓ 底下那层输入框仍然是贴底的（anchored=true），设置判定确实排在贴底判定前面
✓ 设置页里：条已隐藏，输入框内边距已还原
… 退出设置：已点击返回工作区
工作区内: inSettings=false hidden=false display=flex cls="" padded=1 wrapPadBottom=31
          composerBottom=903.9009704589844 rect={"top":911,"bottom":926,"right":829,"width":246}
✓ 回到工作区：条自己回来了（不需要刷新页面）
✓ 条仍然在输入框下面（条顶 911 ≥ 输入框底 903.9）

设置页/工作区切换测试全部通过。
```

（这两次 `rect.width` 是 246 / 258 —— `width` 是内容盒宽，随文本长短变，
真正被断言的是 `right` 对齐和 `top ≥ composerBottom`。上面这组是窗口 860 宽时的实测，
也是后面 v14 那节里「窄窗口曾经摆歪」的对照。）

**欢迎页 / 项目列表侧**（`landingtest.mjs`，会真的点「新建任务」再退到项目列表）：

```
✓ 已连接 file:///E:/ZCode/resources/app.asar/out/renderer/index.html?rest…
  脚本 VERSION 取自 overlay.js = 14
起始（工作区）: hidden=false display=flex anchored=true padded=1
… 2a 点击「新建任务」[data-testid="task-new-button"]
✓ 新建任务页：hidden=true display=none anchored=false padded=0
  非工作区判据: viewportH - composerBottom = null（没有输入框可锚）
… 2b 点击 [data-testid="desktop-top-nav-back"]，最多 4 次
✓ 已退到项目列表：composerBottom=null，工作区标题=null（没有 A↔B 弹回）
… 3 点击会话项 [data-testid="task-item-sess_…"] 回到工作区
✓ 恢复：hidden=false display=flex padded=1，rect.top=911 ≥ composerBottom=903.5

欢迎页/项目列表测试全部通过。
```

最近一次在 860 宽的窗口上重跑时，第 2b 步退不到项目列表，脚本照样 `exit 0`、
`problems: []`，另给了一行原因说明：

```
"landingSkipped": "返回键在最近的两个会话之间来回切（整合优化Zcode-Wallpaper动态壁纸项目 ↔ 协助dsh在文件夹中工作），退不到项目列表"
```

这不是回归，正是本节行为 2 —— 返回键的两个近期会话都不含「项目列表」这一站。
脚本认得出这种往返（记录访问过的标题，第二次看到同一个标题就停手），
所以它报的是 `skipped` 而不是假失败；要复现真正的项目列表那一步，
先多开/点几个不同会话让近期列表长一点再跑。

**反应速度**（`lagtest.mjs`，在真实窗口里点侧栏切页并逐帧采样）：

```
{"v":14,"hideLagMs":0,"hideTotalMs":2,"hideNav":false,
 "showLagMs":59,"showTotalMs":59,"showNav":false,
 "restored":true,"problems":[]}
```

`showLagMs` 打印成 `≤59ms`（脚本标 `lagIsUpperBound: true`）：窗口内第一次采样时
判据**已经**翻好了，所以只能给上界——不假装是精确测量。
每一跑的绝对数是几十毫秒级的抖动（`5 / 17 / 2 / 59` 都见过），
**看的是它没有回到 v12 之前那种秒级等待**，而不是盯某一次的个位数。

**注入器自愈**（`revivetest.mjs`，故意把条拆掉再等守护进程补回来）：

```
✓ 已连接 …
… 主动移除：window.__zcodeSB.remove()
移除后: has=false bar=false padded=null
… 轮询等待守护进程重新注入（最长 15s）
自愈后: v=13 hidden=false anchored=true padded=1（0.9s）

自愈测试全部通过。
```

**一行式回读**（`vercheck.mjs`，最常用的那个）：

```
{"overlayVersion":14,"barText":"5 轮 78 步 · 99 tok/s 7.3M tok","display":"flex",
 "cls":"","inSettings":false,"anchored":true,"hidden":false,"stale":false,"padded":1,
 "composerBottom":903.9009704589844,
 "rect":{"top":911,"bottom":926,"right":829,"width":246},
 "sincePushMs":2145}
```

（这一组是**把 ZCode 窗口拖到 860 宽之后**读的：`right` 829 正好等于输入框右端，
`composerBottom` 903.9 是输入框卡片底边而不是包裹层底边 —— v14 修的就是这两个数。）

> 早期几个脚本把版本号**写死**在断言里（`v11`），于是每次升版都报一个假失败。
> 现在 `landingtest.mjs` / `newtasktest.mjs` 都改成从 `overlay.js` 里
> `match(/var VERSION\s*=\s*(\d+)/)` 现读，并且会先断言「页面上的版本 ≠ 文件里的版本」
> —— 因为覆盖层是**注入到已经开着旧版条的页面**里的，不先确认页面版本，
> 脚本测的可能还是旧代码（这正是 v8 那次「改了个寂寞」的同款陷阱）。

> 注意看门狗这一项**必须先停掉守护进程**再测。守护进程活着的时候每 ~2.5s 推一次，
> `sincePushMs` 永远回到几百毫秒，条当然不会过期 —— 第一版测试就是这么被骗过去、
> 报了一个假的「看门狗失效」。现在 `--stale` 会自己读 `.daemon.lock` 停掉守护进程，
> 测完再拉起来；如果 `.daemon.lock` 里的进程本来就没了（旧锁），它也会在测完补一个回来
> —— 以前这种情况被当成「守护进程还活着」不补，结果测完用户的条就彻底没了。

> **后台窗口的定时器会被 Chromium 节流（v9 的 `--stale` 就是被这个坑过）**：
> 看门狗是 `setInterval` 驱动的，而 Chromium 对不可见页面会把定时器降频。
> 实测 ZCode 窗口最小化时 `document.visibilityState === "hidden"`、
> `document.hasFocus() === false`，一个 1000ms 的 `setInterval` **10 秒只跑了 6 次**。
> 于是「停推 19 秒」在后台窗口里根本等不到看门狗触发，测试报了一个假失败
> （`display=flex stale=false padded=0 hasLast=true sincePushMs=19019`），
> 但过一会儿再探针读到的却是 `{d:"none", stale:true, since:126254}` —— 逻辑本来是对的。
> 现在 `--stale` 的处理顺序是：先 `Page.bringToFront` 试着把窗口唤到前台（只是被别的
> 窗口挡住时这一步就够），唤不动（最小化）就改成**最多 90 秒、每 5 秒轮询一次**，
> 靠日志里的「后台节流下第 N 秒才触发」把真实代价写在记录里。两种办法都失败才算真失败。
> 对用户的可见影响：条在**后台**窗口里可能迟到（十几秒到一分钟），
> 但你一旦切回 ZCode（窗口可见、定时器恢复），它会在 ~3 秒内消失并还回输入框空隙。

> **v9 修的最后一个真问题（两个都踩过）**：
> 1. 看门狗有两条施法路径 —— 只有 4 秒的 `watch` 定时器会加 `.zcsb-stale`，
>    而它带着 `if (!el || !last) return;` 这道旧护栏；`ensure()` 重建节点时
>    React 会把带 class 的旧节点换掉，于是「19 秒没推送，条还亮着」
>    （实测日志：`display=flex stale=false padded=1 sincePushMs=19013`）。
>    v9 把过期判定搬进 3 秒的 `beat` 心跳，并去掉 `!last` 这道护栏，
>    同时给 `probe()` 加了 `hasLast` 字段来区分「从来没推过」和「推过但现在过期」。
> 2. `startDaemon()` 原来无条件 `fs.openSync(statusbar.log, "a")`，
>    而日志文件可能正被另一个进程独占 —— Windows 下直接 `EBUSY` 抛出来，
>    把验证脚本自己在失败分支里搞崩，守护进程状态也就不明不白了。
>    现在这一步包了 try/catch，占不到日志文件就退回 `stdio:"ignore"` 继续启动。

> 还有一个改覆盖层时的坑：`overlay.js` 开头有
> `if (window.__zcodeSB && window.__zcodeSB.version === VERSION) return;`，
> 而验证脚本是**注入到已经开着 v8 的页面**里的 —— 同一个版本号下改代码，页面会直接
> `return`，改动静默不生效（v8 的 2px 余量就是这么先「改了个寂寞」的）。
> 所以**改了 overlay.js 就一定要升 `VERSION`**，改完顺手重启守护进程。

> 截图是分开用 `shotclip.mjs` 裁的（验证脚本只在给了第 4 个参数时才截全页，
> 以前把 `--stale` 当成文件名，生成了一个叫 `--stale` 的 414KB PNG）：
>
> ```
> node shotclip.mjs 9222 clip-v9.png 1040 878 330 62
> ```
>
> 裁出来这一块（放大 2× 后）用视觉识别回读，转写为
> `↺ 13 轮 99 步 · 63 tok/s │ ▤ 8.6M tok`，位置就在输入框卡片圆角底边正下方、
> 与之右端对齐，确认「正下面 + 能辨认」这两条都成立。

**布局护栏侧**（`guardtest.mjs`，同样在真实 ZCode 上跑，不去点它的 UI）：

```
✓ 已连接 file:///E:/ZCode/resources/app.asar/out/renderer/index.html?restoreS
起始: composerBottom=904.310 / 窗口 935，包裹层 16px → 31px，带标记元素 1 个
… 已临时把输入框链上 16 个元素的量测抬高 300px（模拟「输入框不在底部」），等心跳重新布局
抬高后: composerBottom=635.570 / 935，包裹层 nullpx → nullpx，带标记元素 0 个
✓ 护栏生效：识别出输入框不在底部，内边距已还原、标记已清除
… 已恢复真实量测，等心跳把输入框重新抬起来
恢复后: composerBottom=904.373 / 935，包裹层 16px → 31px，带标记元素 1 个
✓ 恢复后自动重新抬起，且内边距和起始完全一致（31px，基准没被越加越厚）
✓ 统计条仍在输入框下方（条顶 911 ≥ 输入框底 904.373）

护栏测试全部通过。
```

> 这个测试对 ZCode 自己的状态很敏感：切会话 / 开侧栏 / 新建会话时输入框会短暂
> 消失（实测 `composerBottom=null`，恢复后变回 335 —— 新建会话页那个大输入框在屏幕中间）。
> 第一版脚本把这种环境抖动当成了回归，报「恢复真实量测后没有重新腾出空隙」。
> 现在取快照会重试到 8s / 15s，而且**输入框不贴底时的断言换成「什么都没残留」**，
> 每个分支都有真断言，不会因为页面换了状态就静默通过。

**「本问」侧**（`turntest.mjs`，A 段拿数据库独立复算、B 段推合成数据验四种画法）：

```
A 段：条上的数字 vs 数据库（独立口径复算）
  条: 本问 94 tok/s · 6.0k tok 累计 26 轮 196 步 · 74 tok/s 17M tok
  库: 本问 94.3 tok/s / 5998 tok（completed）· 累计 26 轮 196 步 · turn=turn_f635464b-…
  ✓ 条上有「本问 … tok/s · … tok」
  ✓ 条上有「累计 N 轮 N 步 · … tok/s」
  ✓ 条处于显示状态（工作区、未过期）
  ✓ 本问/累计各项数字与数据库一致
  ✓ 条右端仍与输入框右端对齐（1054 vs 1054）
B 段：四种状态下的画法（推合成数据，不连数据库）
  进行中: 本问 -- tok/s · 0 tok 累计 6 轮 119 步 · 97 tok/s 10M tok
  ✓ 刚发问、还没数字时显示「本问 -- tok/s · 0 tok」
  ✓ 进行中时图标在转（.zcsb-spin 存在）
  已完成: 本问 94 tok/s · 6.0k tok 累计 6 轮 119 步 · 97 tok/s 10M tok
  ✓ 已完成的轮次显示「本问 94 tok/s · 6.0k tok」
  ✓ 轮次结束后图标不再转
  ✓ 累计段保持原样（6 轮 119 步 · 97 tok/s）
  ✓ 尾部的总 token 还在（10M tok）
  无轮次: 累计 6 轮 119 步 · 97 tok/s 10M tok
  ✓ 认不出一轮时整段「本问」不画
  ✓ 没有本问时累计段照旧
  ✓ 没有本问时图标数量没少（≥2 个）
  · 等注入器把真实数据推回来…
  ✓ 条自己回到了真实数据：本问 94 tok/s · 6.0k tok 累计 26 轮 196 步 · 74 tok/s 17M tok

GREEN
```

A 段是**独立复算**：脚本自己用 `node:sqlite` 走一遍「最新一条 `main_turn` → `turn_id` → 聚合」，
再拿条上的文本按正则解析出来比 —— 不是把覆盖层的算法抄一遍，所以覆盖层算错时它会翻脸。
B 段把四种状态的合成指标直接推进 `window.__zcodeSB.update()`（含 `hasTurn:false`），
断言「进行中显示 `--` 且转圈」「结束后不转、累计段不动」「没有本问时整段不画但图标不少」，
最后等注入器把真实数据改回来 —— 这一步同时验证了心跳会覆盖掉任何外来数据。

> 这一项刚写好时也报过假失败，原因不在覆盖层：脚本断言「字号 ≥12px、padded=1」，
> 而当时页面上留着一个卡住的 520px 视口（见下），条在 520 宽度下合理地压到 11px、
> 输入框也没有空隙可让。**测试之间的状态污染**比代码 bug 更容易骗人，见下面「串跑顺序」那一条。

> 后来又报过一次假失败，这次是**容差没跟上显示的精度**：
> 条上写的是 `14k`，库里是 `14432`，断言 `|14k − 14432| ≤ max(50, 2%) = 288.6` 不成立，
> 于是判「本问 tok 14k ≠ 库 14432」。数字是对的 —— 条上的 token 数**本来就是显示过的**
> （`6.0k` / `14k` / `17M`），拿它跟精确值比就必须把量化台阶算进去。
> 现在容差按字符串自己算：`台阶 = 后缀倍率 ÷ 10^小数位`（`6.0k` → 100、`14k` → 1000、`17M` → 1e6），
> 容差取半个台阶；解析不出来的写法直接返回 `Infinity`，不许蒙混过关。
> 再遇到这种红，先问一句「**这个数字本来是被谁四舍五入过的**」，别急着去改覆盖层。

**串跑顺序与测试间的状态污染**（`_t\runall.ps1` + `_t\recover.mjs`，2026-09-28 实测）：

一次串跑里 6 项报红，逐条查下来**没有一项是覆盖层的回归**，全是测试之间互相污染：

| 现象 | 真实原因 |
|---|---|
| `verify-injection` 报「统计条顶到窗口右边缘了：550 / 520」 | 页面上留着上一轮某次探针**卡住的 520px 布局视口**：`innerWidth=520`，而 ZCode 自己的输入框仍按真实宽度排在 550，条对齐输入框 → 看起来像条越界 |
| `turntest` 报「字号被压到 11px」「padded=0」 | 同上，520 宽度下覆盖层合理地缩小字号、输入框也确实没空隙可让 |
| `guardtest` 报「恢复后没重新腾出空隙」 | 同上（输入框底 919.9 贴底，但 520 视口下的量测链不稳定） |
| `newtasktest` / `landingtest` / `revivetest` 报「没自己恢复回工作区」 | `widthstest` 排在**中间**，它的收尾重载让 ZCode 把会话滚到 `rect.bottom=-920`（输入框在视野上方），覆盖层的 `composerBox()` 有「不可见就跳过」的判定 → `composerBottom=null`、条合理地藏起来 |

两条修法，都已落地：

1. **`widthstest` 移到最后跑** —— 它是唯一会改页面状态的测试（覆盖布局视口 + 重载渲染进程），
   不该夹在中间。收尾复位之后还要用 `settleWorkspace()` 把工作区等回来再断言，
   否则「重载后 ZCode 停在非工作区」会被当成「条没回来」。
2. **新增 `_t\recover.mjs`** —— 一步复位，插在开跑前和每个会导航的测试之前：
   先把卡住的布局视口清掉并重载（这是唯一能立刻拉回真实宽度的办法），
   再等注入器重推、然后如果输入框在视野外就 `scrollIntoView({block:'end'})` 把它滚回来
   （代价最小、不换会话），仍不行才退回「点最近一个会话 / 点返回键」。
   它按「视口修不回来才算失败、工作区回不来只记录」处理退出码 —— 后者是 ZCode 自己的页面状态，
   不该让复位步骤变成又一个假失败。

> 这里最值得记的一条：**测试会互相污染，而且表现得和真回归一模一样。**
> 那次 6 项报红里，只有一项（`lagtest`）在复位后仍然红，其余全是上面这两条状态问题。
> 所以现在宁可多插几次复位（健康时每次约 1 秒），也不让任何一项跑在不明状态的页面上。

**断言项都是量出来的**，不是写死的期望：脚本会自己断言「条不出现缓存字样」「条顶不低于
输入框底边」「条不超出窗口底部」「条右端与 `composerRight` 相差 ≤ 3px」「字号 ≥ 12px」
「条上方净空在 2~14px」「包裹层 `padding-bottom` 只增不减且增幅 ≤ 28px」；
`settingstest.mjs` 另外把两个状态下的 `inSettings` / `hidden` / `display` / `padded`
四个字段各自断言死（设置页里必须是 `true / true / none / 0`，回到工作区必须是
`false / false / flex / 1`），再顺手复核一次位置。
顺带一提，脚本里的期望版本号是**从 `overlay.js` 里读的**，
不是写死的，所以以后升版本不会再出现「断言写着 4、实际是 5」这种假失败。

`__zcodeSB.probe()` 也可以随时手工调：

```js
JSON.stringify(window.__zcodeSB.probe())
```

**`--remote-debugging-port` 是否被 ZCode 接受**：是。用隔离实例验证过
（`ZCODE_DATA_BASE_DIR` 指向临时目录，避免碰真实数据）：

```
User-Agent: Mozilla/5.0 ... ZCode/3.11.2 Chrome/146.0.7680.80 Electron/41.0.3 Safari/537.36
页面目标:   file:///E:/ZCode/resources/app.asar/out/renderer/index.html?restoreSession=true&...
```

同时确认真实 `db.sqlite` 与 `setting.json` 的 `LastWriteTime` **未被改动**。

**冷启动整链路**（先 `taskkill /IM ZCode.exe` 全部退出，再跑启动器）：

```
[1/4] Node v24.20.0  OK
[2/4] ZCode: "E:\ZCode\ZCode.exe"
[4/4] 启动 ZCode（带 --remote-debugging-port=9222）...

  调试端口 127.0.0.1:9222 已就绪。
  正在后台启动注入器 ...
[22:15:15] 守护进程已启动：db=...\db.sqlite  port=127.0.0.1:9222  interval=1200ms
[22:15:16] 已连接渲染进程 file:///E:/ZCode/resources/app.asar/out/renderer/index.html?...
[22:15:16] 统计条已注入渲染进程
```

已开端口时再次运行启动器，会走「直接挂接」而不是重启 ZCode：

```
[3/4] ZCode 已在运行且已开调试端口 —— 直接挂接
[4/4] 跳过启动
[i] 检测到注入器已在运行 —— 跳过，不会重复启动。
```

**健壮性实测**：

| 场景 | 结果 |
|---|---|
| 页面刷新（`Page.reload`） | 统计条 271~767ms 后回来，且立刻显示正确旧值（本地缓存），无空档 |
| 外部把统计条改成假值 | 1660ms 内被心跳改回真实值 |
| 重复启动注入器 | 第二条进程写日志后退出，仍只有 1 个守护进程、1 条统计条 |
| 26 秒空闲 | 只发 3 次 `Runtime.evaluate`（1 次更新 + 2 次心跳），非按 tick 发 21 次 |
| 注入器重启（换新版覆盖层） | 包裹层内边距靠 `data-zcsb-base-pad` 还原基准，不会越加越厚（实测仍是 16 → 31） |
| 窗口尺寸变化 | `resize` 事件 + 3s 心跳都会重算摆放，条跟着重新落在输入框下方 |

> ⚠️ `verify-injection.mjs` 里有一项「body 被替换后自愈」测试，它会把
> `document.body` 换成一个空节点 —— 也就是**清空整个页面的 DOM**。
> 这个测试默认**跳过**，只有加 `--destructive` 才执行，且**只能对一次性测试页用**。
> 误对真实 ZCode 执行会抹掉它的界面（重新加载页面即可恢复）。

**`lagtest` 里量错的那一次：返回键不是「去欢迎页」**（2026-09-28 修）：

`藏` 这一步原来点的是顶栏返回键，量到过一次 `总 17921ms`，而且当时
`判据翻面 无`、`nav=false`、工作区标题都没变 —— 也就是说页面根本没换，
条却是「藏」了的。三个疑点连起来只能指向一件事：**这一步压根没测到换页响应**。
逐条排除后（`probe()` 里能翻面的只有三条路：设置浮层、输入框离开视口、看门狗过期）：

- `desktop-top-nav-back` **不是浏览器后退**。ZCode 的 `history.length` 恒为 1，
  这个键只是在**最近打开过的两个会话之间来回弹**。有 2 个以上最近会话时它退不到
  项目列表，点完人还留在工作区（`anchored` 一直 `true`）；偶尔又会先弹到旧会话、
  再被路由带回原会话，前后十几秒。`landingtest.mjs` 早就为此写了 `landingSkipped`，
  这里却还在拿它当「去欢迎页」用。
- 于是 `lagtest` 现在改点侧边栏的 **`task-new-button`** —— 它永远在，一次就落到
  输入框居中的页面（`anchored` 立刻翻面），测的仍然是「判据翻面 → 条跟上」这同一件事。
  改完实测：`藏 总 16ms 判据翻面 16ms 条跟上 0ms`、`显 总 93ms 判据翻面 93ms 条跟上 0ms`。
- 同时修掉一个**采样点被丢掉**的 bug：`last = st` 原来写在 `break` 之后，命中判据的
  那个采样点（正是携带「为什么翻面」的那个）永远被丢掉，`ended.*` 于是显示的是**上一个**
  采样点，归因跟着一起错。现在 `last = st` 在 `break` 之前，并且新增 `trace`
  记录**整个采样过程**里 `stale` / `inSettings` / `composerBottom` 的极值 ——
  只看结束时那一个点是不够的：看门狗把条藏住之后注入器可能又推了一次，`stale` 已经消掉了。
  判据也从「结束时 stale」改成「采样过程中 stale 出现过」。

> 教训和上面「串跑顺序」那条是同一个：**测量脚本自己也会骗人。**
> 一个稳定性判据（这条到底是不是被我们藏起来的？）如果只看一个采样点，
> 就会把一个「根本没发生换页」的空等算成「响应很慢」。

**跑法**（一次跑完全部 17 项，串行，每项输出折成一行）：

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\xyqmbyl\.zcode-statusbar\_t\runall.ps1
```

完整输出落在 `_t\runall.log`（每项一个 `===== 名字 (exit=N) =====` 头），
最后打印一张 `test / result` 表。单独跑某一项就按本章各处的 `node <名字>.mjs 9222`。
复位单独用：

```
node C:\Users\xyqmbyl\.zcode-statusbar\_t\recover.mjs 9222
```

它打印一段 JSON 和 `SETTLED` / `SETTLED-VIEWPORT-ONLY` / `RED`：
只有「视口拉不回来」才退 1；「视口好了但条没回到工作区」退 0（那是 ZCode 自己的页面状态，
不该让复位步骤变成又一个假失败）。

> `runall.ps1` 判定结果时踩过 **`-match` 大小写不敏感**的坑：判据写 `"RED"`，
> 结果把 JSON 里的 `"ancho**red**":true` 也认成了红，17 行全是 RED。
> 现在一律锚到行首 + 词边界（`(?m)^\s*RED\b`），并且**永远把 `exit=` 代码附在结论后面**——
> 有些测试（`guardtest` / `verify-injection` / `settingstest`）只在通过时打一句中文、
> 失败时才打英文，光看文字没有 `exit` 可靠。

---

## 八、文件清单

| 文件 | 作用 |
|---|---|
| `启动ZCode(带状态栏).cmd` | 启动器：带调试端口启动 ZCode + 后台拉起注入器（日常可直接双击，但快捷方式已改走 `.vbs`） |
| `start-zcode.cmd` | 同上的英文名入口，转发到上面那个（终端 / 工具传中文路径会乱码时用） |
| `start-zcode-silent.vbs` | **快捷方式的实际目标**：把 `.cmd` 藏起来跑，只在失败时亮窗 / 弹错误框 |
| `zcode-statusbar.mjs` | 主程序：读 SQLite 算指标 + CDP 连接与推送 + 断线重连 + 单实例锁 |
| `overlay.js` | 页面端浮层：样式、图标、格式化、主题自适应、**摆放与抬高输入框**、自愈挂载、自举、本地缓存 |
| `verify-injection.mjs` | 端到端验证脚本（含位置/空隙断言 + `--stale` 看门狗慢测；自愈测试需显式 `--destructive`） |
| `guardtest.mjs` | 布局护栏测试：让量测「看起来输入框不在底部」，断言内边距被还原、且恢复后能自己抬回来 |
| `turntest.mjs` | **「本问」测试**：A 段用 `node:sqlite` 独立复算当前一轮的 tok/s 与输出 token，再解析条上的文本比对（不是抄覆盖层的算法）；B 段推合成数据验四种画法 —— 进行中（`--` + 转圈）/ 已完成 / 没有本问时整段不画 / 心跳把真实数据改回来 |
| `settingstest.mjs` | 工作区 / 设置页切换测试：真的去点「设置」和「返回工作区」，断言条在设置页里隐藏、回来后又出现且位置仍然对 |
| `landingtest.mjs` | 欢迎页 / 项目列表测试：走「新建任务 → 返回」这条确定路线离开工作区，断言条藏起来，再点回会话断言恢复（撞上 ZCode 的会话 A↔B 弹回时记 `landingSkipped` 而不报红） |
| `newtasktest.mjs` | 只测「新建任务页」这一跳的短版本（不绕项目列表，避免被上一个动作带偏） |
| `lagtest.mjs` | 反应速度测试：点侧栏的 `task-new-button` 切页并逐帧采样，量「点击 → 判据翻转」的 `lagMs` 和「点击 → 位置落定」的 `totalMs`；判据还没翻时就只能给上界，会标 `lagIsUpperBound`。**不要改回点顶栏返回键** —— 它不是浏览器后退，退不到欢迎页，量到的数字没有意义（见第七节） |
| `latencytest.mjs` | 更早的一版延时测量（从点击开始算整段墙钟 + 首次翻转锁存），数字比 `lagtest.mjs` 大且不精确，留作对照 |
| `revivetest.mjs` | 自愈测试：主动 `window.__zcodeSB.remove()` 拆掉条，断言守护进程会在若干秒内重新注入，且版本不变、仍锚定在工作区 |
| `widthstest.mjs` | 宽度扫描：用 CDP 设备度量覆盖模拟 520/700/900/1200/1719 等宽度（**不改真实窗口**），断言每个宽度上条的右端都与输入框右端像素级对齐、净空与字号正常，收尾清掉覆盖并确认回到真实窗口 |
| `dbschema.mjs` | 只读探针：打印 `db.sqlite` 里有哪几张表、`model_usage` / `turn_usage` 的列与最近几行样本（对指标口径时用） |
| `testids.mjs` | dump 当前页面可见的 `data-testid`（可带一个过滤词参数，不加参数输出很大）—— 定选择器、查 ZCode 结构变化时用 |
| `settingsprobe.mjs` | 只写不点（`9222`）/ 点进设置（`click`）/ 退出（`back`）三档，用来 dump 设置页里可见的 `data-testid`、可编辑元素和标题文本 —— 定选择器时用的就是它 |
| `vercheck.mjs` | 一行式状态回读：`overlayVersion / barText / display / cls / inSettings / hidden / stale / padded / composerBottom / rect / sincePushMs` |
| `clicktext.mjs` | 按文本点 UI 里最小的那个元素（`node clicktext.mjs 9222 "会话名"`，加 `--dry` 只看候选）—— 重载渲染进程后 ZCode 会回到欢迎页，用它把某个会话点回来 |
| `geom.mjs` | 只读几何探针：打印可编辑元素、祖先链 rect/padding、条的位置、`elementFromPoint` |
| `shot.mjs` | 抓取渲染进程状态 + 截图，排查「条没出现」时用 |
| `shotclip.mjs` | 只截窗口底部一小块（默认放大 2×），用来肉眼核对间距 |
| `clip-v16.png` | 当前版实测图：输入框卡片圆角底边 + 正下方右对齐的统计条 |
| `full-v16.png` | v16 全绿那一次留下的整页截图（1719×935 全窗口，用来看整体位置） |
| `clip-v14.png` | v14 窄窗口错位那个 bug 的现场图（留档用） |
| `clip-v9.png` / `full-v9.png` / `full-v10.png` / `full-v10-stale.png` | **已归档到 `_trash\`**（2026-09-28）：v9/v10 两轮之前的验证截图，已被 v14/v16 取代 |
| `reload.mjs` | 重载 ZCode 渲染进程并回读 DOM 状态 |
| `reloadwatch.mjs` | 重载后逐 250ms 观察统计条何时恢复（验证自举/缓存是否生效） |
| `raceobserve.mjs` | 写入假指标，观察心跳多久把它改回真实值 |
| `domdump.mjs` | dump 渲染进程 DOM / 控制台错误 |
| `targets.mjs` | 列出 CDP 的全部 target（browser 级 `Target.getTargets`） |
| `barvis.mjs` | 只读探针：查 `#zcsb-bar` 是否在 DOM 里、以及是否真的可见（排查「条没出现」用） |
| `_t.ps1` | 启动器分支测试：用桩 `.cmd` 制造退出码 0/1/3/4，核对「静默 / 亮窗 / 弹框」三种行为 |
| `_t\runall.ps1` | **串跑整套验证**并把每项收敛成一张表（每行 `test / result`）。注意它是**纯 ASCII** 的，原因见第九节；跑法见第七节末尾 |
| `_t\recover.mjs` | **测试之间的复位步骤**（不是断言）：清掉别人留下的设备度量覆盖并重载把布局视口拉回真实宽度，再把滚出视野的输入框滚回来 / 点回会话。`widthstest.mjs` 和 `runall.ps1` 共用同一份逻辑；单独跑 `node _t\recover.mjs 9222` 会打印复位前后状态 |
| `_t\*.mjs` | 一次性排查脚本（不属于正式套件，随时可删）：`historyhop.mjs` / `topnav.mjs` / `sidebarbtns.mjs` / `moremenu.mjs` / `palette.mjs` / `whatshere.mjs` 是找导航路线用的点击探针，`whyscroll.mjs` / `whosefault.mjs` 查「输入框被甩到视口外」的责任方，`park.mjs` 把界面停回一个健康的会话，`narrow.mjs` dump 窄窗口下的几何，`vpreload.mjs` 是「只有重载才能立刻恢复布局视口」那个实验，`composers.mjs` / `chain.mjs` 是查 v14 那个错位时数「页面上到底有几个输入框候选、祖先链各层底边在哪」的只读探针 |
| `_t\` 其余未登记脚本 | 开发过程中留下的专项探针/诊断，未列入正式套件、正文也没写过：`activeprobe.mjs` / `asarprobe.mjs` / `carddiag.mjs` / `fixvp.mjs` / `hookprobe.mjs` / `minwin.mjs` / `padprobe.mjs` / `padrepro.mjs` / `sidprobe.mjs` / `storeprobe.mjs` / `trapdiag.mjs` / `tsdiag.mjs` / `v18diag.mjs`；另 `_t\restart.ps1` 已被 `_t\recover.mjs` 取代。留作排查用，删掉不影响正式套件 |
| `backup\` | 两个原始快捷方式的备份 |
| `_trash\` | **2026-09-28 整理归档**（不是删除，可整体还原）：`_t\rc0`〜`rc4`（`_t.ps1` 每次跑都会重建的桩目录）、`_t\runall.log` + `_t\runall_clean.txt`（重跑即再生）、`_t\now.png`、`t.out`（启动器 stdout 重定向残留）、`find-zcode.ps1`（0 引用，已被启动器的候选路径列表取代）、v9/v10 旧截图；`_trash\_backup\` 是本次改动前的 `启动ZCode(带状态栏).cmd` 与 `README.md` 原件 |
| `.daemon.lock` | 单实例锁（记 pid），正常退出时自动删除；残留也不会挡启动 |
| `statusbar.log` / `launch.log` / `statusbar.err.log` | 运行日志（首次运行后生成） |

---

## 九、改这几个文件时的编码坑（实测踩过）

这套东西是 `.cmd` + `.vbs` + `.ps1` 三种脚本混着跑的，**三种编码要求完全不同**，
写错了报的错完全看不出原因：

| 文件 | 必须存成 | 为什么 |
|---|---|---|
| `.cmd` | **ANSI / GBK（代码页 936）、无 BOM、CRLF** | cmd.exe 按 OEM 代码页逐字节读脚本。存 UTF-8（哪怕带 BOM）会让中文变成乱码，实测报 `'@echo' is not recognized`、`'显示进度窗口，8' is not recognized` 这类怪错。**也不要写 `chcp 65001`** —— 加了反而让脚本自己的中文被按 UTF-8 重解码。本机 `ACP=936`、`OEMCP=936`，所以 936 就是对的。 |
| `.vbs` | **UTF-16LE + BOM** | 脚本宿主（`wscript.exe`/`cscript.exe`）对 UTF-16LE-BOM 支持最好；存成别的会认不出中文。 |
| `.ps1` | **纯 ASCII** | Windows PowerShell 5.1 用 ANSI 代码页读脚本（不是 UTF-8），写了中文会报 `Could not find file '...鍚姩ZCode(...)cmd'` 这种「中文变乱码文件名」的错。所以 `_t.ps1` 里一个字的中文都没有。 |

Node 自带的编码器**没有 GBK**：要写 `.cmd` 得借 PowerShell 的
`[System.Text.Encoding]::GetEncoding(936)` / `::Unicode` + `[System.IO.File]::WriteAllText`。

反过来，读 GBK 文件也别用普通 `Get-Content`：

```powershell
[System.IO.File]::ReadAllText('...\启动ZCode(带状态栏).cmd', [System.Text.Encoding]::GetEncoding(936))
```

（顺带一提：`[System.IO.File]::ReadAllText(path, enc)` 仍然会认 BOM，
所以拿 936 去读 UTF-16LE 的 `.vbs` 也能读到正确内容。）

**2026-09-28 又踩了一次，两条补充**：

1. **写文件的工具输出的是「无 BOM 的 UTF-8」**，所以只要在这个仓库里新建 / 重写 `.ps1`，
   默认就会违反上表第三行 —— 一旦里面有中文字面量，PowerShell 5.1 按 ANSI(936) 重新解码，
   报出来的错跟编码毫无关系，实测三连：
   `Unexpected token 'problems":\s*\[\]'`、
   `The string is missing the terminator: "`、
   `Missing closing '}' in statement block`。
   修法不是去猜语法，而是**把 `.ps1` 里的中文全部搬走**：
   `_t\runall.ps1` 现在纯 ASCII，所有中文输出都由它调用的 Node 脚本负责。
   换句话说 —— **改 `.ps1` 时别忘了它是 ASCII-only 的，不是「尽量 ASCII」**。
2. **`-match` 是大小写不敏感的**，而且不锚定就等于子串匹配。
   判决词 `"RED"` 会命中 JSON 里的 `"ancho`**`red`**`:true`，于是一整张表全是 RED。
   凡是拿文本当判据，一律写成 `(?m)^\s*RED\b` 这种「行首 + 词边界」的形式，
   并且**把 `exit=` 代码一起打出来**当兜底 —— 文字判据只能用来分类，
   真伪还是退出码说了算。



---

## 十、2026-09-28 整理记录

### 1. 归档（移到 `_trash\`，共 13 项 / 6,829,853 B ≈ 6.51 MB）

| 项 | 字节 | 为什么没用 |
|---|---|---|
| `_t\rc0` `_t\rc1` `_t\rc3` `_t\rc4` | 21,110 | `_t.ps1` 第 26 行的 `New-Item -Type Directory -Force` 每次跑测试都会重建 |
| `_t\runall.log` | 30,281 | 上次串跑的原始输出，重跑再生 |
| `_t\runall_clean.txt` | 19,764 | 同上 |
| `_t\now.png` | 2,036,182 | 临时截图 |
| `t.out` | 787 | 启动器 stdout 重定向残留（内容是一次成功启动的日志） |
| `find-zcode.ps1` | 3,358 | 目录内全量引用扫描 **0 处引用**；它记录的是被放弃的「自动定位 ZCode.exe」方案，启动器最后改成了候选路径列表 |
| `clip-v9.png` `full-v9.png` `full-v10.png` `full-v10-stale.png` | 4,718,371 | v9/v10 的验证截图，已被 v14/v16 取代 |

还原办法：把 `_trash\` 里的东西按原路径搬回去即可（`_t\` 下的回 `_t\`，顶层的回顶层）。

### 2. 修掉一个真 bug：启动器的进程检测一直是失效的

`启动ZCode(带状态栏).cmd` 第 69 行和第 99 行原来都是：

```
tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
```

但本机 PATH 里 `find` 先解析到 Git 的 GNU find（`C:\Program Files\Git\usr\bin\find.exe`），
Windows 自带的 `find.exe` 被遮蔽了，于是这两行**永远失败**
（实测报错原文：`find: '/I': No such file or directory`）。
后果：启动器从不判断「ZCode 已在跑 / 调试端口已开」，每次都直接 `start`。

`E:\ZCode\zcode-bg\启动ZCode-带壁纸(静默).vbs` 早就改用 `findstr` 规避了（3 处），状态栏这个漏了。
**已改**为 `| findstr /I "ZCode.exe" >nul`（按第九节要求保持 ANSI/GBK、无 BOM、CRLF）。

### 3. 本次同时发现、没动的

- `overlay.js` 里的 `var VERSION = 22;`（`overlay.js`:82），注释一路记到 v22：
  v17 修本问口径、v18/v19 修「条压在输入框上」、v20 把「卡片底边」量准（自检改成量「空隙有没有出来」）、v21（无注释）、v22 把 tooltip 修回来（`render()` 里本来拼了会话名/首字耗时/压缩量，中途丢了）。
  而本 README 前三节的机制说明只写到 **v16** —— 正文的版本叙述目前落后代码 6 个版本，本次只补了第八节清单、第七节的版本提示和本节。
- 开始菜单里有个残留 `ZCode.lnk.bak-noport`。
- `E:\ZCode\ZCode.exe` 是僵留的 **3.11.2** 旧安装，正在用的是 `E:\新建文件夹\ZCode\ZCode.exe` **3.14.3.7762**；`E:\新建文件夹\` 下只有 `ZCode\` 这一个子目录。是否清理由你自己决定，本次没动。