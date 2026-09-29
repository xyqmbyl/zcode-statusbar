#!/usr/bin/env node
/*
 * zcode-statusbar.mjs —— 把 DSH 风格的底部数据统计条注入 ZCode（Z.ai Agentic Development Environment）
 *
 * 为什么这样设计（「一直适配」的关键）：
 *   · 完全不修改 app.asar。ZCode 每次更新都会整个覆盖 resources/app.asar，
 *     而渲染层 chunk 名是内容哈希（如 IntlProvider-Db46X9QF.js）+ 压缩混淆，
 *     所以打补丁 = 每次更新都要重做，且改坏就没法启动。
 *   · 走 Electron/Chromium 官方调试协议（CDP）。ZCode 是打包 Electron 应用，
 *     代码里没有任何地方剥离 --remote-debugging-port，所以启动时传该开关即可生效。
 *   · 指标不从页面 DOM 里猜，而是直接读 ZCode 自己落盘的 SQLite 统计表；
 *     页面侧只负责画一个 fixed 定位的浮层，不认识任何 ZCode 类名/结构。
 *   · SQL 按实际列自适应拼接 —— 即使 ZCode 以后加/减列也不会直接崩。
 *
 * 用法：
 *   node zcode-statusbar.mjs               # 连接 ZCode 并注入（常驻）
 *   node zcode-statusbar.mjs --print       # 只打印当前指标，不注入（自检）
 *   node zcode-statusbar.mjs --port 9222 --interval 1200
 *
 * 依赖：Node >= 22（用到 node:sqlite 与全局 WebSocket），无第三方包。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node:sqlite 仍会发 ExperimentalWarning，这里只压掉这一条
process.on("warning", (w) => {
  if (w && w.name === "ExperimentalWarning" && /SQLite/i.test(String(w.message))) return;
  process.emitWarning ? console.warn(w.name + ": " + w.message) : null;
});

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error("需要 Node 22+ 才能使用内置 node:sqlite。当前版本：" + process.version);
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZCODE_HOME = process.env.ZCSB_ZCODE_HOME || path.join(os.homedir(), ".zcode");
const DB_PATH = process.env.ZCSB_DB || path.join(ZCODE_HOME, "cli", "db", "db.sqlite");

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const hit = argv.find((a) => a === name || a.startsWith(name + "="));
  if (!hit) return dflt;
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const i = argv.indexOf(hit);
  return argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
}
const OPTS = {
  port: Number(argOf("--port", process.env.ZCSB_PORT || 9222)),
  interval: Number(argOf("--interval", process.env.ZCSB_INTERVAL || 1200)),
  print: !!argOf("--print", false),
  quiet: !!argOf("--quiet", false),
  session: argOf("--session", null),
};

const ts = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
// log：啰嗦的进度信息，--quiet 时静默。
const log = (...a) => { if (!OPTS.quiet) console.log(...a); };
// note：连接、注入、出错等关键事件，始终写入日志文件，便于事后排查。
const note = (...a) => { console.log("[" + ts() + "]", ...a); };

/* ============================================================
 *  一、数据库
 * ============================================================ */

let db = null;

function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error("找不到 ZCode 数据库：" + DB_PATH);
  try {
    return new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (e) {
    // WAL 模式下只读打开偶尔失败 —— 退化为快照副本
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zcsb-"));
    const base = path.basename(DB_PATH);
    for (const suf of ["", "-wal", "-shm"]) {
      const src = DB_PATH + suf;
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, base + suf));
    }
    return new DatabaseSync(path.join(dir, base), { readOnly: true });
  }
}

/* WAL 只读打开失败时留下的快照临时目录：进程退出不清理（database 还占着文件）。
   这里在启动时把超过一天的旧目录扫掉，免得反复重启守护进程后在 %TEMP% 里越积越多。 */
function sweepOldSnapshots() {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!/^zcsb-/.test(name)) continue;
      const dir = path.join(os.tmpdir(), name);
      try {
        if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) { /* 被别的进程占用就算了，下一轮再说 */ }
    }
  } catch (e) { /* ignore */ }
}

function getDb() {
  if (db) return db;
  db = openDb();
  return db;
}

