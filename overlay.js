/*
 * ZCode 底部数据统计条 —— 页面端覆盖层（由 zcode-statusbar.mjs 通过 CDP 注入）
 *
 * 设计约束（为了「一直适配」）：
 *   1. 不依赖 ZCode 的 DOM 结构：只把自己挂到 document.body 的同级位置，
 *      不插进 React 的根节点，因此不会被 React 的 diff 清掉，也不会破坏布局。
 *   2. 不依赖 ZCode 的类名/选择器（那些是 hash 过的、每次更新都会变）。
 *      唯一用到的结构探测是「哪个元素可编辑」（textarea / [contenteditable]），
 *      这是任何聊天界面都有的东西，不是 ZCode 的私有类名。
 *   3. 不依赖打包后的 chunk 文件名（IntlProvider-Db46X9QF.js 这种会变）。
 *   4. position: fixed —— ZCode 改布局也不影响它。
 *   5. pointer-events: none —— 永远不会挡住 ZCode 自己的按钮。
 *
 * 摆放方式：压在「输入框卡片」正下方的纯文字条，不画背景不画边框。
 *   横向：右端对齐输入框卡片的右端（不是窗口右端 —— 那是窗口右下角，
 *         离输入框还有几百像素，看着就不像「在输入框下面」）。
 *         对齐优先，只在条左端要被挤出屏幕时才往右收（v16）。
 *   纵向：先探出输入框卡片的实际下边界，把条放进它正下方 GAP=6px 处；
 *         实测卡片底下只有十几像素，所以先把卡片整体抬高一点（改包裹层的内边距，
 *         页面内运行时样式，可逆），再按剩余空间决定字号。
 * 这样 ZCode 以后改内边距/改布局，条会自己跟着落下去，而不是压住输入框。
 *
 * 条上显示什么（v15）：本问在前、累计在后。
 *   「本问 [图标] X tok/s · Y tok │ 累计 N 轮 N 步 · M tok/s │ [库图标] Z tok」
 *   本问 = 最近一轮（这一问问得值不值），累计 = 整个会话。数字都由注入器从
 *   ZCode 自己的统计表算好推过来，页面侧只负责画；m.hasTurn 为假时整段本问不画。
 *   本问正在跑（m.turnRunning）时图标转圈，数字还没落盘时显示 --，不拿上一轮充数。
 *   v17：本问的 tok 改成「主轮口径」，和本问 tok/s 同分子 —— 之前用的是
 *   turn_usage.output_tokens，它把这一轮里的上下文压缩也算进去，于是会并排出现
 *   「150 tok/s · 13k tok」（反推 87s，实际纯生成 98.6s，对不上）。
 *   压缩量移到 tooltip 说明，不丢信息。
 *
 * v18/v19：修「条压在输入框上」。
 *   症状：偶尔 padded=0 而 anchored=true，条被摆到输入框上沿之上，一直不恢复。
 *   根因不是「找不到空隙」，而是「腾空隙腾错了地方」：只有底边真的落在窗口底上的
 *   那一层，加 padding-bottom 才会把输入框卡片整体抬起来。卡片自己（底边 919 /
 *   窗口 935）不是那一层 —— 给它加内边距只是把它自己往上撑高，卡片下沿纹丝不动，
 *   底下还是只有 16px，条照样压住输入框。更糟的是它是自锁的：唯一的补救动作
 *   （腾空隙）失败了，下一拍量到的还是同一个位置。
 *   修法分两步，都不猜 ZCode 的结构：
 *     1) 选容器只看「底边贴不贴窗口底」，容差保持 2px（放宽容差反而会选中卡片自己，
 *        v18 第一版就是这么错的，有实测）；
 *     2) 写完内边距立刻自检：写完必须真的多出一块可以放条的空隙。没多出来就地还原、
 *        记住这层不能用，并让 layout() 走「宁可整条藏起来，也绝不压住输入框」那条路。
 *
 * v20：把「卡片底边」这件事量准，并且自检改量「空隙有没有出来」。
 *   用 _t\wrapcheck.mjs 把 v18 那个坏状态**主动造出来**（把承担底部留白的那层内边距
 *   清零，卡片就贴到窗口底），然后 dump 整条祖先链，发现两处都还能被骗过去：
 *     a) composerBox() 往上走时，第一个碰到「底边贴住窗口底」的祖先就停，把已经量到的
 *        最大底边当卡片底边。可是卡片贴底时，输入框自己那一层就是第一个贴底的祖先 ——
 *        于是它返回**输入框自己的底边**（863.9）而不是卡片底边（935.6），凭空多出 71px
 *        「空地」，条正好被摆进卡片内部（卡片背景 rgb(43,43,43)、圆角 16px，实测条
 *        落在卡片里、盖住底部那排按钮）。量到的卡片底边比输入框底边更靠下过才算找到了
 *        卡片下沿；一层都没找到就按那个贴底祖先的底边算 —— 空间为 0，老实藏起来。
 *     b) 自检比的是「卡片底边有没有往上走」（cb - b2.bottom）。选错容器时输入框会跟着
 *        卡片内边距一起往上挪，这个差值照样很大，自检被骗过去 → padded=1 但底下没地方。
 *        改成直接量剩余空隙（窗口底 - 卡片底边），和 layout() 用的是同一个数、同一把尺。
 *   两处合起来：坏状态下 padded=0 且整条隐藏，绝不落进卡片里。回归用例 _t\wrapcheck.mjs。
 *
 * v22：tooltip 复活。之前 render() 里认真拼了一大段说明（会话名、首字耗时、压缩量），
 *   挂在 el.title 上，但整条是 pointer-events:none，title 永远弹不出来——纯死代码。
 *   现在页面自己监听 mousemove：光标落进条的矩形时弹出一张自绘小卡片（同样
 *   pointer-events:none，不挡任何东西），挪开就消失；条隐藏/过期时卡片跟着撤。
 *
 * v23：悬浮卡片从「一串说明文字」升级成「会话统计」面板。
 *   条上只放得下三个数（本问 tok/s · 累计轮步 · 总 tok），再塞就看不清了；
 *   而「这个会话一共花了多少时间、多少花在等模型、多少花在跑工具、首字多慢、
 *   缓存省了多少」这些问题都是同一类、且都值得一眼看到。所以卡片改成：
 *     标题「会话统计」+ 五行指标（左标签右数值，右对齐、等宽数字）
 *     · 模型用时      Σ 主轮请求 duration_ms
 *     · 工具调用用时  Σ tool_usage.duration_ms
 *     · 首 token 平均 AVG(time_to_first_token_ms)，只统计真的等到过首字的请求
 *     · 输出速度      Σ output_tokens ÷ Σ(duration_ms − ttft_ms)，和条上同一个口径
 *     · 缓存命中      cache_read ÷ input
 *   下面再跟几条灰字附注（会话名/ID、本问明细、压缩量、累计输入输出），
 *   也就是 v22 那张卡片的原始内容——升级不丢信息，只是把它降级成附注。
 *   全部数字仍由注入器从 SQLite 算好推过来，页面侧只负责画；
 *   字段缺失时显示 `--`，绝不拿 0 冒充（刷新后先按 localStorage 旧值画的那一瞬，
 *   旧 payload 里没有这些字段）。
 *
 * 只显示在工作区：设置页是一层盖满窗口的浮层（工作区 DOM 连同输入框都还在底下），
 * 所以用 ZCode 的 data-testid（settings-page / settings-back-button /
 * settings-section-nav-*）判断「现在在设置里」，命中就把条藏起来并还回输入框的空隙。
 *
 * 反应速度（v12）：切换页面靠的是 React 自己重排，不会发任何我们能直接听到的事件。
 * 之前只靠守护进程推送（≥1.2s）和 3s 心跳来复核，用户点一下返回，条要愣上一两秒才消失，
 * 手感很钝。现在补两条快路径：
 *   1) 交互踢一脚：click / pointerdown / keydown / popstate / hashchange 一冒出来就立刻
 *      layout()，并在随后 1s 内按几档延迟重算（React 提交、动画结束都在这一秒内落定）；
 *   2) 心跳从 3s 收到 500ms：万一某次切换完全不伴随交互（自动恢复会话、窗口重新可见），
 *      最迟半秒也该归位。layout() 本身是幂等的，重复调用只会读几次矩形，代价可忽略。
 *
 * 只暴露 window.__zcodeSB = { update, remove, version, kick, probe }。
 */
(function () {
  "use strict";

  var VERSION = 23;
  if (window.__zcodeSB && window.__zcodeSB.version === VERSION) return;
  /* 页面上可能还挂着更早的版本（比如注入器刚升级、页面还没刷新）。
     它的定时器会继续和我们抢着改样式，所以先让它自己清理干净再装新版本。 */
  try {
    if (window.__zcodeSB && typeof window.__zcodeSB.remove === "function") window.__zcodeSB.remove();
  } catch (e) { /* ignore */ }

  var BAR_ID = "zcsb-bar";
  var TIP_ID = "zcsb-tip";
  var TIP_TITLE = "会话统计";
  var STYLE_ID = "zcsb-style";
  var CACHE_KEY = "zcsb:last";
  /* render() 组装好的卡片内容 {rows:[[标签,值]…], notes:[…]}；
     tipOn 记录光标当前是否停在条上（悬浮卡片开关） */
  var lastTip = null;
  var tipOn = false;

  /* 刷新页面后守护进程可能要过一会儿才推下一轮指标。
     这里把上一轮指标存在本地，重载后先按旧值画出来，避免中间空一段。 */
  function loadCache() {
    try {
      var s = window.localStorage && localStorage.getItem(CACHE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function saveCache(m) {
    try { if (window.localStorage && m) localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
  }

  var last = loadCache();

  /* ---------- 样式（主题自适应，不写死颜色） ---------- */
  function installStyle() {
    var st = document.getElementById(STYLE_ID);
    var css = [
      "#" + BAR_ID + "{",
      // right/bottom 由 layout() 按输入框卡片实时写入，这里是还没探测到时的兜底值
      "  position:fixed; right:5px; bottom:8px; z-index:2147483647;",
      "  display:flex; align-items:center; gap:9px;",
      "  margin:0; padding:0; border:0; background:transparent;",
      "  font:500 13px/1.15 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;",
      "  font-variant-numeric:tabular-nums;",
      "  letter-spacing:.01em; white-space:nowrap;",
      "  pointer-events:none; user-select:none;",
      "  color:var(--zcsb-fg);",
      /* 无背景，用同色系的柔光保证压到聊天内容上也还看得清 */
      "  text-shadow:0 1px 2px var(--zcsb-shadow), 0 0 1px var(--zcsb-shadow);",
      "}",
      "#" + BAR_ID + " .zcsb-seg{display:flex; align-items:center; gap:6px;}",
      "#" + BAR_ID + " .zcsb-sep{width:1px; height:1em; background:currentColor; opacity:.3;}",
      // 图标用 em：字号被收小时会跟着缩，不会把行撑歪
      "#" + BAR_ID + " .zcsb-ico{display:block; width:1em; height:1em; flex:0 0 auto; opacity:.8;}",
      "#" + BAR_ID + " .zcsb-num{font-weight:600;}",
      "#" + BAR_ID + " .zcsb-mut{opacity:.78; font-weight:400;}",
      "#" + BAR_ID + " .zcsb-off{opacity:.45;}",
      "#" + BAR_ID + ".zcsb-idle{opacity:.5;}",
      /* 注入器长时间没消息（被杀掉 / 崩了）就把自己藏起来，别留一串过期数字 */
      "#" + BAR_ID + ".zcsb-stale{display:none !important;}",
      /* 只在工作区显示：设置页（盖满整屏的那层）里不显示 */
      "#" + BAR_ID + ".zcsb-hidden{display:none !important;}",
      "#" + BAR_ID + " .zcsb-spin{animation:zcsb-rot 2.4s linear infinite; transform-origin:50% 50%;}",
      "@keyframes zcsb-rot{to{transform:rotate(360deg);}}",
      "@media (prefers-reduced-motion: reduce){#" + BAR_ID + " .zcsb-spin{animation:none;}}",
      /* 亮色主题 */
      "#" + BAR_ID + "{--zcsb-fg:rgba(32,32,38,.88); --zcsb-shadow:rgba(255,255,255,.95);}",
      /* 暗色主题：按 ZCode 实际背景判定 */
      "html.zcsb-dark #" + BAR_ID + "{--zcsb-fg:rgba(242,242,247,.92); --zcsb-shadow:rgba(0,0,0,.85);}",
      /* 悬浮说明卡片：条本身鼠标穿透（title 弹不出来），这张卡片由 mousemove 驱动，
         同样 pointer-events:none —— 只显示，不拦截任何点击。 */
      "#" + TIP_ID + "{position:fixed; z-index:2147483647; display:none; max-width:460px;",
      "  padding:7px 10px; border-radius:8px; white-space:normal; text-align:left;",
      "  font:400 12px/1.55 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;",
      "  pointer-events:none; user-select:none;",
      "  background:var(--zcsb-tip-bg); color:var(--zcsb-tip-fg);",
      "  box-shadow:0 2px 10px var(--zcsb-shadow);}",
      ":root{--zcsb-tip-bg:rgba(250,250,252,.98); --zcsb-tip-fg:rgba(32,32,38,.92);}",
      "html.zcsb-dark{--zcsb-tip-bg:rgba(30,30,36,.97); --zcsb-tip-fg:rgba(242,242,247,.94);}",
      /* v23：「会话统计」面板的内部排版。标题 + 两列网格（标签左、数值右且等宽对齐），
         附注之间用一条极淡的分隔线和上面的指标区分开。 */
      "#" + TIP_ID + " .zcsb-tip-h{font-weight:600; margin-bottom:5px; opacity:.95;}",
      "#" + TIP_ID + " .zcsb-tip-g{display:grid; grid-template-columns:auto 1fr; column-gap:16px; row-gap:3px; align-items:baseline;}",
      "#" + TIP_ID + " .zcsb-tip-l{opacity:.72; white-space:nowrap;}",
      "#" + TIP_ID + " .zcsb-tip-v{font-weight:600; font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap;}",
      "#" + TIP_ID + " .zcsb-tip-n{margin-top:6px; padding-top:5px; border-top:1px solid var(--zcsb-tip-line); opacity:.78; font-size:11px; line-height:1.5;}",
      "#" + TIP_ID + " .zcsb-tip-n ~ .zcsb-tip-n{margin-top:2px; padding-top:0; border-top:0;}",
      ":root{--zcsb-tip-line:rgba(0,0,0,.12);}",
      "html.zcsb-dark{--zcsb-tip-line:rgba(255,255,255,.16);}",
    ].join("\n");
    if (st) {
      // 旧版本可能已经插过样式：直接覆盖，别让上一版的胶囊背景留在页面上
      if (st.textContent !== css) st.textContent = css;
      return;
    }
    st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 主题探测（不依赖 ZCode 的类名） ---------- */
  function isDark() {
    // 1) 显式属性
    var de = document.documentElement;
    var attr = (de.getAttribute("data-theme") || de.getAttribute("data-color-scheme") || "").toLowerCase();
    if (attr.indexOf("dark") !== -1) return true;
    if (attr.indexOf("light") !== -1) return false;
    if (de.classList && (de.classList.contains("dark") || de.classList.contains("theme-dark"))) return true;
    if (de.classList && (de.classList.contains("light") || de.classList.contains("theme-light"))) return false;
    // 2) 实测 body 背景亮度 —— 对 ZCode 改主题实现免疫
    try {
      var b = document.body;
      if (b) {
        var bg = getComputedStyle(b).backgroundColor;
        var m = bg && bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          var p = m[1].split(",").map(function (x) { return parseFloat(x); });
          var a = p.length > 3 ? p[3] : 1;
          if (a > 0.4) return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 128;
        }
      }
    } catch (e) { /* ignore */ }
    // 3) 系统偏好
    try { return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { return false; }
  }

  function syncTheme() {
    var dark = isDark();
    document.documentElement.classList.toggle("zcsb-dark", dark);
  }

  /* ---------- 找输入框卡片的底边（不依赖类名） ---------- */
  /* 从「可编辑元素」往上走，走到那个还没有贴到窗口底部的面板为止。
     ZCode 的输入框卡片底边 = 919，它的包裹层底边 = 935（刚好是窗口底），
     所以「最后一个 bottom < 窗口高」的祖先就是卡片本身。返回 null 表示没找到。 */
  function composerBottom() {
    var b = composerBox();
    return b ? b.bottom : null;
  }

  /* 找不到输入框就返回 null；否则给出「输入框卡片」的下边界和右边界。
     right 用来把条对到输入框右端，这样它是在输入框正下方，而不是跑到窗口右下角。 */
  /* 「输入框卡片」＝编辑器外面那层**画了底/圆角**的盒子。这是 ZCode 真正用来包输入框的容器，
     不靠内部类名、不靠几何巧合，只看计算出来的漆：有实底背景，或者有圆角，而且高度是
     「一行输入框那一块」（<400px），不是整页容器。3.11.2 / 3.14.3 实测都只有一个这样的祖先，
     并且两版的位置、圆角、底色完全一致（README v21 段有实测数据）。 */
  function isPaintedCard(el, h) {
    if (!el || !h || h > 400) return false;
    var cs;
    try { cs = window.getComputedStyle(el); } catch (e) { return false; }
    if (!cs) return false;
    var rad = parseFloat(cs.borderTopLeftRadius || "0");
    if (rad > 0) return true;
    var m = /^rgba?\(([^)]+)\)$/.exec(cs.backgroundColor || "");
    if (!m) return false;
    var parts = m[1].split(",");
    var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    return !(a === 0);
  }

  function composerBox() {
    var eds, best = null, i;
    try {
      eds = document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""]');
    } catch (e) { return null; }
    for (i = 0; i < eds.length; i++) {
      var e = eds[i], r, vh;
      try { r = e.getBoundingClientRect(); } catch (err) { continue; }
      vh = window.innerHeight || 0;
      if (!r || !vh) continue;
      if (r.width < 60 || r.height < 6) continue;
      if (r.bottom <= 0 || r.top >= vh) continue;   // 不可见
      var b = r.bottom, right = r.right, p = e.parentElement, n = 0, pinBottom = 0, edge = false, cardB = 0;
      while (p && p !== document.body && p !== document.documentElement && n < 14) {
        var pr;
        try { pr = p.getBoundingClientRect(); } catch (err2) { break; }
        if (!pr.height || pr.width < r.width * 0.5) break;   // 已经跨到别块面板了
        if (pr.bottom >= vh - PIN_SLACK) { pinBottom = pr.bottom; break; }   // 到了贴底的包裹层，停
        /* v21：撞上画了底的输入框卡片，就**到此为止**。
           卡片底边就是权威答案，再往上走的每一层都是布局脚手架，它们的底边不属于输入框。
           3.11.2 里走上去正好撞到「贴住窗口底」的包裹层、提前 break，所以老代码没错；
           3.14.3 把会话栏往下垫了 4.1px，那层停在 930.9（窗口 935），贴底判定不再成立，
           于是老代码继续往上走、把 930.9 当成了卡片底边 —— 凭空多出 16px，条就被算成没地方放。
           改成认卡片之后，两版都返回卡片自己的底边（904.57 / 914.91）。 */
        if (isPaintedCard(p, pr.height)) {
          cardB = pr.bottom;
          if (pr.bottom > b) { b = pr.bottom; right = pr.right; }
          break;
        }
        // 再上一道保险：如果某一层已经比输入框本身高得多，那它是整块面板而不是卡片
        // （实测窄窗口下会走到一个高 15090px 的整页容器，它的底边绝不是卡片底边）。
        if (pr.height > Math.max(r.height * 8, 260)) break;
        // 「找到了卡片下沿」＝某一层的底边比输入框自己的底边明显更靠下（卡片留白/底部按钮排）。
        if (pr.bottom > r.bottom + 4) edge = true;
        if (pr.bottom > b) { b = pr.bottom; right = pr.right; }
        p = p.parentElement; n++;
      }
      /* v20：一层都没找到「比输入框更靠下的下沿」，说明输入框就坐在一个贴底的容器里，
         那个容器本身就是卡片（底边 935.6 = 窗口底）。这时绝不能拿输入框自己的底边
         冒充卡片底边 —— 那会凭空算出 71px 空地，把条摆进卡片内部、盖住底部按钮排。
         按那个贴底容器的底边算，空间为 0，layout() 会老实把整条藏起来。 */
      if (!edge && !cardB && pinBottom) b = pinBottom;
      if (best === null || b > best.bottom) best = { bottom: b, right: right };
    }
    return best;
  }

  /* ---------- 把输入框抬上去一点，给条腾出舒服的空隙 ---------- */
  /* ZCode 的输入框卡片底下只有 16px，塞一条 13px 的字进去太挤。
     所以找到「贴住窗口底、靠内边距留白」的那个包裹层，把它的 padding-bottom
     加厚，输入框就整体上移，底下自然出现一条宽松的空隙。
     这是页面内的运行时样式，可逆，也不改 ZCode 的任何文件。 */
  var hostEl = null;        // 被我们调过内边距的包裹层
  var hostBasePad = null;   // 它原本的 padding-bottom
  var hostTouched = false;  // 是否真的写过内联样式
  var rejectedEl = null;    // 加过内边距但卡片没动 → 这层选错了，别再选它
  var rejectedAt = null;    // 否决时的卡片底边（布局一动就自动解除否决）

  /* cb 是当前输入框卡片的底边。wrap 必须是「贴着窗口底、又只包住输入框那一小块」的
     容器。ZCode 在设置页 / 开着终端时，输入框并不在窗口底部（比如底边 618 / 窗口 935），
     这时从它往上走第一个贴底祖先会是整页容器（高 935），给整页加内边距毫无意义还会挤压内容。
     所以要额外满足：容器高度不能比「窗口底 - 输入框底」大太多。 */
  /* 「贴住窗口底」的容差必须小（PIN_SLACK=2），这里有个真实踩过的坑：
     只有底边真的落在窗口底上的那一层，给它加 padding-bottom 才会把输入框卡片**
     整体抬起来**。底边悬在窗口中间（比如卡片自己，底边 919 / 窗口 935）的那一层，
     加内边距只是把它自己往上撑高，卡片下沿纹丝不动 —— 于是 padded 显示 1，
     看上去「腾到了地方」，实际底下还是只有 16px，条照样压住输入框。
     v18 的第一版就是把容差放到 40px「防抖动」，正好选到了卡片自己，踩了这个坑。
     所以：容差保持 2px；选错了靠 reserveRoom 里的自检兜底。 */
  /* v21：「贴住窗口底」的容差分两个用途，别再共用一个常量。
     - 探测卡片底边（composerBox）：仍然认 PIN_SLACK=2，越紧越好；
     - 挑「加内边距的那一层」（这里）：要容得下 ZCode 自己把会话栏往下垫的那点余量。
       3.14.3 实测那层停在 930.9（窗口 935）＝差 4.1px，PIN_SLACK=2 挑不到它，
       于是 padded 一直是 0；把它放到 PIN_TOL=8 就够了，而卡片底边在 3.14.3 是 914.91
       （差 20.09）、在 3.11.2 是 904.57（差 30.4），都远在 8px 之外 ——
       所以放宽到 8 仍然不会误选卡片本身，另外还显式排掉「画了底的卡片」。
     选错的代价由 reserveRoom 里的 space2 自检兜底（量的是真空隙，不是代理量）。 */
  var PIN_TOL = 8;
  function findComposerWrap(cb) {
    var eds, i, vh = window.innerHeight || 0;
    var budget = (cb === null || cb === undefined) ? 0 : (vh - cb) + 220;
    try {
      eds = document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""]');
    } catch (e) { return null; }
    for (i = 0; i < eds.length; i++) {
      var e = eds[i], r;
      try { r = e.getBoundingClientRect(); } catch (err) { continue; }
      if (!r || !vh || r.width < 60 || r.height < 6) continue;
      if (r.bottom <= 0 || r.top >= vh) continue;   // 不可见
      var p = e.parentElement, n = 0;
      while (p && p !== document.body && p !== document.documentElement && n < 16) {
        var pr;
        try { pr = p.getBoundingClientRect(); } catch (err2) { break; }
        if (!pr.height || pr.width < r.width * 0.5) break;      // 跨到别块面板了
        if (pr.bottom >= vh - PIN_TOL && !isPaintedCard(p, pr.height)) {   // 贴住窗口底、且不是卡片自己
          if (!budget || pr.height > budget) break;              // 是整页容器，不是输入框包裹层
          return p;
        }
        p = p.parentElement; n++;
      }
    }
    return null;
  }

  function reserveRoom(el, cb) {
    if (hostEl && !document.body.contains(hostEl)) { hostEl = null; hostBasePad = null; hostTouched = false; }
    // 输入框不在窗口底部（设置页、终端面板展开、分栏）→ 没有可腾的空隙，一律还原
    var vh = vhNow();
    if (cb === null || cb === undefined || !vh || (vh - cb) > BOTTOM_ZONE) {
      releaseRoom();
      return;
    }
    // 否决是有时效的：布局一动（卡片底边挪了）就当没否决过，重新试一次，
    // 否则窗口从「坏状态」恢复之后条会永远不回来。
    if (rejectedEl && (rejectedAt === null || Math.abs(cb - rejectedAt) > 4)) {
      rejectedEl = null; rejectedAt = null;
    }
    if (!hostEl) {
      var w = findComposerWrap(cb);
      if (!w) return;                       // 没找到就别乱改，layout() 会走收字号那条路
      if (w === rejectedEl) return;         // 这层试过、没用 → 交给 layout() 走「藏起来」
      hostEl = w;
      // 守护进程重启 / 覆盖层重装时，页面上可能已经有我们上一版写下的内联值。
      // 所以把「原始内边距」记在 dataset 上，之后再读就以它为准，避免越加越厚。
      var kept = null;
      try { kept = w.dataset ? w.dataset.zcsbBasePad : null; } catch (e) { kept = null; }
      if (kept !== null && kept !== undefined && isFinite(parseFloat(kept))) {
        hostBasePad = parseFloat(kept);
      } else {
        hostBasePad = parseFloat(getComputedStyle(w).paddingBottom) || 0;
        try { if (w.dataset) w.dataset.zcsbBasePad = String(hostBasePad); } catch (e) { /* ignore */ }
      }
    }
    // 想要的空隙总高 = 间隙 + 条高 + 离窗口底的余量（再留 2px 余量：
    // 卡片底边常带小数，卡着整数要地方会让字号被舍掉一整级）。
    // 这里固定用 BASE_FS 算，不看 el 当前字号：否则「收字号 → 少腾地方 → 更挤」会互相追着跑。
    var h = Math.ceil(BASE_FS * 1.15);
    var want = GAP + h + TAIL + 2;
    // 只加不减：ZCode 自己留得比我们想要的还宽，就听它的
    var target = Math.max(hostBasePad, Math.min(hostBasePad + MAX_LIFT, want));
    var now = parseFloat(getComputedStyle(hostEl).paddingBottom) || 0;
    if (Math.abs(now - target) > 0.5) {
      hostEl.style.paddingBottom = target + "px";
      hostTouched = true;
      /* 自检（v18 加、v20 改成量空隙）：写完内边距，底下必须真的多出一块放得下条的空隙。
         以前比的是「卡片底边有没有往上走」（cb - b2.bottom）—— 这一条会被选错容器骗过去：
         内边距加在卡片自己身上时，输入框会跟着往上挪，差值照样很大，可是卡片下沿纹丝没动，
         底下还是没地方（实测 padded=1、空间却是负的，条落在卡片里面）。
         现在直接量「窗口底 - 卡片底边」，和 layout() 用的是同一个数、同一把尺。
         这也是「选容器」唯一可靠的判据：不猜结构，只看地方出没出来。 */
      var b2 = composerBox();
      var need = GAP + Math.ceil(BASE_FS * 1.15) + MIN_BOTTOM;
      var space2 = (b2 && isFinite(b2.bottom)) ? (vhNow() - b2.bottom) : -1;
      if (space2 + 0.5 < need) {
        try { hostEl.style.paddingBottom = ""; } catch (e) { /* ignore */ }
        try { if (hostEl.dataset) delete hostEl.dataset.zcsbBasePad; } catch (e) { /* ignore */ }
        rejectedEl = hostEl; rejectedAt = cb;
        hostEl = null; hostBasePad = null; hostTouched = false;
      }
    }
  }

  function releaseRoom() {
    if (hostEl) {
      try { hostEl.style.paddingBottom = ""; } catch (e) { /* ignore */ }
      try { if (hostEl.dataset) delete hostEl.dataset.zcsbBasePad; } catch (e) { /* ignore */ }
    }
    hostEl = null; hostBasePad = null; hostTouched = false;
  }

  /* ---------- 摆放：塞进输入框正下方那条空隙 ---------- */
  var BASE_FS = 13;      // 目标字号（比之前大 2px，远看也认得出）
  var MIN_FS = 11;       // 空隙实在不够时才收字号，但不再缩到看不清
  var GAP = 6;           // 条顶边离输入框卡片的底边
  var TAIL = 8;          // 条底边距离窗口底要留的余量（腾空隙时按这个算）
  var MIN_BOTTOM = 3;    // 条底边至少离窗口底这么远
  var MIN_RIGHT = 5;     // 贴右时至少留这么宽
  var BAR_BOTTOM = 8;    // 极端时序下（两次探测之间输入框刚好挪走）才用到的兜底位置
  var MAX_LIFT = 28;     // 最多把输入框抬高多少（防止在陌生布局上乱改）
  var BOTTOM_ZONE = 160; // 输入框卡片底边离窗口底超过这个距离，就认为它不在底部（设置页/终端页），不腾空隙
  // 「往上走时怎么算『贴住窗口底了』」的容差。本来写的是 0.5px，实测会把条摆歪（见 README v14）：
  // 窗口拖窄后包裹层底边是 934.385 / 视口 935，差 0.615px —— 差一点点就判不出「贴底」，
  // 于是往上多走一层，把包裹层的底边/右端当成了输入框卡片的（右端差 16px、底边差 30px）。
  // 而且这个小数每次量都可能变，判定就来回翻：条一会儿对一会儿歪、内边距一会儿有一会儿没。
  var PIN_SLACK = 2;     // 2px 足够覆盖亚像素抖动，又不会把「真的没贴底」误判成贴底

  function vhNow() { return window.innerHeight || 0; }

  /* 「现在是不是在工作区里对着输入框」的唯一判据：输入框贴不贴窗口底。
     欢迎页 / 项目列表 / 新建任务页的输入框在窗口中间（实测卡片底边 632、窗口 935，
     差 303px），终端面板展开、设置页盖层也一样不贴底。条的全部意义就是贴在输入框
     正下方，没有贴底的输入框时它只能缩在窗口角上挡东西 —— 那就整条不显示（v11）。 */
  function composerAnchored() {
    var b = composerBox(), vh = vhNow();
    return !!(b && vh && (vh - b.bottom) <= BOTTOM_ZONE);
  }

  /* 距离上一次推送多久算「注入器没了」。lastSeen 在脚本末尾才赋值，
     这里用 NaN 比较得 false 兜住「还没赋上」的瞬间。 */
  function staleNow() { return Date.now() - lastSeen > STALE_MS; }

  /* 条的右端 = 窗口宽 - 输入框卡片右端。这样条压在输入框正下方，而不是窗口右下角。
     box 为 null（没探到输入框）时退回右贴边。
     这里**故意允许算出负数**：窗口比 ZCode 自己的布局还窄时，输入框右端本来就在
     视口外面（实测 520px 窗口里输入框右端在 550），条跟着它对、跟着它一起被切，
     好过滑到屏幕左边去 —— 那会让「本问」那段先被吃掉（v16 之前就是这样）。 */
  function alignRight(box, vw) {
    if (!box || !vw) return MIN_RIGHT;
    var r = vw - box.right;
    if (!isFinite(r)) return MIN_RIGHT;
    return Math.round(r);
  }

  /* ---------- 判断「现在不在工作区」 ---------- */
  /* 设置页不是「另一个页面」，而是一层盖满窗口的浮层：工作区的 DOM 还在底下活着，
     连输入框元素都还在（实测设置页里的 contenteditable 依然有 rect），所以
     「探不到输入框」这种信号根本判不出来。ZCode 给设置页留了 data-testid ——
     这是人写的稳定钩子，不是 hash 过的类名。三个信号任一成立即视为在设置里；
     万一以后 ZCode 把它们改名了，退化结果只是「设置页里又会显示出来」，
     不会影响工作区，也不会碰坏任何别的东西。 */
  function isShown(el) {
    if (!el) return false;
    try {
      if (el.hasAttribute && el.hasAttribute("hidden")) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      // 设置页是满屏盖层：占不到大半个窗口就不算（避免动画、过渡态误判）
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      return r.width >= vw * 0.5 && r.height >= vh * 0.5;
    } catch (e) { return false; }
  }

  function settingsOpen() {
    try {
      if (isShown(document.querySelector('[data-testid="settings-page"]'))) return true;
      if (isShown(document.querySelector('[data-testid="settings-back-button"]'))) return true;
      // 兜底：设置页左侧的分区导航（常规/外观/模型设置/…）一次会渲染十几个
      if (document.querySelectorAll('[data-testid^="settings-section-nav-"]').length >= 3) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* 藏 / 显示。统一走 class，这样 ensure() 重建节点、看门狗、心跳三条路径
     都以 layout() 的判定为准，不会各说各话（v9 前就是栽在「只有一条路径会加
     class」上）。 */
  function setHidden(el, on) {
    if (on && tipOn) { tipOn = false; hideTip(); }   // 条藏起来的同时把悬浮卡片收掉
    if (!el || !el.classList) return;
    if (on) { if (!el.classList.contains("zcsb-hidden")) el.classList.add("zcsb-hidden"); }
    else if (el.classList.contains("zcsb-hidden")) el.classList.remove("zcsb-hidden");
  }

  function layout(el) {
    if (!el) return;
    // 注入器已经没了（超时没推送）→ 别再占着输入框的位置。
    // 心跳每 3s 会调到这里一次，所以这一步必须自己会看门，不能只靠看门狗那一次 releaseRoom()。
    if (staleNow()) { releaseRoom(); return; }
    // 设置页（盖满窗口的那层）里不显示：用户要的是「只在工作区显示」。
    // 同时把输入框的空隙还回去 —— 底下那层反正是被盖住的，没必要继续为它让位。
    if (settingsOpen()) { setHidden(el, true); releaseRoom(); return; }
    var vh = vhNow(), vw = window.innerWidth || 0;
    // 欢迎页 / 项目列表 / 新建任务页：输入框在窗口中间，没有「输入框正下方」这条位置，
    // 藏掉整条，顺手把之前为它腾的空隙还回去（v11）。判据只看输入框贴不贴底。
    if (!composerAnchored()) { setHidden(el, true); releaseRoom(); return; }
    setHidden(el, false);
    var box0 = composerBox();          // 先按「还没抬过」的位置量
    reserveRoom(el, box0 ? box0.bottom : null);   // 再腾地方
    var box = composerBox();           // 腾完重新量，用新位置算字号和摆位
    var fs = BASE_FS, h = Math.ceil(fs * 1.15);
    var bottomPx = BAR_BOTTOM, rightPx = MIN_RIGHT;
    var anchored = !!(box && vh && (vh - box.bottom) <= BOTTOM_ZONE);
    if (anchored) {
      var space = vh - box.bottom;     // 输入框底边到窗口底还有多少地方
      // 行高 1.15，条高 ≈ ceil(fs*1.15)；万一腾不出地方，就收字号，绝不压住输入框
      while (fs > MIN_FS && (GAP + h + TAIL) > space) { fs--; h = Math.ceil(fs * 1.15); }
      // 最后一道闸：连最小字号都塞不进去（腾空隙失败、或两次探测之间布局突变），
      // 说明这条现在无论如何都会压住输入框。用户要的就是「在输入框正下方」，
      // 「压住输入框」比「暂时不显示」更糟 —— 整条藏起来，等下一拍再试（v18）。
      if ((GAP + h + MIN_BOTTOM) > space) { setHidden(el, true); return; }
      bottomPx = Math.max(MIN_BOTTOM, Math.round(space - GAP - h));
      rightPx = alignRight(box, vw);
      // 对齐优先。只有当条被这么一摆、左端要出屏幕时才往右收 —— 收的判据是「左端」
      // 而不是「右端」，因为条右端偶尔跑到视口外只是跟着输入框一起被切，
      // 而左端跑出去等于「本问」那段直接看不见。条比窗口还宽时这条会算出更负的值，
      // 于是左端稳稳停在 MIN_RIGHT 上（v16）。
      var bw = 0;
      try { bw = Math.round(el.getBoundingClientRect().width) || 0; } catch (e) { bw = 0; }
      if (bw > 0 && vw && (vw - rightPx - bw) < MIN_RIGHT) rightPx = vw - bw - MIN_RIGHT;
    } else {
      // 兜底：只在「刚判定贴底、腾地方这两行之间输入框又挪走」这种瞬间才走得到
      // （下一次心跳就会转成隐藏）。这里先按窗口右下角摆一下，至少不压输入框。
      if (el.style.fontSize !== BASE_FS + "px") el.style.fontSize = BASE_FS + "px";
    }
    if (el.style.fontSize !== fs + "px") el.style.fontSize = fs + "px";
    if (el.style.bottom !== bottomPx + "px") el.style.bottom = bottomPx + "px";
    if (el.style.right !== rightPx + "px") el.style.right = rightPx + "px";
  }

  /* ---------- 图标（内联 SVG，无外部资源） ---------- */
  function svg(inner, cls) {
    return '<svg class="zcsb-ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + inner + "</svg>";
  }
  var ICO_GAUGE_INNER = '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>';
  var ICO_GAUGE = svg(ICO_GAUGE_INNER);
  /* 本问正在跑的时候让它转起来：说明这一轮还没结束，数字还会往上长 */
  var ICO_GAUGE_SPIN = svg(ICO_GAUGE_INNER, "zcsb-spin");
  var ICO_DB = svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13"/><path d="M19.5 12c0 1.66-3.36 3-7.5 3s-7.5-1.34-7.5-3"/>');

  /* ---------- 数字格式化 ---------- */
  function fmtTokens(n) {
    if (!isFinite(n) || n <= 0) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(n / 1e9 >= 10 ? 0 : 1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(n / 1e6 >= 10 ? 0 : 1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n / 1e3 >= 10 ? 0 : 1) + "k";
    return String(Math.round(n));
  }
  function fmtInt(n) {
    if (!isFinite(n) || n < 0) return "0";
    return String(Math.round(n));
  }
  /* 时长（悬浮卡片用）：<10s 给一位小数，<60s 取整秒，再往上给「N 分 M 秒」/「N 小时 M 分」。
     语义和 fmtTokens 一致——短的时候要精确，长的时候要一眼能读。 */
  function fmtDur(ms) {
    var s = (typeof ms === "number" && isFinite(ms) ? ms : 0) / 1000;
    if (!(s > 0)) return "0s";
    if (s < 10) return (Math.round(s * 10) / 10).toFixed(1) + "s";
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) { var mi = Math.floor(s / 60); return mi + " 分 " + Math.round(s - mi * 60) + " 秒"; }
    var h = Math.floor(s / 3600), m2 = Math.round((s - h * 3600) / 60);
    return h + " 小时 " + m2 + " 分";
  }
  /* 附注里的耗时沿用 v22 的老格式（一位小数秒），不随上面那套档位变，
     免得同一张卡片上出现「15.2s」和「15s」两种写法。 */
  function fmtSec1(ms) {
    return (Math.round((typeof ms === "number" && isFinite(ms) ? ms : 0) / 100) / 10).toFixed(1) + "s";
  }
  /* 新字段缺失（刷新后先按 localStorage 里的旧 payload 画）时显示 --，不拿 0 冒充 */
  function fmtMaybe(ms) {
    return typeof ms === "number" && isFinite(ms) ? fmtDur(ms) : "--";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 渲染 ---------- */
  function render(m) {
    var el = document.getElementById(BAR_ID);
    if (!el) return;
    // 重新有数据了 → 从「过期隐藏」状态恢复（并重新腾出空隙）
    if (el.classList.contains("zcsb-stale")) el.classList.remove("zcsb-stale");
    var idle = !m || !m.sessionId;
    el.classList.toggle("zcsb-idle", idle);

    if (idle) {
      el.innerHTML = ICO_GAUGE + '<span class="zcsb-mut">等待 ZCode 会话…</span>';
      layout(el);
      return;
    }

    var tps = m.tps > 0 ? fmtInt(m.tps) : "--";

    /* 本问（最近一轮）排在累计前面 —— 刚发完一问你最想看的就是这一轮的成绩。
       数字还没落盘（刚发出去、第一个请求还没回来）时给 -- 并转圈，而不是
       继续挂着上一轮的数字；轮次进行中数字会一段一段往上长。 */
    var head = "";
    if (m.hasTurn) {
      var t1 = m.turnTps > 0 ? fmtInt(m.turnTps) : "--";
      head =
        '<span class="zcsb-seg">' + (m.turnRunning ? ICO_GAUGE_SPIN : ICO_GAUGE) +
          '<span><span class="zcsb-mut">本问</span> <span class="zcsb-num">' + t1 + '</span> tok/s</span>' +
          '<span class="zcsb-mut">·</span>' +
          '<span><span class="zcsb-num">' + fmtTokens(m.turnOutputTokens) + '</span><span class="zcsb-mut"> tok</span></span>' +
        "</span>" +
        '<span class="zcsb-sep"></span>';
    } else {
      // 还没认出一轮（会话刚开）时，表头那个图标就留给累计
      head = "";
    }

    el.innerHTML =
      head +
      '<span class="zcsb-seg">' + (m.hasTurn ? "" : ICO_GAUGE) +
        '<span><span class="zcsb-mut">累计</span> <span class="zcsb-num">' + fmtInt(m.turns) + '</span> 轮 ' +
        '<span class="zcsb-num">' + fmtInt(m.steps) + '</span> 步</span>' +
        '<span class="zcsb-mut">·</span>' +
        '<span><span class="zcsb-num">' + tps + '</span> tok/s</span>' +
      "</span>" +
      '<span class="zcsb-sep"></span>' +
      '<span class="zcsb-seg">' + ICO_DB +
        '<span><span class="zcsb-num">' + fmtTokens(m.totalTokens) + '</span><span class="zcsb-mut"> tok</span></span>' +
      "</span>";

    /* 鼠标穿透，浏览器原生的 title 永远弹不出来；内容改由悬浮卡片展示
       （showTip，光标落进条里时出现）。之前把这段挂到 el.title 上是死代码。
       v23：卡片主体换成「会话统计」指标表，下面跟灰字附注。 */
    var rows = [
      ["模型用时", fmtMaybe(m.modelMs)],
      ["工具调用用时", fmtMaybe(m.toolMs)],
      ["首 token 平均（TTFT）", fmtMaybe(m.ttftAvgMs)],
      ["输出速度（TPS）", m.tps > 0 ? fmtInt(m.tps) + " tok/s" : "--"],
      ["缓存命中", m.cacheHit == null ? "--" : Math.round(m.cacheHit) + "%"],
    ];
    var notes = [];
    if (m.title || m.sessionId) {
      notes.push("会话：" + (m.title || "(未命名)") + (m.sessionId ? "（" + m.sessionId + "）" : ""));
    }
    if (m.hasTurn) {
      notes.push("本问：" + (m.turnRunning ? "进行中" : (m.turnStatus || "?")) +
        "，主轮输出 " + fmtInt(m.turnOutputTokens) + " tok / " + fmtInt(m.turnRequests) + " 个请求 / " +
        fmtInt(m.turnToolCalls) + " 次工具 / 首字 " + fmtSec1(m.turnTtftMs) + " / " +
        "总耗时 " + fmtSec1(m.turnDurationMs));
      /* 上下文压缩的输出不算进本问 tok/s（它不是模型在回答你，是 ZCode 自己在
         总结旧上下文）。条上只放主轮口径，保证「X tok/s · Y tok」两个数能互相对上；
         压缩那部分在这里说明白，不让人以为数漏了。 */
      if (m.turnCompactTokens > 0) {
        notes.push("本问：本轮合计 " + fmtTokens(m.turnTotalOutputTokens) + " tok，" +
          "其中上下文压缩 " + fmtTokens(m.turnCompactTokens) + " tok（不计入上面的 tok/s）");
      }
    }
    notes.push("累计：" + fmtInt(m.turns) + " 轮 " + fmtInt(m.steps) + " 步 · 工具 " +
      fmtInt(m.toolCalls) + " 次 · 输入 " + fmtTokens(m.inputTokens) + " / 输出 " +
      fmtTokens(m.outputTokens) + " tok · 合计 " + fmtTokens(m.totalTokens) + " tok");
    lastTip = { rows: rows, notes: notes };
    if (tipOn) showTip();

    layout(el);
  }

  /* ---------- 悬浮统计卡片 ----------
     条是 pointer-events:none 的（永远不挡 ZCode 自己的按钮），所以浏览器原生的
     title 提示永远弹不出来。这里改由页面监听 mousemove：光标落进条的矩形时弹出
     一张自绘小卡片，移开就收起；卡片同样 pointer-events:none，只展示不拦截。

     v23：卡片内容是「会话统计」面板——标题 + 五行指标（左标签右数值）+ 灰字附注。
     数值由注入器算好推过来，这里只负责画，不自己查库。 */
  function positionTip(t) {
    var el = document.getElementById(BAR_ID);
    if (!el) return;
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || 0;
    // 先归零再量宽：上一次定位可能把卡片右缘顶到视口外，量出来的宽度会失真
    t.style.left = "0px";
    t.style.top = "0px";
    t.style.left = Math.round(Math.max(4, Math.min(r.left, vw - t.offsetWidth - 6))) + "px";
    t.style.top = Math.max(4, Math.round(r.top - t.offsetHeight - 8)) + "px";
  }
  function showTip() {
    var t = tipEl();
    if (!t || !lastTip) return;
    var html = '<div class="zcsb-tip-h">' + esc(TIP_TITLE) + "</div>";
    var rows = lastTip.rows || [];
    if (rows.length) {
      html += '<div class="zcsb-tip-g">';
      for (var i = 0; i < rows.length; i++) {
        html += '<span class="zcsb-tip-l">' + esc(rows[i][0]) + "</span>" +
                '<span class="zcsb-tip-v">' + esc(rows[i][1]) + "</span>";
      }
      html += "</div>";
    }
    var notes = lastTip.notes || [];
    for (var j = 0; j < notes.length; j++) {
      html += '<div class="zcsb-tip-n">' + esc(notes[j]) + "</div>";
    }
    t.innerHTML = html;
    t.style.display = "block";
    positionTip(t);
  }
  function hideTip() {
    var t = document.getElementById(TIP_ID);
    if (t) t.style.display = "none";
  }
  function tipEl() {
    var t = document.getElementById(TIP_ID);
    if (!t && document.body) {
      t = document.createElement("div");
      t.id = TIP_ID;
      t.setAttribute("role", "tooltip");
      document.body.appendChild(t);
    }
    return t;
  }
  function onSbMouseMove(e) {
    var el = document.getElementById(BAR_ID);
    var want = false;
    if (el && lastTip &&
        !el.classList.contains("zcsb-stale") && !el.classList.contains("zcsb-hidden")) {
      var r = el.getBoundingClientRect();
      want = r.width > 0 && e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
             e.clientY >= r.top - 3 && e.clientY <= r.bottom + 2;
    }
    if (want) {
      if (!tipOn) { tipOn = true; showTip(); }
      else { var t = tipEl(); if (t) positionTip(t); }   // 条挪了/内容换了就跟着挪
    } else if (tipOn) {
      tipOn = false;
      hideTip();
    }
  }

  /* ---------- 挂载 / 自愈 ---------- */
  function ensure() {
    var host = document.body || document.documentElement;
    if (!host) return null;
    installStyle();
    syncTheme();
    var el = document.getElementById(BAR_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BAR_ID;
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "off");
      host.appendChild(el);
      render(last);
    } else if (el.parentNode !== host) {
      // 文档刚解析完时可能先挂在了 documentElement 上，等 body 出现再挪过去
      host.appendChild(el);
    }
    return el;
  }

  ensure();

  /* 自举：Page.addScriptToEvaluateOnNewDocument 在文档还几乎空白时就执行，
     那一刻 documentElement / body 都可能还不存在，第一次 ensure() 会落空；
     而抢在解析完成前挂上的节点也可能被解析器整理掉。
     这里在页面刚起来的那几秒里补齐一次，不必等守护进程下一次推送。 */
  try {
    var bootN = 0;
    var boot = setInterval(function () {
      bootN++;
      var el = ensure();
      if (el) layout(el);
      if ((el && el.parentNode === document.body) || bootN > 100) clearInterval(boot);
    }, 40);
  } catch (e) { /* ignore */ }

  // ZCode 是 React 应用，route 切换可能替换 body 子树；把节点找回来。
  try {
    var mo = new MutationObserver(function () {
      if (!document.getElementById(BAR_ID)) ensure();
    });
    mo.observe(document.documentElement, { childList: true, subtree: false });
  } catch (e) { /* ignore */ }

  // 主题可能随时切换；窗口大小 / 输入框长高也会改变可用空隙
  try {
    if (window.matchMedia) {
      var mq = matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", syncTheme);
    }
  } catch (e) { /* ignore */ }
  /* ---------- 反应速度：交互后立刻复核 ----------
     React 换页面时我们收不到任何通知，只能猜「什么时候该重新量一次」。
     实测切换动作全都由鼠标/键盘引发（返回、点会话、开设置、Ctrl+N），
     所以一有交互就开一个「连算一小会儿」的窗口：窗口期内每 40ms 重算一次，
     覆盖 React 提交、卡片高度动画、路由落地这些时间点。
     每次交互只是把窗口往后推（而不是被上一次窗口挡住）——早先写成
     「一批没跑完就丢弃新的踢脚」，结果连点两下时第二下被吞掉，
     又退回到 1~2s 的推送节奏上，手感依旧钝。 */
  var BURST_MS = 1200;      // 一次交互后持续复核多久
  var BURST_STEP = 40;      // 复核间隔（约 25 次/秒，只在窗口期内）
  var burstUntil = 0;
  var burstTimer = null;
  function burstTick() {
    burstTimer = null;
    var el = document.getElementById(BAR_ID);
    if (!el) { ensure(); }
    else if (staleNow()) { markStale(el); }
    else { layout(el); }
    if (Date.now() < burstUntil) {
      burstTimer = setTimeout(burstTick, BURST_STEP);
    }
  }
  function kick() {
    // 交互是「注意力落在窗口上」的信号，顺手也复核一下主题
    syncTheme();
    burstUntil = Date.now() + BURST_MS;
    if (burstTimer === null) {
      // 不在这里同步 layout()：capture 阶段我们的监听器跑在 React 之前，
      // 此刻 DOM 还没换，量出来的还是旧页面。延后一个任务，等 React 提交完。
      burstTimer = setTimeout(burstTick, 0);
    }
  }
  function clearKick() {
    if (burstTimer !== null) { try { clearTimeout(burstTimer); } catch (e) { /* ignore */ } }
    burstTimer = null;
    burstUntil = 0;
  }
  function onKick() { kick(); }
  /* 路由变化也踢一脚。ZCode 是 SPA，多半走 history.pushState（不触发 popstate），
     所以顺手把它包一层；包装保持原样调用，出错也只吞掉我们自己的那一脚。 */
  var origPush = null, origReplace = null;
  try {
    if (window.history && typeof window.history.pushState === "function") {
      origPush = window.history.pushState;
      origReplace = window.history.replaceState;
      window.history.pushState = function () {
        var r = origPush.apply(this, arguments);
        try { kick(); } catch (e) { /* ignore */ }
        return r;
      };
      window.history.replaceState = function () {
        var r = origReplace.apply(this, arguments);
        try { kick(); } catch (e) { /* ignore */ }
        return r;
      };
    }
  } catch (e) { /* ignore */ }
  try {
    document.addEventListener("click", onKick, true);
    document.addEventListener("pointerdown", onKick, true);
    document.addEventListener("keydown", onKick, true);
    document.addEventListener("mousemove", onSbMouseMove);
    window.addEventListener("popstate", onKick);
    window.addEventListener("hashchange", onKick);
    document.addEventListener("visibilitychange", onKick);
    window.addEventListener("focus", onKick);
  } catch (e) { /* ignore */ }

  // 兜底心跳：没有交互、也没有推送时的最后一道保险（v11 是 3000ms，太钝）
  var beat = setInterval(function () {
    syncTheme();
    var el = document.getElementById(BAR_ID);
    if (!el) { ensure(); return; }
    // 过期判据放在这里，而不是只放在看门狗那一个定时器里 ——
    // 之前踩过：React 换掉 body 子树后 ensure() 重建了条，class 留在旧节点上，
    // 看门狗又只在「第一次发现过期」时加 class，于是条带着过期数字又冒出来。
    if (staleNow()) { markStale(el); return; }
    layout(el);
  }, 500);

  /* ---------- 过期看门狗 ----------
     注入器被杀掉 / 崩掉时不会有任何「再见」消息，条上的数字会一直停在那里骗人，
     输入框也被白白抬高。这里盯着最后一次推送的时间，超时就自己藏起来、
     顺便把输入框还原；注入器回来后 update() 会立刻把它恢复。 */
  var lastSeen = Date.now();
  var STALE_MS = 15000;
  function markStale(el) {
    if (el && !el.classList.contains("zcsb-stale")) el.classList.add("zcsb-stale");
    if (tipOn) { tipOn = false; hideTip(); }    // 过期数字的说明也一起收掉
    releaseRoom();              // 注入器都没了，输入框不该继续为我们让位
  }
  var watch = setInterval(function () {
    if (!staleNow()) return;
    markStale(document.getElementById(BAR_ID));
  }, 4000);
  try {
    window.addEventListener("resize", function () {
      var el = document.getElementById(BAR_ID);
      if (el) layout(el);
    });
  } catch (e) { /* ignore */ }
  window.__zcodeSB = {
    version: VERSION,
    /* 立刻按当前页面状态重算一次（交互踢脚用的就是它） */
    kick: function () { kick(); return true; },
    update: function (m) {
      last = m || null;
      lastSeen = Date.now();
      saveCache(last);
      ensure();
      render(last);
      var el = document.getElementById(BAR_ID);
      if (el) layout(el);     // 从过期状态回来时，立刻把输入框重新抬上去，不用等下一次心跳
      return true;
    },
    /* 调试/自检用：当前条的位置与它下面那段空隙 */
    probe: function () {
      var el = document.getElementById(BAR_ID);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var box = composerBox();
      return {
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), width: Math.round(r.width) },
        composerBottom: composerBottom(),
        composerRight: box ? Math.round(box.right) : null,   // 条应该对到这个右边界上
        viewportH: window.innerHeight,
        viewportW: window.innerWidth,
        fontSize: el.style.fontSize || "",
        wrapPadBottom: hostEl && hostEl.isConnected ? (Math.round((parseFloat(getComputedStyle(hostEl).paddingBottom) || 0) * 10) / 10) : null,
        wrapPadBase: hostBasePad,
        // 页面上还留着我们内联内边距的元素个数（正常只能是 0 或 1）
        padded: document.querySelectorAll("[data-zcsb-base-pad]").length,
        stale: el.classList.contains("zcsb-stale"),
        hidden: el.classList.contains("zcsb-hidden"),   // 不在工作区（设置页 / 欢迎页）为 true
        inSettings: settingsOpen(),
        anchored: composerAnchored(),                   // 输入框贴底 = 在工作区
        hasLast: !!last,
        sincePushMs: Date.now() - lastSeen
      };
    },
    remove: function () {
      try { clearInterval(beat); } catch (e) { /* ignore */ }
      try { clearInterval(watch); } catch (e) { /* ignore */ }
      clearKick();
      // 监听器和被我们包过的 history 都要还回去，不然新版本会和我们抢着算
      try {
        document.removeEventListener("click", onKick, true);
        document.removeEventListener("pointerdown", onKick, true);
        document.removeEventListener("keydown", onKick, true);
        document.removeEventListener("mousemove", onSbMouseMove);
        window.removeEventListener("popstate", onKick);
        window.removeEventListener("hashchange", onKick);
        document.removeEventListener("visibilitychange", onKick);
        window.removeEventListener("focus", onKick);
      } catch (e) { /* ignore */ }
      try {
        if (origPush) window.history.pushState = origPush;
        if (origReplace) window.history.replaceState = origReplace;
      } catch (e) { /* ignore */ }
      var el = document.getElementById(BAR_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      var tp = document.getElementById(TIP_ID);
      if (tp && tp.parentNode) tp.parentNode.removeChild(tp);
      releaseRoom();          // 把输入框的内边距还原，别留下我们改过的痕迹
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
      try { delete window.__zcodeSB; } catch (e) { window.__zcodeSB = undefined; }
      try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
      return true;
    }
  };
})();