/** 列名集合 —— 用于按 ZCode 实际 schema 自适应拼 SQL */
const _colsCache = new Map();
function cols(table) {
  if (_colsCache.has(table)) return _colsCache.get(table);
  let set = new Set();
  try {
    for (const r of getDb().prepare("PRAGMA table_info(" + table + ")").all()) set.add(r.name);
  } catch (e) { /* ignore */ }
  _colsCache.set(table, set);
  return set;
}
function has(table) {
  try {
    return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  } catch (e) { return false; }
}
/** 取 table 中第一个存在的列，都没有则返回 fallback 表达式 */
function col(table, candidates, fallback) {
  const c = cols(table);
  for (const n of candidates) if (c.has(n)) return n;
  return fallback;
}
const S = (t, c, d) => col(t, Array.isArray(c) ? c : [c], d || "0");

/* ============================================================
 *  二、指标计算
 * ============================================================ */

function resolveSessionId(hint) {
  if (hint) {
    try {
      // 支持传全名、sess_ 前缀或任意片段
      const r = getDb().prepare("SELECT id FROM session WHERE id = ? OR id LIKE ? ORDER BY time_updated DESC LIMIT 1")
        .get(hint, "%" + String(hint).replace(/^sess_/, "") + "%");
      if (r) return r.id;
    } catch (e) { /* ignore */ }
  }
  // 1) 优先有正在跑的轮次
  try {
    if (has("turn_usage")) {
      const r = getDb().prepare(
        "SELECT session_id AS id FROM turn_usage WHERE status='running' ORDER BY started_at DESC LIMIT 1"
      ).get();
      if (r && r.id) return r.id;
    }
  } catch (e) { /* ignore */ }
  // 2) 最近有活动的会话
  try {
    const order = cols("session").has("time_updated") ? "time_updated DESC" : "rowid DESC";
    const filt = cols("session").has("time_archived") ? "WHERE time_archived IS NULL" : "";
    const r = getDb().prepare("SELECT id FROM session " + filt + " ORDER BY " + order + " LIMIT 1").get();
    if (r && r.id) return r.id;
  } catch (e) { /* ignore */ }
  return null;
}

function readMetrics(sessionId) {
  const out = {
    sessionId: sessionId || null,
    title: null,
    turns: 0,
    steps: 0,
    toolCalls: 0,
    tps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cacheHit: null,
    running: false,
    /* --- v23「会话统计」面板：累计口径的时间类指标 ---
       modelMs 是「模型在处理这个会话上总共花了多久」，包含等首字的时间（那是排队+预填充，
       用户一样得等）；toolMs 是「工具跑的总时长」，两者互不重叠，但加起来不等于会话时长，
       因为还有解析、渲染、以及人自己想事情的时间。 */
    modelMs: 0,       // Σ model_usage.duration_ms（口径与 tps 相同的那些主轮请求）
    modelRequests: 0, // 参与上面求和的请求数
    ttftAvgMs: null,  // 平均首 token 等待；只统计真等到过首字的请求
    ttftCount: 0,     // 上面那个平均值的样本数（首字为 0/空的请求不算）
    toolMs: 0,        // Σ tool_usage.duration_ms
    toolUsages: 0,    // tool_usage 行数（与 turn_usage.tool_call_count 口径不同，仅作参考）
    /* --- 本问：最近一轮（见 readTurnMetrics） --- */
    hasTurn: false,
    turnId: null,
    turnStatus: null,
    turnRunning: false,     // 这一轮还没结束（或在等它落盘）→ 条上转圈
    turnPending: false,     // 用户刚发问，第一个请求还没完成，暂时没有数字
    turnTps: 0,
    turnOutputTokens: 0,      // 条上显示的那个「本问 tok」= 主轮口径，和 turnTps 同分子
    turnTotalOutputTokens: 0, // turn_usage 里这一轮的总输出（含上下文压缩）
    turnCompactTokens: 0,     // 其中属于上下文压缩的那部分
    turnDurationMs: 0,
    turnTtftMs: 0,
    turnRequests: 0,
    turnSteps: 0,
    turnToolCalls: 0,
    updatedAt: Date.now(),
  };
  if (!sessionId) return out;

  const db2 = getDb();

  /* --- 会话标题 --- */
  try {
    const t = S("session", "title", "''");
    if (t !== "''") {
      const r = db2.prepare("SELECT " + t + " AS title FROM session WHERE id=?").get(sessionId);
      if (r && r.title) out.title = String(r.title);
    }
  } catch (e) { /* ignore */ }

  /* --- 轮次聚合：turn_usage（ZCode 自己统计面板用的表） --- */
  if (has("turn_usage")) {
    try {
      const A = (c, alias) => "COALESCE(SUM(" + S("turn_usage", c) + "),0) AS " + alias;
      const runningCol = S("turn_usage", "status", "'completed'");
      const sql =
        "SELECT COUNT(*) AS turns, " +
        A("model_request_count", "steps") + ", " +
        A("tool_call_count", "toolCalls") + ", " +
        A("input_tokens", "inputTokens") + ", " +
        A("output_tokens", "outputTokens") + ", " +
        A("cache_read_input_tokens", "cacheReadTokens") + ", " +
        A("computed_total_tokens", "computedTotal") + ", " +
        "MAX(CASE WHEN " + runningCol + "='running' THEN 1 ELSE 0 END) AS running " +
        "FROM turn_usage WHERE session_id=?";
      const r = db2.prepare(sql).get(sessionId) || {};
      out.turns = r.turns || 0;
      out.steps = r.steps || 0;
      out.toolCalls = r.toolCalls || 0;
      out.inputTokens = r.inputTokens || 0;
      out.outputTokens = r.outputTokens || 0;
      out.cacheReadTokens = r.cacheReadTokens || 0;
      out.totalTokens = r.computedTotal || (out.inputTokens + out.outputTokens);
      out.running = !!r.running;
    } catch (e) {
      note("⚠ turn_usage 读取失败：" + e.message);
    }
  }

  /* --- 输出速度：model_usage 每次主轮请求的 output_tokens / 纯生成耗时 --- */
  if (has("model_usage")) {
    try {
      const c = cols("model_usage");
      const genExpr = c.has("time_to_first_token_ms")
        ? "(duration_ms - COALESCE(time_to_first_token_ms,0))"
        : "duration_ms";
      const where = ["session_id=?"];
      if (c.has("query_source")) where.push("query_source='main_turn'");
      if (c.has("status")) where.push("status='completed'");
      const sql =
        "SELECT COALESCE(SUM(" + S("model_usage", "output_tokens") + "),0) AS out, " +
        "COALESCE(SUM(CASE WHEN " + genExpr + " > 0 THEN " + genExpr + " ELSE 0 END),0) AS genMs, " +
        "COUNT(*) AS reqs FROM model_usage WHERE " + where.join(" AND ");
      const r = db2.prepare(sql).get(sessionId) || {};
      const genSec = (r.genMs || 0) / 1000;
      out.tps = genSec > 0.5 ? (r.out || 0) / genSec : 0;
      out.modelRequests = r.reqs || 0;
      // 若 turn_usage 不可用（schema 变了），至少保证 totalTokens 有值
      if (!out.totalTokens && has("model_usage")) {
        const tot = S("model_usage", ["provider_total_tokens", "computed_total_tokens"], "0");
        const t = db2.prepare("SELECT COALESCE(SUM(" + tot + "),0) AS t FROM model_usage WHERE session_id=?")
          .get(sessionId);
        out.totalTokens = (t && t.t) || 0;
      }
    } catch (e) {
      note("⚠ model_usage 读取失败：" + e.message);
    }
  }

  /* --- 缓存命中率 = 缓存读取 / 输入（cache_read 是 input 的子集） --- */
  if (out.inputTokens > 0 && cols("turn_usage").has("cache_read_input_tokens")) {
    out.cacheHit = (out.cacheReadTokens / out.inputTokens) * 100;
    if (out.cacheHit > 100) out.cacheHit = 100;
  } else if (has("model_usage") && cols("model_usage").has("cache_read_input_tokens")) {
    try {
      const r = getDb().prepare(
        "SELECT COALESCE(SUM(" + S("model_usage", "input_tokens") + "),0) AS i, " +
        "COALESCE(SUM(" + S("model_usage", "cache_read_input_tokens") + "),0) AS c " +
        "FROM model_usage WHERE session_id=?"
      ).get(sessionId) || {};
      out.cacheHit = r.i > 0 ? Math.min(100, (r.c / r.i) * 100) : null;
    } catch (e) { /* ignore */ }
  }

  /* --- 本问（最近一轮） --- */
  try { readTurnMetrics(sessionId, out); } catch (e) { note("⚠ 本问读取失败：" + e.message); }

  return out;
}

/* ------------------------------------------------------------------
 * 本问 = 最近一轮的数字。
 *
 * 和累计数字用的是同一张表、同一套口径，只是把范围从「整个会话」缩到「一轮」。
 * 唯一麻烦的是怎么认出「当前这一轮」：
 *   · turn_usage 是这一轮**结束时**才落盘的（实测整个库里一条 running 都没有），
 *     所以轮次进行中去回合表里找是找不到的；
 *   · model_usage 是**每个请求**落一次，轮次还没结束就已经有这一轮的 turn_id 了。
 * 因此当前轮 = model_usage 里最近一条主轮请求（query_source='main_turn'）的 turn_id；
 * turn_usage 只在轮次结束后用来补状态、耗时、首字这些汇总值。
 *
 * 还有一段「用户已经发问、但第一个请求还没回来」的空档（实测能有几秒）。
 * 那段时间如果继续显示上一轮的数字，就等于在骗人，所以用 session_input 里用户
 * 最后一次真实发送（kind='sendText'）的时间跟本轮的落盘活动时间比一下：
 * 发送时间更晚 ⇒ 这是一个刚开始的新提问 ⇒ 本问先显示 -- 并转圈。
 * （todo_reminder / backgroundNotification 这类注入消息不写 sendText 行，
 *   所以轮次跑到一半不会被它们误判成「新提问」。）
 * ------------------------------------------------------------------ */
function readTurnMetrics(sessionId, out) {
  const db2 = getDb();
  const mu = has("model_usage");
  const mc = mu ? cols("model_usage") : new Set();

  /* 1) 认轮次 */
  let turnId = null;
  if (mu && mc.has("turn_id") && mc.has("started_at")) {
    try {
      const where = ["session_id=?", "turn_id IS NOT NULL"];
      if (mc.has("query_source")) where.push("query_source='main_turn'");
      const r = db2.prepare(
        "SELECT turn_id FROM model_usage WHERE " + where.join(" AND ") +
        " ORDER BY started_at DESC, rowid DESC LIMIT 1"
      ).get(sessionId);
      if (r && r.turn_id) turnId = String(r.turn_id);
    } catch (e) { /* ignore */ }
  }
  if (!turnId && has("turn_usage") && cols("turn_usage").has("turn_id")) {
    try {
      const order = cols("turn_usage").has("started_at") ? "started_at DESC, rowid DESC" : "rowid DESC";
      const r = db2.prepare("SELECT turn_id FROM turn_usage WHERE session_id=? ORDER BY " + order + " LIMIT 1")
        .get(sessionId);
      if (r && r.turn_id) turnId = String(r.turn_id);
    } catch (e) { /* ignore */ }
  }
  if (!turnId) return;
  out.hasTurn = true;
  out.turnId = turnId;

  /* 2) 这一轮已完成的主轮请求（轮次跑到一半时，这里会一段一段往上长） */
  let lastActivityAt = 0;
  if (mu) {
    try {
      const genExpr = mc.has("time_to_first_token_ms")
        ? "(duration_ms - COALESCE(time_to_first_token_ms,0))"
        : "duration_ms";
      const where = ["session_id=?", "turn_id=?"];
      if (mc.has("query_source")) where.push("query_source='main_turn'");
      if (mc.has("status")) where.push("status='completed'");
      const r = db2.prepare(
        "SELECT COALESCE(SUM(" + S("model_usage", "output_tokens") + "),0) AS out, " +
        "COALESCE(SUM(CASE WHEN " + genExpr + " > 0 THEN " + genExpr + " ELSE 0 END),0) AS genMs, " +
        "COALESCE(SUM(" + S("model_usage", "tool_call_count") + "),0) AS tools, " +
        "COUNT(*) AS reqs, MAX(" + S("model_usage", "completed_at") + ") AS lastAt " +
        "FROM model_usage WHERE " + where.join(" AND ")
      ).get(sessionId, turnId) || {};
      const genSec = (r.genMs || 0) / 1000;
      out.turnTps = genSec > 0.5 ? (r.out || 0) / genSec : 0;
      out.turnOutputTokens = r.out || 0;
      out.turnRequests = r.reqs || 0;
      out.turnToolCalls = r.tools || 0;
      lastActivityAt = r.lastAt || 0;
    } catch (e) { note("⚠ 本问 model_usage 读取失败：" + e.message); }
  }

  /* 3) 轮次汇总（结束后才有这一行） */
  if (has("turn_usage") && cols("turn_usage").has("turn_id")) {
    try {
      const t = db2.prepare("SELECT * FROM turn_usage WHERE session_id=? AND turn_id=? LIMIT 1").get(sessionId, turnId);
      if (t) {
        out.turnStatus = t.status == null ? null : String(t.status);
        /* turn_usage.output_tokens 把这一轮里的「上下文压缩」也算进来了。
         * 实测一轮：主轮 8 次请求共 5255 tok，其中 7 次 completed；另有 1 次
         * query_source='compact' 输出 7751 tok —— turn_usage 记的是
         * 13006 = 5255 + 7751。而 turnTps 的分子只算 completed 的主轮请求。
         *
         * 于是条上会并排出现「150 tok/s · 13k tok」：拿这两个数反推生成耗时是 87s，
         * 实际纯生成 98.6s —— 对不上。速度不含压缩的耗时，却把压缩的输出算进分子，
         * 挨着显示的两个数必须能互相解释，所以这里统一成主轮口径；
         * 压缩那部分单独留一个字段，由 tooltip / --print 说明，不藏着。 */
        out.turnTotalOutputTokens = t.output_tokens || out.turnOutputTokens;
        out.turnCompactTokens = Math.max(0, out.turnTotalOutputTokens - out.turnOutputTokens);
        // 主轮明细一条都读不出来（比如全失败）时，才退回总量口径，
        // 免得条上出现「-- tok/s · 0 tok」这种比原来更差的样子。
        if (!out.turnRequests) out.turnOutputTokens = out.turnTotalOutputTokens;
        out.turnDurationMs = t.duration_ms || 0;
        out.turnTtftMs = t.time_to_first_token_ms || 0;
        out.turnSteps = t.model_request_count || 0;
        if (t.tool_call_count) out.turnToolCalls = t.tool_call_count;
        if (t.completed_at && t.completed_at > lastActivityAt) lastActivityAt = t.completed_at;
        // 万一 model_usage 读不出明细，至少还能用这一行的耗时算速度
        if (!out.turnTps && out.turnDurationMs > 0) {
          const gen = out.turnDurationMs - out.turnTtftMs;
          if (gen > 500) out.turnTps = (out.turnOutputTokens / gen) * 1000;
        }
      }
    } catch (e) { note("⚠ 本问 turn_usage 读取失败：" + e.message); }
  }

  /* 4) 用户刚发问、数字还没落盘 */
  if (has("session_input") && cols("session_input").has("time_created")) {
    try {
      const ic = cols("session_input");
      const where = ["session_id=?"];
      if (ic.has("kind")) where.push("kind='sendText'");
      const s = db2.prepare("SELECT MAX(time_created) AS at FROM session_input WHERE " + where.join(" AND "))
        .get(sessionId);
      if (s && s.at && (!lastActivityAt || s.at > lastActivityAt)) out.turnPending = true;
    } catch (e) { /* ignore */ }
  }

  /* 5) 还在跑吗：轮次没结束（turn_usage 里没这一行，或状态还是 running），
        或者用户刚发问还没量到东西。 */
  out.turnRunning = out.turnPending || !out.turnStatus || out.turnStatus === "running";
}

function metricsFor(hint) {
  const sid = resolveSessionId(hint);
  return readMetrics(sid);
}

/* ============================================================
 *  三、CDP 客户端
 * ============================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, timeoutMs = 2500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.closed = true;
    this.ws = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.wsUrl); } catch (e) { return reject(e); }
      this.ws = ws;
      const fail = (e) => { try { ws.close(); } catch (_) {} reject(e instanceof Error ? e : new Error(String(e))); };
      const timer = setTimeout(() => fail(new Error("WebSocket 连接超时")), 6000);
      ws.addEventListener("open", () => { clearTimeout(timer); this.closed = false; resolve(this); });
      ws.addEventListener("error", (ev) => { clearTimeout(timer); fail(new Error("WebSocket 错误")); });
      ws.addEventListener("close", () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error("连接已断开"));
        this.pending.clear();
      });
      ws.addEventListener("message", (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch (e) { return; }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "CDP 错误"));
          else p.resolve(msg.result);
        }
      });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP 未连接"));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this.pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + " 超时")); }
      }, 10000);
    });
  }
  close() { try { this.ws && this.ws.close(); } catch (e) {} this.closed = true; }
}

/** 找到 ZCode 主渲染进程的调试目标 */
function pickPage(targets) {
  const pages = (targets || []).filter(
    (t) => t && t.type === "page" && t.webSocketDebuggerUrl && !/^devtools:\/\//i.test(t.url || "")
  );
  if (!pages.length) return null;
  const score = (t) => {
    const u = String(t.url || "");
    let s = 0;
    if (/\/renderer\//i.test(u)) s += 10;
    if (/index\.html/i.test(u)) s += 4;
    if (/zcode/i.test(u)) s += 3;
    if (/app\.asar/i.test(u)) s += 2;
    if (/^about:blank$/i.test(u)) s -= 5;
    if (/^file:/i.test(u)) s += 1;
    return s;
  };
  return pages.slice().sort((a, b) => score(b) - score(a))[0];
}

async function discoverPage(port) {
  let lastErr = null;
  for (const host of ["127.0.0.1", "localhost"]) {
    try {
      const list = await httpJson("http://" + host + ":" + port + "/json/list");
      const p = pickPage(list);
      if (p) return p;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

/* ============================================================
 *  四、主流程
 * ============================================================ */

const OVERLAY_PATH = path.join(HERE, "overlay.js");
function overlaySource() {
  return fs.readFileSync(OVERLAY_PATH, "utf8");
}

function pushExpr(m) {
  // 顺带回一个存活标记：页面上那份 overlay 可能自己没了（异常、被别的注入脚本
  // 顶掉、或者谁手动调了 __zcodeSB.remove()）。以前这里是无条件 update，表达式在
  // __zcodeSB 不存在时静默返回 undefined，守护进程却一直以为已注入，条就再也不
  // 会回来 —— 只有重启守护进程才行。现在让它把 "missing" 带回来。
  return "(window.__zcodeSB&&window.__zcodeSB.update)"
    + "?(window.__zcodeSB.update(" + JSON.stringify(m) + "),'live')"
    + ":'missing'";
}

// 去重键：updatedAt 每轮都变，把它算进去等于完全没有去重 —— 只用稳定的指标字段。
function pushKey(m) {
  const { updatedAt, ...stable } = m;
  return JSON.stringify(stable);
}

// 心跳：指标长期不变时也定期重申一次。
// 两个作用：① 统计条被外部改掉后能自己恢复；② 页面刷新后 overlay 先用本地缓存
// 画旧值，心跳保证旧值最多只停留这么久。取 ~2.5s，兼顾及时性与 CDP 开销。
const HEARTBEAT_TICKS = Math.max(1, Math.round(2500 / Math.max(500, OPTS.interval)));

/* 「屏幕上现在打开的是哪个会话」——条必须跟着它，而不是跟着「最近有动静的会话」。
 *
 * 踩过的坑（2026-09-28 实测）：早先这里只读 location.href。
 * 但这一版 ZCode 的 URL 是 file:///.../renderer/index.html?restoreSession=true&…，
 * **永远不带 sess_**，于是 hint 恒为 null，resolveSessionId 每次都退到
 * 「session.time_updated 最大的那个」。正在聊的那个会话恰好就是最近更新的那个，
 * 所以平时看着是对的 —— 直到你点开一个旧会话只是看看：
 * 实测此时条仍显示另一个会话的 29 轮 / 19M tok，而屏幕上开着的是旧会话。
 * （第一次测的时候旧会话的输入框还没进视野，条自己藏起来了，所以没显形；
 *   把输入框滚进视野、条可见时，错值就直接怼脸上了。）
 *
 * 现在优先读侧栏里被选中的那一条：
 *   [data-testid^="task-item-"] 是 ZCode 自己写的测试钩子（和 task-new-button、
 *   v4-composer 同一档），.bg-selected 是它自己的样式令牌
 *   （样式表里确有 `.bg-selected { background-color: var(--color-selected); }`），
 *   都不是构建产物里的哈希类名。认不出来（侧栏收起、多组同时选中、页面还没渲染完）
 *   就返回 null，走原来的兜底，行为只会退化不会变坏；resolveSessionId 还会再验一次
 *   这个 id 在库里存不存在。
 */
const PAGE_HINT_EXPR = `(function () {
  var RE = /sess_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  /* 1) URL 里带就用 URL 的（现在这版不带，留着以防以后带上） */
  var m = String(location.href).match(RE);
  if (m) return m[0];
  /* 2) 侧栏里被选中的那个任务项 */
  try {
    var sel = document.querySelectorAll('[data-testid^="task-item-"].bg-selected');
    if (sel.length === 1) {
      var m2 = String(sel[0].getAttribute("data-testid")).match(RE);
      if (m2) return m2[0];
    }
  } catch (e) { /* ignore */ }
  /* 3) 认不出来 → null，交给「最近有活动的会话」兜底 */
  return null;
})()`;

async function readPageSessionHint(cdp) {
  try {
    const r = await cdp.send("Runtime.evaluate", {
      expression: PAGE_HINT_EXPR,
      returnByValue: true,
    });
    const v = r && r.result && r.result.value;
    return typeof v === "string" && v ? v : null;
  } catch (e) { return null; }
}

/* ---------------- 单实例锁 ----------------
 * 注入器是常驻进程，重复启动只会多出一个同样的进程去抢同一个调试端口。
 * 用 pid 锁文件挡住后启动的那一个；锁文件坏了也不会挡住正常启动。
 */
const LOCK_PATH = path.join(HERE, ".daemon.lock");

function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function readLockPid() {
  try { return Number(JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")).pid) || 0; } catch (e) { return 0; }
}

function acquireLock() {
  const existing = readLockPid();
  if (pidAlive(existing)) return false;
  try {
    /* 先写临时文件再原子换名：两个进程同时启动时，「检查→写入」之间的窗口
       只剩一次 rename 竞争，而不是「都看到没锁 → 都写」的双赢局面。 */
    const tmp = LOCK_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, startedAt: Date.now(), port: OPTS.port }));
    fs.renameSync(tmp, LOCK_PATH);
  } catch (e) {
    return true; // 锁文件写不进去时不阻塞启动
  }
  const release = () => {
    try { if (readLockPid() === process.pid) fs.unlinkSync(LOCK_PATH); } catch (e) {}
  };
  process.on("exit", release);
  return true;
}

async function run() {
  // 给启动脚本用的探针：已有注入器在跑则退 0，否则退 1
  if (argv.includes("--locked")) process.exit(pidAlive(readLockPid()) ? 0 : 1);

  if (!fs.existsSync(DB_PATH)) {
    console.error("  ✗ 找不到 ZCode 数据目录。请先运行一次 ZCode。");
    process.exit(3);
  }

  // 自检模式：只读指标，不连 CDP
  if (OPTS.print) {
    log("");
    log("  ZCode 底部数据统计条");
    log("  ─────────────────────────────────────────────");
    log("  数据库 : " + DB_PATH);
    log("  调试端口: 127.0.0.1:" + OPTS.port);
    log("");
    const m = metricsFor(OPTS.session);
    console.log(JSON.stringify(m, null, 2));
    console.log("");
    if (m.hasTurn) {
      console.log("  本问  " + [
        m.turnRunning ? "(进行中)" : "(" + (m.turnStatus || "?") + ")",
        (m.turnTps > 0 ? Math.round(m.turnTps) : "--") + " tok/s",
        (m.turnOutputTokens / 1e3).toFixed(1) + "k tok",
        m.turnSteps + " 步",
        Math.round(m.turnTtftMs / 100) / 10 + "s 首字",
        Math.round(m.turnDurationMs / 100) / 10 + "s",
      ].join("  ·  "));
      if (m.turnCompactTokens > 0) {
        console.log("        （本轮合计 " + (m.turnTotalOutputTokens / 1e3).toFixed(1) +
          "k tok，其中上下文压缩 " + (m.turnCompactTokens / 1e3).toFixed(1) +
          "k tok 不计入上面的 tok/s）");
      }
    }
    console.log("  " + [
      m.turns + " 轮",
      m.steps + " 步",
      Math.round(m.tps) + " tok/s",
      (m.totalTokens / 1e6).toFixed(2) + "M tok",
      m.cacheHit == null ? "缓存 --" : "缓存命中 " + Math.round(m.cacheHit) + "%",
    ].join("  ·  "));
    return;
  }

  if (!acquireLock()) {
    note("已有注入器在运行（pid " + readLockPid() + "），本次启动退出。");
    note("如需重启，先关闭那个最小化的 “ZCode 状态栏” 窗口。");
    return;
  }

  const overlay = overlaySource();
  note("守护进程已启动：db=" + DB_PATH + "  port=127.0.0.1:" + OPTS.port + "  interval=" + OPTS.interval + "ms");
  let cdp = null;
  let targetKey = null;
  let injected = false;
  let newDocScriptId = null; // Page.addScriptToEvaluateOnNewDocument 返回的注册号
  let lastPush = "";
  let lastHint = "\u0000";
  let ticks = 0;
  let pushed = 0;
  let warnedPort = false;

  async function connect() {
    let page;
    try {
      page = await discoverPage(OPTS.port);
    } catch (e) {
      if (!warnedPort) {
        warnedPort = true;
        note("✗ 连不上调试端口 127.0.0.1:" + OPTS.port);
        note("  ZCode 必须带 --remote-debugging-port 启动。");
        note("  请完全退出 ZCode，然后用 启动ZCode(带状态栏).cmd 启动。");
      }
      return null;
    }
    warnedPort = false;
    if (!page) return null;

    const key = page.id || page.webSocketDebuggerUrl;
    if (cdp && !cdp.closed && key === targetKey) return cdp;
    if (cdp) cdp.close();

    const c = new CDP(page.webSocketDebuggerUrl);
    await c.open();
    await c.send("Page.enable").catch(() => {});
    await c.send("Runtime.enable").catch(() => {});
    cdp = c;
    targetKey = key;
    injected = false;
    newDocScriptId = null; // 注册表属于旧会话，随断开一起失效
    lastPush = "";
    note("已连接渲染进程 " + String(page.url || "").slice(0, 90));
    return cdp;
  }

  async function ensureInjected() {
    if (!cdp || cdp.closed || injected) return;
    try {
      // 页面刷新/导航后自动重装。先摘掉上一份注册再挂新的：
      // 这个调用不自动去重，重连几次就会在同一个文档上叠几份，
      // 页面每次加载都要多跑一遍（互相 return 得早，但注册表本身在涨）。
      if (newDocScriptId) {
        try {
          await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: newDocScriptId });
        } catch (e) { /* 旧会话的注册可能已随断开失效，忽略 */ }
        newDocScriptId = null;
      }
      const added = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: overlay });
      newDocScriptId = (added && added.identifier) || null;
      // 当前这一份页面立刻装上
      await cdp.send("Runtime.evaluate", { expression: overlay, returnByValue: false });
      injected = true;
      note("统计条已注入渲染进程");
    } catch (e) {
      note("✗ 注入失败：" + e.message);
    }
  }

  async function tick() {
    try {
      if (!(await connect())) return;
      await ensureInjected();
      if (!injected) return;

      // 让统计条跟随当前窗口显示的会话
      const hint = OPTS.session || (await readPageSessionHint(cdp)) || null;
      // 认不出会话时不喜欢静默退化 —— 写一行日志，事后一眼能看出
      // 「是页面钩子又失效了」还是「本来就该走最近有活动的会话」。
      if (hint !== lastHint) {
        lastHint = hint;
        note(hint
          ? "跟随会话：" + hint
          : "认不出屏幕上的会话（侧栏没选中项/还没渲染完），本拍用最近有活动的会话");
      }
      const m = metricsFor(hint);
      const key = pushKey(m);
      const beat = ++ticks % HEARTBEAT_TICKS === 0;
      if (key !== lastPush || beat) {
        const r = await cdp.send("Runtime.evaluate", { expression: pushExpr(m), returnByValue: true });
        // 页面上那份 overlay 不在了：把自己标成「没注入」，下一拍 ensureInjected 会重装。
        // （不在这里直接重装，是因为 tick 的节奏很密，让它走同一条注入路径更好维护。）
        if (r && r.result && r.result.value === "missing") {
          injected = false;
          lastPush = "";
          note("页面上没有统计条了（__zcodeSB 不在），下一拍重新注入");
          return;
        }
        if (key !== lastPush) {
          lastPush = key;
          log("  [" + ts() + "] 指标已更新：" + [
            m.turns + " 轮", m.steps + " 步", Math.round(m.tps) + " tok/s",
            (m.totalTokens / 1e6).toFixed(2) + "M tok",
            m.cacheHit == null ? "缓存 --" : "缓存 " + Math.round(m.cacheHit) + "%",
          ].join(" · "));
        } else {
          log("  [" + ts() + "] 心跳重申（指标未变）");
        }
        pushed++;
      }
    } catch (e) {
      if (cdp) { cdp.close(); cdp = null; injected = false; }
    }
  }

  // 退出时主动把条撤掉、内边距还原。
  // 不这么做的话，页面要等 15s 看门狗超时才自己藏起来 —— 期间输入框一直被抬着。
  async function cleanup() {
    if (!cdp || cdp.closed) return;
    try {
      await Promise.race([
        cdp.send("Runtime.evaluate", {
          expression: "(window.__zcodeSB&&window.__zcodeSB.remove)?window.__zcodeSB.remove():0",
          returnByValue: false,
        }),
        new Promise((r) => setTimeout(r, 800)),
      ]);
    } catch (e) { /* 页面已经关了就算了 */ }
    cdp.close();
  }
  process.on("SIGINT", () => {
    cleanup().then(() => { log("\n  已停止（统计条已撤掉、输入框内边距已还原）。"); process.exit(0); });
  });
  process.on("SIGTERM", () => { cleanup().then(() => process.exit(0)); });

  // 首轮快速重试（ZCode 冷启动要几秒）
  for (let i = 0; i < 40; i++) {
    await tick();
    if (injected) break;
    await sleep(750);
  }

  sweepOldSnapshots();
  setInterval(tick, Math.max(500, OPTS.interval));
}

await run();
