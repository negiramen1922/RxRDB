// RxRDB 管理画面（Firebase: Google ログイン + Firestore）
// index.html の footer「管理者ログイン」（#admin）から読み込まれる。
import * as F from "./fb.js";

let R = null;            // index.html 側の橋渡し (window.RXR)
const AM = document.getElementById("admin");
const NAV = document.getElementById("adminTabs");
const TABLES = ["chars", "scripts", "babel", "people", "styles"];
const TLABEL = { chars: "キャラ", scripts: "スクリプト", babel: "バベル", people: "キャラクター", styles: "スタイル", options: "選択肢" };
const KEYCOLS = { chars: ["ID"], scripts: ["名前"], babel: ["バベル種類", "階層"], people: ["名前"], styles: ["スタイル"] };
/* ---- 入力フォームの設計（列名 → 入力の種類）。ここにない列は「その他の列」に出る ---- */
// t: text / num / long / big / date / opt:選択肢キー / people / style / id / master / cond / charpick
const SCHEMA = {
  chars: [
    { g: "基本", f: [["キャラ", "people"], ["スタイル", "style"], ["ID", "id"], ["キャラ名", "text"], ["名前 ひらがな", "text"], ["No", "num"], ["実装日", "date"], ["属性", "opt:属性"], ["ダメージタイプ", "opt:ダメージタイプ"], ["ロール", "opt:ロール"]] },
    { g: "キャラクター設定から（自動）", note: "騎士団・階級・性別は「キャラクター」の設定がそのまま使われます。変えるときはキャラクターのほうを編集してください。", f: [["騎士団", "master"], ["階級", "master"], ["性別", "master"]] },
    { g: "ステータス", f: [["HP初期値", "num"], ["Lv200 HP", "num"], ["HP最大値", "num"], ["攻撃力初期値", "num"], ["Lv200 攻撃力", "num"], ["攻撃力最大値", "num"], ["物理防御", "num"], ["特殊防御", "num"], ["攻撃速度", "opt:攻撃速度"], ["抵抗値", "num"]] },
    { g: "コスト", f: [["初期コスト", "num"], ["育成後コスト", "num"], ["再出撃コスト", "num"], ["再出撃時間(S)", "num"]] },
    { g: "スキル", f: [["スキル名", "text"], ["スキルクールタイム", "num"], ["覚醒1 スキル効果", "long"], ["覚醒7 スキル効果", "long"], ["覚醒13 スキル効果", "long"]] },
    { g: "BLADE", f: [["BLADE名", "text"], ["BLADEゲージ", "num"], ["Lv1 BLADE効果", "long"], ["Lv7 BLADE効果", "long"], ["Lv13 BLADE効果", "long"]] },
    { g: "特性", f: [["特性名称", "text"], ["Lv1 特性効果", "long"], ["Lv3 特性効果", "long"], ["Lv5 特性効果", "long"], ["特性開放 ★4", "long"], ["特性開放 ★5", "long"]] },
  ],
  scripts: [
    { g: "基本", f: [["名前", "text"], ["レアリティ", "opt:レアリティ"], ["ロール", "opt:ロール"], ["実装日", "date"]] },
    { g: "ステータス", f: [["HP初期値", "num"], ["HP最大値", "num"], ["攻撃力初期値", "num"], ["攻撃力最大値", "num"], ["物理防御", "num"], ["特殊防御", "num"]] },
    { g: "スキル1", f: [["スキル1効果", "long"]] },
    { g: "スキル2", f: [["条件2", "cond"], ["スキル2効果", "long"]] },
    { g: "スキル3", f: [["条件3", "cond"], ["スキル3効果", "long"]] },
  ],
  babel: [
    { g: "基本", f: [["バベル種類", "opt:バベル種類"], ["階層", "num"], ["ボス", "text"], ["推奨属性", "opt:属性"]] },
    { g: "解析データ", note: "1行に1つの効果。【特性】【味方】【敵】などの見出し行で区切ります。「上昇」「低下」などから自動で ▲▼ を判定します。", f: [["解析データ", "big"]] },
    { g: "おすすめ・コメント", f: [["おすすめキャラID", "charpick"], ["ポイント", "long"], ["コメント", "long"]] },
  ],
  people: [
    { g: "基本", f: [["名前", "text"], ["ふりがな", "text"], ["性別", "opt:性別"], ["誕生日", "text"], ["騎士団", "opt:騎士団"], ["階級", "opt:階級"], ["CV", "text"]] },
    { g: "プロフィール", f: [["プロフィール", "long"]] },
  ],
  styles: [
    { g: "基本", note: "略称は「カノン 聖典」のようにキャラ名を自動で作るとき、よみはひらがなを作るときに使います。", f: [["スタイル", "text"], ["略称", "text"], ["よみ", "text"], ["メモ", "long"]] },
  ],
};
const PH = { "誕生日": "例：4月1日", "CV": "声優", "階層": "例：110", "略称": "例：聖典", "よみ": "例：せいてん" };
const STALE = 5 * 60e3;

const S = {
  open: false, user: null, role: null, authReady: false, tab: "edit",
  unsubs: [], heartbeat: null,
};
const T = {};            // T[k] = {headers, hdrReady, rowsReady, rows: Map(id -> {id,c,o,t,by,rev})}
TABLES.forEach(k => { T[k] = { headers: [], hdrExists: false, hdrReady: false, rowsReady: false, rows: new Map() }; });
const PUB = {};          // PUB[k] = {sig, at, by, count}
let EDITING = {};        // uid -> {email,name,k,id,at}
let ROLES = [];          // [{email, at, by}]
let FEEDBACK = [];       // [{id, ...}]
let LOG = [];            // [{id, ...}]
let STATS = null;        // [{day, pv, uv}]
let NEWSLIST = [];
let OPTS = null;         // public/options（プルダウンの選択肢）
let TIERPUB = {};        // public/tiers の中身（サーバー側）
const TIERPEND = [];     // 送信中の配置変更（画面には先に反映）       // public/news
let GH = null;           // {token, repo, branch} GitHub 連携（secrets/github）

const esc = s => R.esc(s);
const toast = (m, ms) => R.toast(m, ms);
const now = () => Date.now();
const rid = () => now().toString(36) + Math.random().toString(36).slice(2, 10);
const me = () => S.user ? (S.user.email || "").toLowerCase() : "";
const meName = () => S.user ? (S.user.displayName || me().split("@")[0]) : "";
const shortName = e => { const r = ROLES.find(x => x.email === e); return (r && r.name) || (e || "").split("@")[0]; };
const fmtTime = t => { if (!t) return ""; const d = new Date(t); const p = n => String(n).padStart(2, "0"); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const ago = t => { const s = (now() - t) / 1000; if (s < 60) return "たった今"; if (s < 3600) return Math.floor(s / 60) + "分前"; if (s < 86400) return Math.floor(s / 3600) + "時間前"; return fmtTime(t); };
function fbErr(e) {
  const c = e && e.code || "";
  if (c === "permission-denied" || c === "permission_denied") return "権限がありません。ログインし直すか、オーナーに権限を確認してください";
  if (c === "resource-exhausted") return "今日の無料枠の上限に達したか、書き込みが混み合っています。時間をおいてもう一度試してください";
  if (c === "unavailable") return "サーバーにつながりません。通信状態を確認してください";
  return "失敗しました：" + (e && (e.message || c) || "不明なエラー");
}

/* ================= entry ================= */
export async function start(rxr) {
  R = rxr;
  injectStyle();
  window.RXR_ADMIN = { open, close, pick: pickFromList };
  F.onAuthStateChanged(F.auth, async u => {
    stopListeners();
    S.user = u; S.role = null; S.authReady = true;
    if (u) S.role = await resolveRole(u);
    if (S.role) startListeners();
    if (S.open) renderAll();
  });
  open();
}
function open() {
  S.open = true;
  R.setMode("admin", soft => renderAdmin(soft));
  document.getElementById("main").hidden = true;
  AM.hidden = false;
  document.getElementById("userTabs").hidden = true;
  { const st = document.getElementById("subTabs"); if (st) st.hidden = true; }
  NAV.hidden = false;
  const ab = document.getElementById("actionbar"); if (ab) ab.classList.add("hidden");
  headerButton(true);
  renderAll();
  window.scrollTo(0, 0);
}
function close() {
  if (!S.open) return;
  S.open = false;
  clearPresence();
  R.setMode("user");
  if (DLG && DLG.open) { ED.dirty = false; DLG.close(); }
  R.setTierEdit(false);
  headerButton(false);
  AM.hidden = true; NAV.hidden = true;
  document.getElementById("main").hidden = false;
  document.getElementById("userTabs").hidden = false;
  { const st = document.getElementById("subTabs"); if (st) st.hidden = false; }
  R.rebuild(); R.renderUser(); R.setNews(R.NEWS);
  if (location.hash === "#admin" || location.hash === "#") history.replaceState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);
}
// 管理画面ではヘッダーの「不具合・ご要望」を「ユーザー画面へ」に置き換える（タブの押し間違い防止）
function headerButton(admin) {
  const fb = document.querySelector(".top .acts [data-feedback]");
  let b = document.getElementById("toUser");
  if (!b && fb) { b = document.createElement("button"); b.id = "toUser"; b.className = fb.className; b.textContent = "← ユーザー画面へ"; fb.after(b); b.addEventListener("click", () => { if (ED.dirty && !confirm("保存していない変更があります。破棄してユーザー画面に戻りますか？")) return; ED.dirty = false; location.hash = ""; close(); }); }
  if (fb) fb.hidden = admin; if (b) b.hidden = !admin;
  const nb = document.querySelector(".top .acts [data-news]"); if (nb) nb.hidden = admin;
  const bar = document.getElementById("newsbar"); if (bar && admin) bar.hidden = true;
}
async function resolveRole(u) {
  const e = (u.email || "").toLowerCase();
  if (!u.emailVerified) return null;
  S.deny = null;
  if (e === F.OWNER) {
    // ルール側もオーナーと認めているか確認（ルールの貼り忘れ・古いルールを検出）
    try { await F.getDoc(F.doc(F.db, "tables", "chars")); return "owner"; }
    catch (err) { S.deny = err && err.code === "permission-denied" ? "rules" : "net"; S.denyMsg = err && (err.message || err.code); return null; }
  }
  try { const s = await F.getDoc(F.doc(F.db, "roles", e)); return s.exists() ? "editor" : null; }
  catch (err) { if (err && err.code !== "permission-denied") { S.deny = "net"; S.denyMsg = err.message || err.code; } return null; }
}

/* ================= live listeners ================= */
function stopListeners() { S.unsubs.forEach(f => { try { f(); } catch (e) { } }); S.unsubs = []; clearInterval(S.heartbeat); }
function startListeners() {
  const on = (ref, fn) => S.unsubs.push(F.onSnapshot(ref, fn, err => {
    console.warn(ref.path, err);
    if (err && err.code === "permission-denied" && !S.deny) { S.deny = "rules"; S.role = null; stopListeners(); renderAll(); return; }
    toast(fbErr(err), 5000);
  }));
  TABLES.forEach(k => {
    on(F.doc(F.db, "tables", k), s => { T[k].hdrExists = s.exists(); T[k].headers = s.exists() ? (s.data().headers || []) : []; T[k].hdrReady = true; tableChanged(k); });
    on(F.collection(F.db, "tables", k, "rows"), q => {
      if (q.metadata.fromCache && !T[k].rowsReady) return;
      const m = new Map(); q.docs.forEach(d => m.set(d.id, Object.assign({ id: d.id }, d.data())));
      T[k].rows = m; T[k].rowsReady = true; T[k].pending = q.metadata.hasPendingWrites; tableChanged(k);
    });
  });
  ["chars", "scripts", "babel", "people", "styles", "crops", "news", "tiers", "options"].forEach(k => on(F.doc(F.db, "public", k), s => {
    const d = s.exists() ? s.data() : null;
    PUB[k] = d ? { sig: d.sig, at: d.at, by: d.by, count: d.count } : null;
    if (k === "crops") { try { R.setCrops(d && d.json ? JSON.parse(d.json) : {}); } catch (e) { } }
    else if (k === "tiers") { let v = {}; try { v = d && d.json ? JSON.parse(d.json) : {}; } catch (e) { } TIERPUB = v.tiers || {}; applyOfficial(v.at); if (S.tab === "tier") softRender(); return; }
    else if (k === "options") { try { OPTS = d && d.json ? JSON.parse(d.json) : null; } catch (e) { OPTS = null; } if (OPTS) R.setOptions(OPTS); softRender(); return; }
    else if (k === "news") { try { NEWSLIST = d && d.json ? JSON.parse(d.json) : []; } catch (e) { NEWSLIST = []; } R.setNews(NEWSLIST); }
    else maybePublish(k);
    softRender();
  }));
  on(F.collection(F.db, "editing"), q => { const o = {}; q.docs.forEach(d => { o[d.id] = d.data(); }); EDITING = o; softRender(); });
  on(F.collection(F.db, "roles"), q => { ROLES = q.docs.map(d => Object.assign({ email: d.id }, d.data())); softRender(); });
  on(F.query(F.collection(F.db, "feedback"), F.orderBy("at", "desc"), F.limit(300)), q => {
    FEEDBACK = q.docs.map(d => { const x = d.data(); return Object.assign({ id: d.id }, x, { at: x.at && x.at.toMillis ? x.at.toMillis() : (x.at || 0) }); });
    renderNav(); softRender();
  });
  on(F.query(F.collection(F.db, "log"), F.orderBy("at", "desc"), F.limit(150)), q => { LOG = q.docs.map(d => Object.assign({ id: d.id }, d.data())); softRender(); });
  S.unsubs.push(F.onSnapshot(F.doc(F.db, "secrets", "github"), s => { GH = s.exists() && s.data().token ? s.data() : null; softRender(); }, () => { GH = null; }));
  S.heartbeat = setInterval(() => { if (ED.id && document.visibilityState === "visible") setPresence(); }, 120e3);
}
function derive(k) {
  const t = T[k];
  const rows = [...t.rows.values()].sort((a, b) => (a.o - b.o) || (a.id < b.id ? -1 : 1));
  return { headers: t.headers.slice(), rows: rows.map(r => t.headers.map(h => r.c && r.c[h] != null ? String(r.c[h]) : "")), ids: rows.map(r => r.id) };
}
const seeded = k => T[k].hdrExists && T[k].rowsReady;
const allReady = () => TABLES.every(k => T[k].hdrReady && T[k].rowsReady);
function tableChanged(k) {
  if (seeded(k) && (k === "chars" || k === "scripts" || k === "babel")) { R.setLive(k, publicData(k)); R.rebuild(); }
  if (k === "people" && seeded("chars")) { R.setLive("chars", publicData("chars")); R.rebuild(); maybePublish("chars"); }
  // someone else changed the row I'm editing?
  if (ED.k === k && ED.id && !ED.isNew) {
    const r = T[k].rows.get(ED.id);
    if (!r) { if (!ED.saving) ED.gone = true; }
    else if (r.rev !== ED.baseRev && !ED.saving) {
      if (!ED.dirty) loadRow(k, ED.id);
      else ED.remote = r;
    }
  }
  maybePublish(k);
  softRender();
}

/* ================= publish (Firestore rows → public/{k}) ================= */
function sigOf(k) {
  const t = T[k]; const ids = [...t.rows.values()].map(r => r.id + ":" + r.rev).sort();
  const own = R.hashId(t.headers.join("\u0001") + "\u0002" + ids.join(","));
  return k === "chars" && seeded("people") ? own + "+" + sigOf("people") : own;
}
// 公開用のキャラ表には、キャラクター設定（騎士団・階級・性別）を合流させる
const MASTER_COLS = ["騎士団", "階級", "性別"];
function publicData(k) {
  const d = derive(k);
  if (k !== "chars" || !seeded("people")) return { headers: d.headers, rows: d.rows };
  const pm = {}; T.people.rows.forEach(r => { const c = r.c || {}; if (c["名前"]) pm[c["名前"]] = c; });
  const hd = d.headers.slice(); MASTER_COLS.forEach(h => { if (!hd.includes(h)) hd.push(h); });
  const ci = d.headers.indexOf("キャラ");
  const rows = d.rows.map(r => { const o = hd.map((h, i) => i < r.length ? r[i] : ""); const m = pm[r[ci]]; if (m) MASTER_COLS.forEach(h => { if (m[h]) o[hd.indexOf(h)] = m[h]; }); return o; });
  return { headers: hd, rows };
}
const pubTimers = {};
function maybePublish(k) {
  if (!TABLES.includes(k) || !seeded(k) || T[k].pending || !(k in PUB)) return;
  const sig = sigOf(k);
  if (PUB[k] && PUB[k].sig === sig) return;
  clearTimeout(pubTimers[k]);
  pubTimers[k] = setTimeout(() => publish(k).catch(e => console.warn(e)), 1200 + Math.random() * 1500);
}
async function publish(k, force) {
  if (!seeded(k)) return;
  const sig = sigOf(k);
  if (!force && PUB[k] && PUB[k].sig === sig) return;
  const d = publicData(k);
  const json = JSON.stringify({ headers: d.headers, rows: d.rows });
  if (json.length > 1000000) { toast(`${TLABEL[k]}データが大きすぎて公開できません（1MB超）`, 6000); return; }
  await F.setDoc(F.doc(F.db, "public", k), { json, sig, at: now(), by: me(), count: d.rows.length });
}
function pubState(k) {
  if (!seeded(k)) return { cls: "warn", t: "未登録" };
  if (!PUB[k]) return { cls: "mid", t: "反映中…" };
  if (PUB[k].sig !== sigOf(k)) return { cls: "mid", t: "反映中…" };
  return { cls: "ok", t: "公開中" };
}

/* ================= presence ================= */
function setPresence() {
  if (!S.user || !ED.id) return;
  F.setDoc(F.doc(F.db, "editing", S.user.uid), { email: me(), name: meName(), k: ED.k, id: ED.id, at: now() }).catch(() => { });
}
function clearPresence() {
  if (!S.user) return;
  F.deleteDoc(F.doc(F.db, "editing", S.user.uid)).catch(() => { });
}
window.addEventListener("pagehide", () => { if (S.open) clearPresence(); });
function othersOn(k, id) {
  return Object.entries(EDITING).filter(([uid, e]) => S.user && uid !== S.user.uid && e.k === k && e.id === id && now() - (e.at || 0) < STALE).map(([, e]) => e);
}

/* ================= shell ================= */
const TABS = [["edit", "データ編集"], ["tier", "Tier表"], ["news", "お知らせ"], ["io", "読み込み・書き出し"], ["img", "画像"], ["log", "変更履歴"], ["fb", "ご意見"], ["stats", "アクセス"], ["members", "メンバー"]];
function renderNav() {
  if (!S.role) { NAV.innerHTML = ""; return; }
  const nf = FEEDBACK.filter(f => f.status === "new").length;
  NAV.innerHTML = TABS.map(([k, l]) => `<button role="tab" data-atab="${k}" aria-selected="${S.tab === k}">${l}${k === "fb" && nf ? `<span class="nbadge">${nf}</span>` : ""}</button>`).join("");
}
NAV.addEventListener("click", e => {
  const b = e.target.closest("[data-atab]"); if (!b) return;
  const t = b.dataset.atab;
  if ((S.tab === "edit" || S.tab === "tier") && t !== S.tab) { R.setMain(null); R.setTierEdit(false); }
  S.tab = t; renderAll(); window.scrollTo(0, 0);
});
function renderAll() { renderNav(); renderAdmin(false); }
let softT = null;
function softRender() { if (!S.open) return; clearTimeout(softT); softT = setTimeout(() => renderAdmin(true), 80); }
function userBar() {
  return `<div class="whoami">${S.user.photoURL ? `<img src="${esc(S.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}<span><b>${esc(meName())}</b> <small>${esc(me())}</small></span><span class="rolebadge">${S.role === "owner" ? "オーナー" : "編集者"}</span><button class="btn small" data-a="logout">ログアウト</button></div>`;
}
function statusBar() {
  if (!allReady()) return `<div class="astatus">データを読み込んでいます…</div>`;
  const notSeeded = TABLES.filter(k => !seeded(k));
  if (notSeeded.length) return `<div class="astatus warn">まだ取り込んでいないデータがあります（${notSeeded.map(k => TLABEL[k]).join("・")}）。<button class="btn small primary" data-a="seed" ${SEEDING ? "disabled" : ""}>${SEEDING ? "登録中…" : "今のデータを取り込む"}</button></div>`;
  return `<div class="astatus ok pubrow">${TABLES.map(k => { const p = pubState(k); return `<span>${TLABEL[k]} ${T[k].rows.size}件 <span class="mb ${p.cls}">${p.t}</span></span>`; }).join("")}<span class="count">保存すると数秒で公開サイトに反映されます</span></div>`;
}
function renderAdmin(soft) {
  if (!S.open) return;
  if (!S.authReady) { AM.innerHTML = `<div class="empty"><h2>読み込み中…</h2></div>`; return; }
  if (!S.user) { renderLogin(); return; }
  if (!S.role) { renderDenied(); return; }
  if (S.tab === "edit") renderEdit(soft);
  else if (S.tab === "io") { if (!(soft && IO.text)) renderIO(); }
  else if (S.tab === "img") { if (!(soft && IM.files.length)) renderImg(); }
  else if (S.tab === "tier") renderTierTab(soft);
  else if (S.tab === "news") { if (!(soft && NW.edit)) renderNews(); }
  else if (S.tab === "log") renderLog();
  else if (S.tab === "fb") renderFb();
  else if (S.tab === "stats") renderStats(soft);
  else if (S.tab === "members") renderMembers(soft);
}
function renderLogin(err) {
  renderNav();
  AM.innerHTML = `<div class="empty login"><h2>管理者ログイン</h2><p>データの編集は、招待されたメンバーだけができます。<br>招待されたメールアドレスの Google アカウントでログインしてください。</p>
  <div class="row"><button class="btn primary" data-a="login">Google でログイン</button></div>${err ? `<p class="err">${esc(err)}</p>` : ""}</div>`;
}
function renderDenied() {
  renderNav();
  if (S.deny === "rules") {
    AM.innerHTML = `<div class="empty login"><h2>Firestore のルールが古いままです</h2><p><b>${esc(me())}</b> はオーナーですが、Firebase 側のルールがまだこのアドレスを許可していません。<br>Firebase コンソール → Firestore Database → <b>ルール</b> に、<a href="https://github.com/negiramen1922/RxRDB/blob/main/firestore.rules" target="_blank" rel="noopener">最新の firestore.rules</a> を丸ごと貼り付けて「公開」し、このページを再読み込みしてください。</p>
    <div class="row"><button class="btn primary" data-a="reload">再読み込み</button><button class="btn" data-a="logout">ログアウト</button></div></div>`;
    return;
  }
  if (S.deny === "net") {
    AM.innerHTML = `<div class="empty login"><h2>Firestore に接続できません</h2><p>${esc(S.denyMsg || "")}</p><div class="row"><button class="btn primary" data-a="reload">再読み込み</button><button class="btn" data-a="logout">ログアウト</button></div></div>`;
    return;
  }
  AM.innerHTML = `<div class="empty login"><h2>編集の権限がありません</h2><p><b>${esc(me())}</b> はまだメンバーに登録されていません。<br>オーナーにこのメールアドレスを伝えて、「メンバー」に追加してもらってください。追加されたらページを再読み込みすると使えます。</p>
  <div class="row"><button class="btn" data-a="copyme">メールアドレスをコピー</button><button class="btn" data-a="logout">ログアウト</button></div></div>`;
}
async function login() {
  try { await F.signInWithPopup(F.auth, new F.GoogleAuthProvider()); }
  catch (e) {
    const c = e && e.code || "";
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
    if (c === "auth/unauthorized-domain") renderLogin(`このドメイン（${location.hostname}）がログイン用に登録されていません。Firebase の Authentication → 設定 → 承認済みドメイン に追加してください。`);
    else if (c === "auth/popup-blocked") renderLogin("ポップアップがブロックされました。ブラウザでこのサイトのポップアップを許可してください。");
    else renderLogin("ログインできませんでした：" + (e.message || c));
  }
}

/* ================= data editing ================= */
const ED = { manual: {}, k: "babel", q: "", id: null, isNew: false, draft: null, base: null, baseRev: null, dirty: false, confirmDel: false, newCol: "", remote: null, gone: false, saving: false, conflict: null, leaveOk: false };
function resetEd() { Object.assign(ED, { manual: {}, id: null, isNew: false, draft: null, base: null, baseRev: null, dirty: false, confirmDel: false, remote: null, gone: false, conflict: null }); }
function keyOf(k, hd, r) { const g = n => { const i = hd.indexOf(n); return i >= 0 ? String(r[i] || "").trim() : ""; }; return KEYCOLS[k].map(g).join("|"); }
function keyOfCells(k, c) { return KEYCOLS[k].map(n => String(c[n] || "").trim()).join("|"); }
function labelOf(k, c) {
  if (k === "babel") return `${c["バベル種類"] || ""} ${c["階層"] || ""}F ${c["ボス"] || ""}`.trim();
  if (k === "chars") return c["キャラ名"] || c["ID"] || "(名前なし)";
  if (k === "styles") return c["スタイル"] || "(名前なし)";
  return c["名前"] || "(名前なし)";
}
function thumbOf(k, c) {
  if (k === "chars") { const u = R.IMG[c["ID"]]; return u ? `<img src="${esc(u)}" alt="">` : `<span class="noimg"></span>`; }
  if (k === "scripts") { const u = R.SIMG[c["名前"]]; return u ? `<img src="${esc(u)}" alt="">` : `<span class="noimg"></span>`; }
  return `<span class="flnum">${esc(c["階層"] || "")}</span>`;
}
function loadRow(k, id) {
  const r = T[k].rows.get(id); if (!r) return;
  ED.id = id; ED.isNew = false;
  ED.base = Object.assign({}, r.c); ED.draft = Object.assign({}, r.c); ED.baseRev = r.rev;
  ED.dirty = false; ED.confirmDel = false; ED.remote = null; ED.gone = false; ED.conflict = null;
}
const EDORDER = ["babel", "chars", "scripts", "people", "styles", "options"];
const EDGROUP = { babel: "", chars: "", scripts: "", people: "master", styles: "master", options: "master" };
let DLG = null;
function edDialog() {
  if (DLG) return DLG;
  DLG = document.createElement("dialog"); DLG.id = "dlgEdit"; DLG.className = "wide";
  DLG.innerHTML = `<div class="dlg" id="edBody"></div>`;
  document.body.appendChild(DLG);
  DLG.addEventListener("click", onAdminClick);
  DLG.addEventListener("cancel", e => { if (ED.dirty && !ED.leaveOk) { e.preventDefault(); ED.leaveOk = true; toast("保存していない変更があります。もう一度 Esc を押すと破棄して閉じます", 3500); } });
  DLG.addEventListener("close", () => { clearPresence(); resetEd(); ED.leaveOk = false; });
  return DLG;
}
/* ---- GitHub の data/*.json にあって、まだ取り込んでいない行を知らせる ---- */
const GHNEW = {};   // k -> {file, added:[keys], changed:n, at}
async function checkGhNew(k) {
  if (!TABLES.includes(k) || !seeded(k)) return;
  if (GHNEW[k] && now() - GHNEW[k].at < 60e3) return;
  GHNEW[k] = { at: now(), added: [], changed: 0, busy: true };
  try {
    const d = await staticJson(`data/${k}.json`);
    const df = diffTables(k, curData(k), d);
    GHNEW[k] = { at: now(), file: d, added: df.added, changed: df.changed.length };
  } catch (e) { GHNEW[k] = { at: now(), added: [], changed: 0 }; }
  const gn = document.getElementById("ghnew"); if (gn && ED.k === k) gn.innerHTML = ghNewHtml(k);
}
function ghNewHtml(k) {
  if (!TABLES.includes(k) || !seeded(k)) return "";
  const g = GHNEW[k]; if (!g) { checkGhNew(k); return ""; }
  if (!g.added || !g.added.length) return "";
  return `<div class="astatus warn ghnewbar"><b>GitHub の data/${k}.json に、まだ取り込んでいない${TLABEL[k]}が ${g.added.length} 件あります</b><span class="count">${esc(g.added.slice(0, 6).join("、"))}${g.added.length > 6 ? " ほか" : ""}${g.changed ? `（内容が違う行も ${g.changed} 件）` : ""}</span>
  <span class="row2"><button class="btn small primary" data-a="ghimport" ${g.busy ? "disabled" : ""}>${g.busy ? "取り込み中…" : `${g.added.length}件を追加${g.changed ? `・${g.changed}件を更新` : ""}する`}</button><button class="btn small" data-a="ghimportnew" ${g.busy ? "disabled" : ""}>追加だけする</button></span></div>`;
}
async function ghImport(onlyNew) {
  const k = ED.k; const g = GHNEW[k]; if (!g || !g.file) return;
  g.busy = true; document.getElementById("ghnew").innerHTML = ghNewHtml(k);
  try {
    let inc = g.file;
    if (onlyNew) { const add = new Set(g.added); inc = { headers: g.file.headers, rows: g.file.rows.filter(r => add.has(keyOf(k, g.file.headers, r))) }; }
    const r = await applyTable(k, inc, "merge", "import");
    toast(`${TLABEL[k]}を取り込みました（追加${r.added}・更新${r.changed}）`, 6000);
    delete GHNEW[k];
  } catch (e) { g.busy = false; toast(fbErr(e), 8000); }
  const gn = document.getElementById("ghnew"); if (gn) gn.innerHTML = ghNewHtml(k);
}
function presHtml() {
  const list = Object.entries(EDITING).filter(([uid, e]) => S.user && uid !== S.user.uid && now() - (e.at || 0) < STALE && T[e.k] && T[e.k].rows.get(e.id));
  if (!list.length) return "";
  return `<div class="preslist">いま編集中：${list.map(([, e]) => `<span class="pres">✎ ${esc(e.name || shortName(e.email))}</span> ${esc(TLABEL[e.k])}「${esc(labelOf(e.k, T[e.k].rows.get(e.id).c || {}))}」`).join("　")}</div>`;
}
function renderEdit(soft) {
  if (!allReady()) { AM.innerHTML = userBar() + statusBar(); return; }
  const k = ED.k;
  const seg = `<div class="seg edseg">${EDORDER.map((t, i) => `${i && EDGROUP[t] && !EDGROUP[EDORDER[i - 1]] ? '<span class="segsep">マスター</span>' : ""}<button data-edk="${t}" aria-pressed="${k === t}">${TLABEL[t]}</button>`).join("")}</div>`;
  if (k !== "options" && !seeded(k)) {
    R.setMain(null);
    const base3 = ["chars", "scripts", "babel"].every(seeded);
    AM.innerHTML = userBar() + `<div class="toolbar">${seg}</div><div class="empty seedbox">${base3 ? `<h2>${TLABEL[k]}の表を作ります</h2><p>キャラクター（名前・ふりがな・性別・騎士団・階級など）とスタイル（略称・よみ）の表を、今のキャラデータから自動で作ります。<br>作ったあとは、キャラの騎士団・階級・性別はキャラクターの設定から自動で入るようになります。</p>` : `<h2>最初に、今のデータを管理画面に取り込みます</h2><p>公開サイトに出ているデータ（バベル ${countStatic("babel")}・キャラ ${countStatic("chars")}・スクリプト ${countStatic("scripts")}）は、まだ GitHub のファイルから表示している状態です。<br>下のボタンを1回押すと、それを編集用のデータベース（Firestore）に登録して、ここで編集できるようになります。</p>`}<div class="row2" style="justify-content:center"><button class="btn primary big" data-a="seed" ${SEEDING ? "disabled" : ""}>${SEEDING ? "登録中…" : base3 ? "キャラクターとスタイルの表を作る" : "今のデータを取り込んで編集を始める"}</button></div><p class="hint">公開サイトの表示は変わりません。</p></div>`;
    return;
  }
  const custom = k === "people" || k === "styles" || k === "options";
  const list = document.getElementById("admlist");
  if (soft && list) {
    const st = document.getElementById("adstatus"); if (st) st.innerHTML = statusBar();
    const pr = document.getElementById("edpres"); if (pr) pr.innerHTML = presHtml();
    const gn = document.getElementById("ghnew"); if (gn) gn.innerHTML = ghNewHtml(k);
    const ae = document.activeElement;
    if (!(ae && ae.closest && ae.closest("#admlist") && /INPUT|TEXTAREA/.test(ae.tagName))) { if (custom) list.innerHTML = customList(k); else R.renderList(k); }
    if (DLG && DLG.open) refreshForm();
    return;
  }
  document.getElementById("main").innerHTML = "";   // 同じ id の検索欄が重ならないように
  AM.innerHTML = userBar() + `<div id="adstatus">${statusBar()}</div><div class="toolbar edtool">${seg}<span style="flex:1"></span>${k === "options" ? "" : `<button class="btn primary" data-ed="new">＋ ${TLABEL[k]}を追加</button>`}</div><div id="edpres">${presHtml()}</div><div id="ghnew">${ghNewHtml(k)}</div><div id="admlist" class="admlist">${custom ? customList(k) : ""}</div>`;
  if (custom) { R.setMain(null); bindCustomList(); }
  else { R.setMain(document.getElementById("admlist"), () => { if (S.tab === "edit") R.renderList(ED.k); }); R.renderList(k); }
  if (DLG && DLG.open) refreshForm();
}
const CL = { q: "" };
function customList(k) {
  if (k === "options") return `<div class="toolbar"><h2><small>OPTIONS</small>選択肢</h2></div><p class="hint" style="margin:-6px 0 12px">入力フォームのプルダウンに出る候補です。新しい騎士団などが出たらここに追加してください。</p>` + renderOptions();
  const q = CL.q.toLowerCase();
  if (k === "people") {
    const units = {}; T.chars.rows.forEach(r => { const c = r.c || {}; (units[c["キャラ"]] = units[c["キャラ"]] || []).push(c); });
    const list = [...T.people.rows.values()].sort((a, b) => (a.o - b.o)).filter(r => !q || Object.values(r.c || {}).some(v => String(v).toLowerCase().includes(q)));
    return `<div class="toolbar"><h2><small>CHARACTERS</small>キャラクター</h2><input class="search" id="clq" placeholder="名前・騎士団などで検索" value="${esc(CL.q)}"><span class="count">${list.length} / ${T.people.rows.size}</span></div>
    <p class="hint" style="margin:-6px 0 12px">スタイルに関係なく、そのキャラ自身の情報です。ここの騎士団・階級・性別が、各スタイルのキャラデータに自動で使われます。</p>
    <div class="pgrid">${list.map(r => { const c = r.c || {}; const us = units[c["名前"]] || []; const face = us.map(u => R.IMG[u["ID"]]).find(Boolean);
      const who = othersOn("people", r.id);
      return `<button class="pcard" data-adrow="${esc(r.id)}">${face ? `<img src="${esc(face)}" alt="">` : '<span class="noimg"></span>'}<span class="pinfo"><b>${esc(c["名前"] || "")}</b><small>${esc(c["ふりがな"] || "")}</small>
      <span class="ptags">${c["騎士団"] ? `<span>${R.ic(c["騎士団"], "ord")}${esc(c["騎士団"])}</span>` : '<span class="miss">騎士団未設定</span>'}${c["階級"] ? `<span>${R.ic(c["階級"])}${esc(c["階級"])}</span>` : ""}${c["性別"] ? `<span>${esc(c["性別"])}</span>` : ""}${c["誕生日"] ? `<span>🎂${esc(c["誕生日"])}</span>` : ""}</span>
      <small class="count">スタイル ${us.length}：${esc(us.map(u => u["スタイル"]).join("・"))}</small></span>${who.length ? `<span class="pres">✎ ${esc(who[0].name || shortName(who[0].email))}</span>` : ""}</button>`; }).join("")}</div>`;
  }
  const cnt = {}; T.chars.rows.forEach(r => { const s = (r.c || {})["スタイル"]; cnt[s] = (cnt[s] || 0) + 1; });
  const list = [...T.styles.rows.values()].sort((a, b) => (a.o - b.o)).filter(r => !q || Object.values(r.c || {}).some(v => String(v).toLowerCase().includes(q)));
  return `<div class="toolbar"><h2><small>STYLES</small>スタイル</h2><input class="search" id="clq" placeholder="検索" value="${esc(CL.q)}"><span class="count">${list.length} / ${T.styles.rows.size}</span></div>
  <div class="tblwrap"><table class="stbl"><thead><tr><th>スタイル</th><th>略称</th><th>よみ</th><th>キャラ数</th><th>メモ</th></tr></thead><tbody>${list.map(r => { const c = r.c || {}; return `<tr data-adrow="${esc(r.id)}"><td class="first"><b>${esc(c["スタイル"] || "")}</b></td><td>${esc(c["略称"] || "")}</td><td>${esc(c["よみ"] || "")}</td><td>${cnt[c["スタイル"]] || 0}</td><td class="wrap">${esc(c["メモ"] || "")}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function bindCustomList() {
  AM.querySelectorAll("[data-optin]").forEach(el => el.addEventListener("keydown", e => { if (e.key === "Enter") { const b = AM.querySelector(`[data-optadd="${CSS.escape(el.dataset.optin)}"]`); if (b) b.click(); } }));
  const q = document.getElementById("clq");
  if (q) R.liveInput(q, () => { CL.q = q.value; const p = q.selectionStart; document.getElementById("admlist").innerHTML = customList(ED.k); bindCustomList(); const n = document.getElementById("clq"); n.focus(); n.setSelectionRange(p, p); });
}
function openEditor(k, id) {
  if (!T[k].rows.get(id)) { toast("この行が見つかりません（ほかのメンバーが削除した可能性があります）"); return; }
  ED.k = k; loadRow(k, id); setPresence(); renderForm();
}
function pickFromList(ds) {
  if (S.tab !== "edit") return false;
  const k = ED.k; if (!seeded(k)) return true;
  let id = null;
  if (ds.detail !== undefined && k === "chars") { for (const r of T.chars.rows.values()) if ((r.c || {})["ID"] === ds.detail) { id = r.id; break; } }
  else if (ds.sdetail !== undefined && k === "scripts") { id = derive("scripts").ids[+ds.sdetail]; }
  else if (ds.floor !== undefined && k === "babel") { for (const r of T.babel.rows.values()) if (keyOfCells("babel", r.c || {}) === ds.floor) { id = r.id; break; } }
  if (id) openEditor(k, id);
  return true;
}
function refreshForm() {
  if (ED.dirty || ED.isNew) { const bn = document.getElementById("edbanner"); if (bn) bn.innerHTML = bannerHtml(); return; }
  renderForm();
}
function renderForm() {
  const dl = edDialog();
  const body = document.getElementById("edBody");
  const sc = dl.open ? dl.scrollTop : 0;
  body.innerHTML = editForm();
  if (!dl.open) dl.showModal();
  dl.scrollTop = sc;
  body.querySelectorAll("[data-field]").forEach(el => {
    const ev = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(ev, () => {
      const name = el.dataset.field;
      let v = el.value;
      if (el.type === "date") v = fromDate(v);
      ED.draft[name] = v; ED.dirty = true; ED.leaveOk = false;
      if (ED.k === "chars" && (name === "キャラ名" || name === "名前 ひらがな")) ED.manual[name] = true;
      const sb = document.getElementById("edsave"); if (sb) sb.disabled = false;
      const fe = el.closest(".field"); if (fe) fe.classList.toggle("changed", (ED.base[name] || "") !== v);
      if (ED.k === "chars" && (name === "キャラ" || name === "スタイル")) { autofillChar(); renderForm(); }
    });
  });
  const nc = document.getElementById("ednewcol"); if (nc) nc.addEventListener("input", () => { ED.newCol = nc.value; });
  const ei = document.getElementById("edimg"); if (ei) ei.addEventListener("change", () => { const f = ei.files[0]; if (!f) return; const ik = ED.k === "chars" ? "char" : "script"; quickUpload(ik, ik === "char" ? ED.base["ID"] : ED.base["名前"], f); });
  const cp = document.getElementById("cpin"); if (cp) cp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); charpickAdd(); } });
}
/* ---- 選択肢（プルダウン） ---- */
const OPT_KEYS = ["騎士団", "階級", "ロール", "属性", "ダメージタイプ", "性別", "攻撃速度", "レアリティ", "バベル種類"];
const OPT_NOTE = { "騎士団": "キャラクターの騎士団。公開サイトの絞り込み・アイコンにも使われます", "階級": "KING・QUEEN など", "ロール": "キャラ・スクリプトのロール", "属性": "破壊・衝撃・爆発", "攻撃速度": "A・Aplus など", "バベル種類": "リバースバベル など" };
function colVals(k, col) { if (!T[k] || !seeded(k)) return []; const out = []; T[k].rows.forEach(r => { const v = String((r.c || {})[col] || "").trim(); if (v && !out.includes(v)) out.push(v); }); return out; }
const uniq = (...ls) => { const o = []; ls.forEach(l => (l || []).forEach(v => { if (v && !o.includes(v)) o.push(v); })); return o; };
function optDefaults() {
  return {
    "騎士団": uniq(R.ORDERS, colVals("people", "騎士団")), "階級": uniq(R.RANKS, colVals("people", "階級")),
    "ロール": uniq(R.ROLES, colVals("chars", "ロール"), colVals("scripts", "ロール")), "属性": uniq(R.ATTRS, colVals("chars", "属性")),
    "ダメージタイプ": uniq(["物理", "特殊", "ヒール"], colVals("chars", "ダメージタイプ")), "性別": uniq(["女", "男"], colVals("people", "性別")),
    "攻撃速度": uniq(colVals("chars", "攻撃速度")), "レアリティ": uniq(colVals("scripts", "レアリティ")), "バベル種類": uniq(R.TYPES, colVals("babel", "バベル種類")),
  };
}
function opts(key) { return OPTS && Array.isArray(OPTS[key]) && OPTS[key].length ? OPTS[key] : (optDefaults()[key] || []); }
async function saveOpts(mut, label) {
  try {
    await F.runTransaction(F.db, async tx => {
      const ref = F.doc(F.db, "public", "options"); const s = await tx.get(ref);
      let o = {}; try { o = s.exists() && s.data().json ? JSON.parse(s.data().json) : {}; } catch (e) { }
      const base = optDefaults(); OPT_KEYS.forEach(k => { if (!Array.isArray(o[k]) || !o[k].length) o[k] = base[k]; });
      mut(o);
      tx.set(ref, { json: JSON.stringify(o), at: now(), by: me() });
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "options", label }));
    });
  } catch (e) { toast(fbErr(e), 5000); }
}
function usage(key, v) {
  const m = { "騎士団": [["people", "騎士団"]], "階級": [["people", "階級"]], "ロール": [["chars", "ロール"], ["scripts", "ロール"]], "属性": [["chars", "属性"], ["babel", "推奨属性"]], "ダメージタイプ": [["chars", "ダメージタイプ"]], "性別": [["people", "性別"]], "攻撃速度": [["chars", "攻撃速度"]], "レアリティ": [["scripts", "レアリティ"]], "バベル種類": [["babel", "バベル種類"]] }[key] || [];
  let n = 0; m.forEach(([k, c]) => { if (T[k]) T[k].rows.forEach(r => { if (String((r.c || {})[c] || "").trim() === v) n++; }); }); return n;
}
function renderOptions() {
  let h = `<div class="optgrid">${OPT_KEYS.map(k => `<section class="apanel optcard"><h3 class="ph">${esc(k)}</h3><p class="hint" style="margin:0 0 8px">${esc(OPT_NOTE[k] || "")}</p>
    <div class="optchips">${opts(k).map((v, i, a) => `<span class="optchip">${i > 0 ? `<button data-optmv="${esc(k)}|${i}|-1" title="前へ">‹</button>` : ""}<b>${esc(v)}</b><small>${usage(k, v)}</small>${i < a.length - 1 ? `<button data-optmv="${esc(k)}|${i}|1" title="後ろへ">›</button>` : ""}<button data-optrm="${esc(k)}|${esc(v)}" title="外す">✕</button></span>`).join("")}</div>
    <div class="addcol"><input data-optin="${esc(k)}" placeholder="${esc(k)}を追加"><button class="btn small" data-optadd="${esc(k)}">追加</button></div></section>`).join("")}</div>
    <p class="hint">数字はその値を使っているデータの件数です。外しても、入力済みのデータはそのまま残ります。</p>`;
  return h;
}
/* ---- 入力フォームの部品 ---- */
function toDate(v) { const m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(v || ""); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; }
function fromDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? `${m[1]}年${+m[2]}月${+m[3]}日` : v; }
function rowsOf(k) { return seeded(k) ? [...T[k].rows.values()].sort((a, b) => (a.o - b.o) || (a.id < b.id ? -1 : 1)).map(r => r.c || {}) : []; }
const personRow = n => rowsOf("people").find(c => c["名前"] === n);
const styleRow = n => rowsOf("styles").find(c => c["スタイル"] === n);
function maxNo() { let m = 0; T.chars.rows.forEach(r => { const n = parseInt((r.c || {})["No"], 10); if (n > m) m = n; }); return m; }
function autofillChar() {
  const c = ED.draft; const ch = (c["キャラ"] || "").trim(); const st = (c["スタイル"] || "").trim() || "DEFAULT";
  const sty = styleRow(st) || {}; const p = personRow(ch) || {};
  if (ED.isNew) {
    c["ID"] = ch ? `${ch}_${st.replace(/\s/g, "")}` : "";
    if (!c["スタイル"]) c["スタイル"] = "DEFAULT";
    if (!ED.manual["キャラ名"]) c["キャラ名"] = ch ? `${ch} ${sty["略称"] || st}` : "";
    if (!ED.manual["名前 ひらがな"]) c["名前 ひらがな"] = ch ? `${p["ふりがな"] || ""}${sty["よみ"] || ""}` : "";
    if (!c["No"]) c["No"] = String(maxNo() + 1);
  }
  MASTER_COLS.forEach(h => { if (p[h]) c[h] = p[h]; });
}
function selectHtml(id, name, list, v, ph) {
  const items = v && !list.includes(v) ? list.concat([v]) : list;
  return `<select id="${id}" data-field="${esc(name)}"><option value="">${esc(ph || "（選択）")}</option>${items.map(x => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(x)}${!list.includes(x) ? "（一覧にない値）" : ""}</option>`).join("")}</select>`;
}
function charOptions() { return [...T.chars.rows.values()].map(r => r.c || {}).filter(c => c["ID"]).map(c => ({ id: c["ID"], label: c["キャラ名"] || c["ID"] })); }
function charpickAdd() {
  const inp = document.getElementById("cpin"); const q = (inp.value || "").trim(); if (!q) return;
  const all = charOptions(); const hit = all.find(o => o.id === q || o.label === q || `${o.label}（${o.id}）` === q) || all.find(o => o.label.includes(q));
  if (!hit) { toast("そのキャラが見つかりません"); return; }
  const cur = String(ED.draft["おすすめキャラID"] || "").split(/[,、，\s]+/).filter(Boolean);
  if (!cur.includes(hit.id)) cur.push(hit.id);
  ED.draft["おすすめキャラID"] = cur.join(","); ED.dirty = true; renderForm();
  const n = document.getElementById("cpin"); if (n) n.focus();
}
function fieldHtml(name, type, i, both) {
  const v = ED.draft[name] == null ? "" : String(ED.draft[name]);
  const changed = (ED.base[name] || "") !== v; const id = "f_" + i;
  let cls = "field", inner = "", label = esc(name);
  const ph = PH[name] ? ` placeholder="${esc(PH[name])}"` : "";
  if (type === "id") {
    cls += " idf";
    inner = `<input id="${id}" value="${esc(v)}" readonly tabindex="-1"><small class="count">${ED.isNew ? "キャラとスタイルから自動で付きます" : "Tier配置・画像の紐付けに使うため固定です"}</small>`;
  } else if (type === "people") {
    inner = selectHtml(id, name, rowsOf("people").map(c => c["名前"]).filter(Boolean), v, "（キャラクターを選択）");
  } else if (type === "style") {
    inner = selectHtml(id, name, rowsOf("styles").map(c => c["スタイル"]).filter(Boolean), v, "（スタイルを選択）");
  } else if (type.startsWith("opt:")) {
    inner = selectHtml(id, name, opts(type.slice(4)), v);
  } else if (type === "master") {
    cls += " masterf"; const p = personRow(ED.draft["キャラ"]) || {};
    inner = `<div class="mval">${esc(p[name] || v || "—")}</div>`;
  } else if (type === "num") {
    cls += " numf"; inner = `<input id="${id}" data-field="${esc(name)}" value="${esc(v)}" inputmode="decimal"${ph}>`;
  } else if (type === "date") {
    const dv = toDate(v);
    inner = dv || !v ? `<input id="${id}" type="date" data-field="${esc(name)}" value="${esc(dv)}">` : `<input id="${id}" data-field="${esc(name)}" value="${esc(v)}">`;
  } else if (type === "cond") {
    inner = `<input id="${id}" data-field="${esc(name)}" value="${esc(v)}" list="dl_cond" placeholder="属性・騎士団・階級・スタイル・キャラ名・女性/男性">`;
  } else if (type === "charpick") {
    cls += " long";
    const ids = v.split(/[,、，\s]+/).filter(Boolean);
    inner = `<div class="cpchips">${ids.map(x => { const c = R.CHMAP[x]; return `<span class="cpchip">${R.IMG[x] ? `<img src="${esc(R.IMG[x])}" alt="">` : ""}${esc(c ? c.name : x)}${c ? "" : ' <small class="err">（見つからないID）</small>'}<button data-cprm="${esc(x)}" aria-label="外す">✕</button></span>`; }).join("") || '<span class="count">まだいません</span>'}</div>
      <div class="addcol"><input id="cpin" list="dl_chars" placeholder="キャラ名を入力して追加"><button class="btn small" data-a="cpadd">追加</button></div>`;
  } else if (type === "long" || type === "big") {
    cls += " long";
    const rows = type === "big" ? Math.max(8, (v.match(/\n/g) || []).length + 2) : Math.min(10, Math.max(2, Math.ceil(v.length / 48) + (v.match(/\n/g) || []).length));
    inner = `<textarea id="${id}" data-field="${esc(name)}" rows="${rows}"${ph}>${esc(v)}</textarea>`;
  } else {
    const long = v.length > 40 || /\n/.test(v);
    if (long) { cls += " long"; inner = `<textarea id="${id}" data-field="${esc(name)}" rows="${Math.min(8, Math.ceil(v.length / 48) + 1)}">${esc(v)}</textarea>`; }
    else inner = `<input id="${id}" data-field="${esc(name)}" value="${esc(v)}"${ph}>`;
  }
  if (changed && type !== "master" && type !== "id") cls += " changed";
  if (both.includes(name)) cls += " clash";
  const key = KEYCOLS[ED.k] && KEYCOLS[ED.k].includes(name) && type !== "id";
  return `<div class="${cls}"><label for="${id}">${label}${key ? ' <small class="req">必須</small>' : ""}</label>${inner}</div>`;
}
function formFields(both) {
  const hd = T[ED.k].headers; const sch = SCHEMA[ED.k] || [];
  const inSchema = new Set(sch.flatMap(g => g.f.map(x => x[0])));
  let i = 0, h = "";
  sch.forEach(g => {
    if (ED.k === "chars" && g.f.every(([n]) => n === "騎士団" || n === "階級" || n === "性別") && !ED.draft["キャラ"]) return;
    const nums = g.f.filter(([, t]) => t === "num").length;
    h += `<section class="fgroup"><h3 class="fgh">${esc(g.g)}</h3>${g.note ? `<p class="hint fgnote">${esc(g.note)}</p>` : ""}<div class="fields2${nums >= 4 ? " numgrid" : ""}">${g.f.map(([n, t]) => fieldHtml(n, t, i++, both)).join("")}</div></section>`;
  });
  const others = hd.filter(n => !inSchema.has(n));
  if (others.length) h += `<section class="fgroup"><h3 class="fgh">その他の列</h3><div class="fields2">${others.map(n => fieldHtml(n, /効果|解析|ポイント|コメント|プロフィール|メモ/.test(n) ? "long" : "text", i++, both)).join("")}</div></section>`;
  // datalists
  const cond = uniq(R.ATTRS, opts("騎士団"), opts("階級"), rowsOf("styles").map(c => c["スタイル"]), rowsOf("people").map(c => c["名前"]), ["女性", "男性"]);
  h += `<datalist id="dl_cond">${cond.map(x => `<option value="${esc(x)}">`).join("")}</datalist>`;
  if (ED.k === "babel") h += `<datalist id="dl_chars">${charOptions().map(o => `<option value="${esc(o.label)}">`).join("")}</datalist>`;
  return h;
}
function tableSeg(attr, cur) { return `<div class="seg">${TABLES.map(k => `<button data-${attr}="${k}" aria-pressed="${cur === k}">${TLABEL[k]}</button>`).join("")}</div>`; }
function bannerHtml() {
  let h = "";
  if (ED.id && !ED.isNew) {
    const who = othersOn(ED.k, ED.id);
    if (who.length) h += `<div class="astatus warn">${esc(who.map(w => w.name || w.email).join("、"))} さんもこの行を開いています。同時に保存した場合は、あとから保存した人に確認が出ます。</div>`;
  }
  if (ED.gone) h += `<div class="astatus warn">この行はほかのメンバーによって削除されました。保存すると新しい行として作り直します。</div>`;
  if (ED.remote && !ED.conflict) h += `<div class="astatus warn">${esc(shortName(ED.remote.by))} さんがこの行を更新しました（${esc(ago(ED.remote.t))}）。<button class="btn small" data-ed="merge">相手の変更を取り込む</button></div>`;
  if (ED.conflict) {
    const c = ED.conflict;
    h += `<div class="astatus warn conflict"><b>保存の前に確認してください。</b>あなたが開いたあとに ${esc(shortName(c.other.by))} さんがこの行を更新しています（${esc(ago(c.other.t))}）。
    ${c.both.length ? `<br>両方が変えた項目：<b>${esc(c.both.join("、"))}</b>（下の欄はあなたの内容のままです）` : "<br>同じ項目は変えていないので、相手の変更を取り込んで保存できます。"}
    <div class="row2"><button class="btn small primary" data-ed="mergesave">相手の変更を取り込んで保存</button><button class="btn small" data-ed="force">自分の内容で上書き</button><button class="btn small" data-ed="discard">自分の変更を捨てる</button></div></div>`;
  }
  return h;
}
function editForm() {
  if (!ED.id || !ED.draft) return "";
  const hd = T[ED.k].headers;
  const r = T[ED.k].rows.get(ED.id);
  const both = ED.conflict ? ED.conflict.both : [];
  const ik = ED.k === "chars" ? "char" : ED.k === "scripts" ? "script" : null;
  const ikey = ik === "char" ? (ED.base["ID"] || "") : ik === "script" ? (ED.base["名前"] || "") : "";
  const th = ik === "char" ? R.IMG[ikey] : ik === "script" ? R.SIMG[ikey] : null;
  const full = ik && ikey ? R.cropSrc(ik, ikey) : null;
  const adj = ik && ikey && R.CROPS["c_" + ik + "_" + R.hashId(ikey)];
  let h = `<div class="edhead"><h2>${ED.isNew ? `${TLABEL[ED.k]}を追加` : esc(labelOf(ED.k, ED.draft))}</h2><span class="count">${TLABEL[ED.k]}</span><span style="flex:1"></span><button class="btn small" data-ed="close" aria-label="閉じる">✕ 閉じる</button></div><div id="edbanner">${bannerHtml()}</div>`;
  if (ik) {
    h += `<section class="edimgs">${ED.isNew || !ikey ? `<p class="hint" style="margin:0">画像は、保存したあとにここから追加できます。</p>` : `
      <div class="edth">${th ? `<img src="${esc(th)}" alt="">` : `<span class="noimg"></span>`}<small>サムネイル${adj ? "（調整済み）" : ""}</small></div>
      ${full ? `<div class="edfull"><img src="${esc(full)}" alt=""><small>元の画像</small></div>` : ""}
      <div class="edimgbtns">${full ? `<button class="btn small" data-a="edcrop">サムネイルの切り抜きを調整</button>` : ""}<label class="btn small filebtn">${full ? "画像を差し替え" : "画像を追加"}<input type="file" accept="image/*" id="edimg" hidden></label>
      <p class="hint" style="margin:4px 0 0">${GH ? "画像はサイズを整えて GitHub に保存され、公開サイトには1〜2分で反映されます。" : "画像のアップロードには、オーナーが「画像」タブで GitHub 連携を設定する必要があります。"}</p></div>`}</section>`;
  }
  if (r && !ED.isNew) h += `<p class="count" style="margin:-6px 0 10px">最終更新：${esc(shortName(r.by))}（${esc(fmtTime(r.t))}）</p>`;
  h += formFields(both);
  h += `<details class="addcolbox"><summary>列を追加する</summary><div class="addcol"><input id="ednewcol" placeholder="新しい列の名前" value="${esc(ED.newCol)}"><button class="btn small" data-ed="addcol">列を追加</button></div></details>`;
  h += `<div class="formfoot">${ED.confirmDel ? `<span class="danger-q">この行を削除しますか？</span><button class="btn small danger" data-ed="delyes">削除する</button><button class="btn small" data-ed="delno">やめる</button>` : (!ED.isNew ? `<button class="btn small" data-ed="del">この行を削除</button>` : "")}<span style="flex:1"></span>${ED.dirty && !ED.isNew ? `<button class="btn small" data-ed="cancel">変更を取り消す</button>` : ""}<button class="btn" data-ed="close">閉じる</button><button class="btn primary" id="edsave" data-ed="save" ${ED.dirty || ED.gone ? "" : "disabled"}>${ED.isNew ? "追加して公開" : "保存して公開"}</button></div>`;
  return h;
}
function diffCells(a, b, headers) { return headers.filter(h => String(a[h] || "") !== String(b[h] || "")); }
function mergeRemote(other) {
  // take the other person's value for fields I didn't touch
  const hd = T[ED.k].headers; const both = [];
  hd.forEach(h => {
    const mine = String(ED.draft[h] || ""), base = String(ED.base[h] || ""), theirs = String((other.c || {})[h] || "");
    if (mine === base) ED.draft[h] = theirs;
    else if (theirs !== base && theirs !== mine) both.push(h);
  });
  ED.base = Object.assign({}, other.c); ED.baseRev = other.rev; ED.remote = null;
  ED.dirty = diffCells(ED.draft, ED.base, hd).length > 0;
  return both;
}
function dupKey(k, cells, selfId) {
  const key = keyOfCells(k, cells);
  if (!key.replace(/\|/g, "")) return "empty";
  for (const r of T[k].rows.values()) if (r.id !== selfId && keyOfCells(k, r.c || {}) === key) return labelOf(k, r.c || {});
  return null;
}
function logDoc(o) { return Object.assign({ at: now(), by: me(), name: meName() }, o); }
async function saveRow(force) {
  const k = ED.k;
  if (k === "chars") autofillChar();
  const extra = Object.keys(ED.draft).filter(h => !T[k].headers.includes(h) && String(ED.draft[h] || "") !== "");
  const hd = T[k].headers.concat(extra);
  const cells = {}; hd.forEach(h => { cells[h] = String(ED.draft[h] == null ? "" : ED.draft[h]); });
  const dup = dupKey(k, cells, ED.id);
  if (dup === "empty") { toast(k === "chars" ? "キャラとスタイルを選んでください" : `「${KEYCOLS[k].join("」「")}」を入力してください`, 4000); return; }
  if (dup) { toast(k === "chars" ? `このキャラとスタイルの組み合わせ（${cells["ID"]}）はすでに「${dup}」としてあります` : `「${KEYCOLS[k].join("・")}」が「${dup}」と同じです。別の値にしてください`, 6000); return; }
  const creating = ED.isNew || ED.gone;
  const id = creating ? (ED.id && ED.gone ? ED.id : "r" + rid()) : ED.id;
  const ref = F.doc(F.db, "tables", k, "rows", id);
  const rev = rid();
  const btn = document.getElementById("edsave"); if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }
  ED.saving = true;
  try {
    await F.runTransaction(F.db, async tx => {
      const hdrRef = F.doc(F.db, "tables", k);
      const hs = extra.length ? await tx.get(hdrRef) : null;
      const s = await tx.get(ref);
      if (hs) { const cur = hs.exists() ? (hs.data().headers || []) : []; tx.set(hdrRef, { headers: cur.concat(extra.filter(x => !cur.includes(x))), t: now(), by: me() }); }
      if (!creating && !force) {
        if (!s.exists()) throw { code: "gone" };
        const cur = s.data();
        if (cur.rev !== ED.baseRev) throw { code: "conflict", other: Object.assign({ id }, cur) };
      }
      const prev = s.exists() ? s.data() : null;
      const o = prev ? prev.o : Math.max(0, ...[...T[k].rows.values()].map(r => r.o || 0)) + 1;
      tx.set(ref, { c: cells, o, t: now(), by: me(), rev });
      const ch = {};
      if (prev) diffCells(prev.c || {}, cells, hd).forEach(h => { ch[h] = [String((prev.c || {})[h] || ""), cells[h]]; });
      tx.set(F.doc(F.db, "log", rid()), logDoc(prev ? { act: "update", k, rowid: id, label: labelOf(k, cells), ch } : { act: "create", k, rowid: id, label: labelOf(k, cells), row: cells }));
    });
    ED.saving = false;
    ED.id = id; ED.isNew = false; ED.gone = false; ED.base = Object.assign({}, cells); ED.baseRev = rev; ED.dirty = false; ED.conflict = null; ED.remote = null;
    setPresence();
    toast(creating ? "追加しました。数秒で公開サイトに反映されます" : "保存しました。数秒で公開サイトに反映されます");
    renderForm();
  } catch (e) {
    ED.saving = false;
    if (e && e.code === "conflict") {
      const both = []; const hdr = hd;
      hdr.forEach(h => { const mine = String(ED.draft[h] || ""), base = String(ED.base[h] || ""), th = String((e.other.c || {})[h] || ""); if (mine !== base && th !== base && th !== mine) both.push(h); });
      ED.conflict = { other: e.other, both }; renderForm(); toast("ほかのメンバーの更新と重なりました。内容を確認してください", 5000); return;
    }
    if (e && e.code === "gone") { ED.gone = true; renderForm(); toast("この行はほかのメンバーが削除していました", 5000); return; }
    toast(fbErr(e), 6000);
    if (btn) { btn.disabled = false; btn.textContent = "保存して公開"; }
  }
}
async function deleteRow() {
  const k = ED.k, id = ED.id; const ref = F.doc(F.db, "tables", k, "rows", id);
  try {
    await F.runTransaction(F.db, async tx => {
      const s = await tx.get(ref); if (!s.exists()) return;
      const cur = s.data();
      if (cur.rev !== ED.baseRev) throw { code: "conflict", other: cur };
      tx.delete(ref);
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "delete", k, rowid: id, label: labelOf(k, cur.c || {}), row: cur.c || {}, o: cur.o }));
    });
    toast("削除しました"); ED.dirty = false; if (DLG) DLG.close();
  } catch (e) {
    if (e && e.code === "conflict") { toast("削除する前にほかのメンバーが更新しました。内容を確認してからもう一度削除してください", 6000); loadRow(k, id); renderForm(); return; }
    toast(fbErr(e), 5000);
  }
}
async function addColumn() {
  const k = ED.k; const n = (ED.newCol || "").trim();
  if (!n) return toast("列名を入力してください");
  if (/^__.*__$/.test(n)) return toast("その列名は使えません");
  if (T[k].headers.includes(n)) return toast("同じ名前の列があります");
  try {
    await F.runTransaction(F.db, async tx => {
      const ref = F.doc(F.db, "tables", k); const s = await tx.get(ref);
      const hd = s.exists() ? (s.data().headers || []) : [];
      if (hd.includes(n)) return;
      tx.set(ref, { headers: hd.concat([n]), t: now(), by: me() });
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "columns", k, label: `列「${n}」を追加` }));
    });
    ED.newCol = ""; toast(`列「${n}」を追加しました`);
  } catch (e) { toast(fbErr(e), 5000); }
}
async function edAction(a) {
  const k = ED.k;
  if (a === "new") { ED.manual = {}; ED.id = "new"; ED.isNew = true; ED.draft = {}; ED.base = {}; if (k === "babel") ED.draft["バベル種類"] = R.TYPES[0] || ""; if (k === "chars") ED.draft["スタイル"] = "DEFAULT"; ED.baseRev = null; ED.dirty = true; ED.confirmDel = false; ED.conflict = null; ED.remote = null; ED.gone = false; ED.newCol = ""; renderForm(); return; }
  if (a === "close") { if (ED.dirty && !ED.leaveOk) { ED.leaveOk = true; toast("保存していない変更があります。もう一度押すと破棄して閉じます", 3500); return; } if (DLG) DLG.close(); return; }
  if (a === "cancel") { loadRow(k, ED.id); renderForm(); return; }
  if (a === "del") { ED.confirmDel = true; renderForm(); return; }
  if (a === "delno") { ED.confirmDel = false; renderForm(); return; }
  if (a === "delyes") { deleteRow(); return; }
  if (a === "addcol") { addColumn(); return; }
  if (a === "save") { saveRow(false); return; }
  if (a === "merge") { if (ED.remote) { const both = mergeRemote(ED.remote); if (both.length) toast(`両方が変えた項目はあなたの内容のままです：${both.join("、")}`, 6000); } renderForm(); return; }
  if (a === "mergesave") { const both = mergeRemote(Object.assign({}, ED.conflict.other)); ED.conflict = null; if (both.length) { toast("両方が変えた項目はあなたの内容で保存します", 3000); } saveRow(false); return; }
  if (a === "force") { ED.conflict = null; saveRow(true); return; }
  if (a === "discard") { loadRow(k, ED.id); renderForm(); return; }
}

/* ---- 初期データの取り込み（data/*.json → Firestore） ---- */
let SEEDING = false;
function countStatic(k) { const d = R.LIVE[k]; return d && d.rows ? d.rows.length + "件" : "—"; }
async function seedAll() {
  if (SEEDING) return; SEEDING = true; renderAll();
  try {
    for (const t of TABLES) { if (seeded(t)) continue; const d = await staticJson(`data/${t}.json`); await applyTable(t, d, "replace", "seed"); }
    toast("取り込みが終わりました。ここから編集できます", 5000);
  } catch (e) { toast(fbErr(e), 7000); }
  SEEDING = false; renderAll();
}

/* ================= import / export ================= */
const IO = { k: "chars", text: "", hr: -1, confirm: null, busy: false };
function diffTables(k, cur, inc) {
  const map = d => { const m = new Map(); d.rows.forEach(r => { const key = keyOf(k, d.headers, r); if (key.replace(/\|/g, "")) m.set(key, r); }); return m; };
  const A = map(cur), B = map(inc); const added = [], changed = [], removed = [];
  const val = (d, r, h) => { const i = d.headers.indexOf(h); return i >= 0 ? String(r[i] || "").trim() : ""; };
  B.forEach((r, key) => { if (!A.has(key)) added.push(key); else { const a = A.get(key); const diffs = inc.headers.filter(h => val(cur, a, h) !== val(inc, r, h)); if (diffs.length) changed.push([key, diffs]); } });
  A.forEach((r, key) => { if (!B.has(key)) removed.push(key); });
  return { added, changed, removed };
}
function ioParsed() {
  if (!IO.text.trim()) return null; const rows = R.parseDelimited(IO.text); if (!rows.length) return null;
  if (IO.hr < 0 || IO.hr >= rows.length) { let best = 0, bc = -1; rows.slice(0, 6).forEach((r, i) => { const c = r.filter(x => x.trim()).length; if (c > bc) { bc = c; best = i; } }); IO.hr = best; const el = document.getElementById("iohr"); if (el) el.value = best + 1; }
  const hd = rows[IO.hr].map((h, i) => h.trim() || "列" + (i + 1)); const w = Math.max(...rows.map(r => r.length)); while (hd.length < w) hd.push("列" + (hd.length + 1));
  return { headers: hd, rows: rows.slice(IO.hr + 1).map(r => hd.map((_, i) => r[i] || "")) };
}
function curData(k) { return seeded(k) ? derive(k) : { headers: [], rows: [], ids: [] }; }
// write a full table to Firestore rows (merge: keep rows not in inc / replace: delete them)
async function applyTable(k, inc, mode, act) {
  const cur = curData(k);
  const hd = mode === "replace" ? inc.headers.slice() : cur.headers.concat(inc.headers.filter(h => !cur.headers.includes(h)));
  const curByKey = new Map(); cur.rows.forEach((r, i) => { const key = keyOf(k, cur.headers, r); if (key.replace(/\|/g, "") && !curByKey.has(key)) curByKey.set(key, { id: cur.ids[i], row: r }); });
  const ops = []; let maxO = Math.max(0, ...[...T[k].rows.values()].map(r => r.o || 0));
  const used = new Set(); let added = 0, changed = 0, removed = 0;
  const cellsFrom = (headers, r, baseCells) => { const c = Object.assign({}, baseCells || {}); headers.forEach((h, i) => { c[h] = String(r[i] == null ? "" : r[i]); }); return c; };
  inc.rows.forEach((r, i) => {
    const key = keyOf(k, inc.headers, r); if (!key.replace(/\|/g, "")) return;
    const hit = curByKey.get(key);
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      const old = T[k].rows.get(hit.id);
      const base = mode === "replace" ? {} : (old.c || {});
      const c = cellsFrom(inc.headers, r, base);
      if (diffCells(old.c || {}, c, hd).length) { ops.push(["set", hit.id, { c, o: mode === "replace" ? i + 1 : old.o, t: now(), by: me(), rev: rid() }]); changed++; }
      else if (mode === "replace" && old.o !== i + 1) ops.push(["set", hit.id, Object.assign({}, old, { o: i + 1, id: undefined })]);
    } else {
      ops.push(["set", "r" + rid(), { c: cellsFrom(inc.headers, r), o: mode === "replace" ? i + 1 : ++maxO, t: now(), by: me(), rev: rid() }]); added++;
    }
  });
  if (mode === "replace") cur.ids.forEach(id => { if (!used.has(id)) { ops.push(["del", id]); removed++; } });
  // commit in chunks
  const hdrRef = F.doc(F.db, "tables", k);
  let b = F.writeBatch(F.db); let n = 0;
  b.set(hdrRef, { headers: hd, t: now(), by: me() }); n++;
  for (const op of ops) {
    const ref = F.doc(F.db, "tables", k, "rows", op[1]);
    if (op[0] === "del") b.delete(ref); else { const d = Object.assign({}, op[2]); delete d.id; b.set(ref, d); }
    if (++n >= 400) { await b.commit(); b = F.writeBatch(F.db); n = 0; }
  }
  b.set(F.doc(F.db, "log", rid()), logDoc({ act: act || "import", k, label: `${TLABEL[k]}：追加${added}・変更${changed}${mode === "replace" ? `・削除${removed}` : ""}` }));
  await b.commit();
  return { added, changed, removed };
}
function renderIO() {
  const k = IO.k; const d = curData(k);
  const ns = TABLES.filter(t => !seeded(t));
  let h = userBar() + statusBar() + `<div class="toolbar"><h2><small>IMPORT / EXPORT</small>読み込み・書き出し</h2>${tableSeg("iok", k)}</div>`;
  if (ns.length) h += `<section class="apanel seed"><h3 class="ph">初期データを登録</h3><p class="hint" style="margin-top:0">GitHub の data/*.json（今の公開データ）を Firestore に取り込みます。最初に1回だけ必要です。未登録：${ns.map(t => TLABEL[t]).join("・")}</p><div class="row2"><button class="btn primary" data-io="seed" ${IO.busy ? "disabled" : ""}>初期データを登録</button></div></section>`;
  h += `<div class="iogrid"><section class="apanel"><h3 class="ph">スプレッドシートから読み込む</h3>
  <p class="hint" style="margin-top:0">シートを見出し行ごと範囲選択してコピーし、ここに貼り付けてください。CSV・TSVファイルも使えます。${k === "chars" ? "キャラは「ID」列で同じキャラを判定します。" : k === "babel" ? "「バベル種類」と「階層」で同じ階層を判定します。" : "「名前」列で同じスクリプトを判定します。"}</p>
  <textarea id="iotext" class="bigta" placeholder="ここに貼り付け">${esc(IO.text)}</textarea>
  <div class="row2"><input type="file" id="iofile" accept=".csv,.tsv,.txt"><label class="inl">見出しの行 <input type="number" id="iohr" min="1" value="${IO.hr >= 0 ? IO.hr + 1 : 1}" style="width:4.5em"></label></div>
  <div id="iopv">${ioPreview()}</div></section>
  <section class="apanel"><h3 class="ph">書き出す</h3>
  <p class="hint" style="margin-top:0">今の${TLABEL[k]}データ（${d.rows.length}件）をタブ区切りでコピーできます。スプレッドシートにそのまま貼り付けられます。</p>
  <div class="row2"><button class="btn primary" data-io="copy">タブ区切りでコピー</button><button class="btn" data-io="csv">CSVで保存</button></div>
  <h3 class="ph" style="margin-top:22px">GitHub 用バックアップ</h3>
  <p class="hint" style="margin-top:0">data/chars.json・scripts.json・babel.json の3ファイルを ZIP で保存します。GitHub の data フォルダに上書きして push しておくと、Firebase が使えないときの予備になります（月1回くらいがおすすめ）。</p>
  <div class="row2"><button class="btn" data-io="ghdata">data/*.json を書き出す</button></div>
  <h3 class="ph" style="margin-top:22px">公開データ</h3>
  <p class="hint" style="margin-top:0">保存すると自動で公開サイトに反映されます。反映されていないときだけ押してください。</p>
  <div class="row2"><button class="btn" data-io="publish">今すぐ公開データを更新</button>${TABLES.map(t => PUB[t] ? `<span class="count">${TLABEL[t]}：${esc(fmtTime(PUB[t].at))} ${esc(shortName(PUB[t].by))}</span>` : "").join("")}</div>
  ${seeded(k) ? `<h3 class="ph" style="margin-top:22px">GitHub のデータを取り込む</h3><p class="hint" style="margin-top:0">GitHub の data/${k}.json を左の読み込み欄に入れて、今のデータとの差分（追加・変更）を表示します。確認してから反映できます。</p>
  <div class="row2"><button class="btn" data-io="loadgh">data/${k}.json を読み込んで差分を見る</button></div>` : ""}</section></div>`;
  AM.innerHTML = h;
  const ta = document.getElementById("iotext"); ta.addEventListener("input", () => { IO.text = ta.value; IO.hr = -1; document.getElementById("iopv").innerHTML = ioPreview(); });
  document.getElementById("iohr").addEventListener("change", e => { IO.hr = Math.max(0, (+e.target.value || 1) - 1); document.getElementById("iopv").innerHTML = ioPreview(); });
  document.getElementById("iofile").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { IO.text = r.result; IO.hr = -1; renderIO(); }; r.readAsText(f); });
}
function ioPreview() {
  const inc = ioParsed(); if (!inc) return "";
  if (!seeded(IO.k)) return `<p class="err">先に「初期データを登録」をしてください。</p>`;
  const need = KEYCOLS[IO.k].filter(n => !inc.headers.includes(n));
  if (need.length) return `<p class="err">「${need.join("」「")}」列が見つかりません。見出しの行が合っているか確認してください。</p>`;
  const cur = curData(IO.k); const df = diffTables(IO.k, cur, inc);
  const li = (arr, f) => arr.slice(0, 12).map(f).join("") + (arr.length > 12 ? `<li class="count">ほか${arr.length - 12}件</li>` : "");
  const newCols = inc.headers.filter(h => !cur.headers.includes(h));
  return `<div class="diff"><div><b class="pos">追加 ${df.added.length}</b><ul>${li(df.added, k => `<li>${esc(k)}</li>`)}</ul></div>
  <div><b class="chg">変更 ${df.changed.length}</b><ul>${li(df.changed, ([k, c]) => `<li>${esc(k)} <span class="count">${esc(c.slice(0, 3).join("・"))}${c.length > 3 ? " ほか" : ""}</span></li>`)}</ul></div>
  <div><b class="neg">今のデータにだけある ${df.removed.length}</b><ul>${li(df.removed, k => `<li>${esc(k)}</li>`)}</ul></div></div>
  ${newCols.length ? `<p class="hint">新しい列：${esc(newCols.join("、"))}</p>` : ""}
  <div class="row2"><button class="btn primary" data-io="merge" ${IO.busy ? "disabled" : ""}>追加・変更を反映（${df.added.length + df.changed.length}件）</button>${IO.confirm === "replace" ? `<span class="danger-q">${df.removed.length}件が消えます。よろしいですか？</span><button class="btn small danger" data-io="replaceyes">丸ごと置き換える</button><button class="btn small" data-io="no">やめる</button>` : `<button class="btn" data-io="replace">貼り付けた内容で丸ごと置き換え（${inc.rows.length}件）</button>`}</div>
  <p class="hint">「追加・変更を反映」は今のデータにだけある行を残します。丸ごと置き換えると、それらの行は消えます。</p>`;
}
function toTSV(d) { const q = v => /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; return [d.headers, ...d.rows].map(r => r.map(x => q(String(x || ""))).join("\t")).join("\n"); }
function toCSV(d) { const q = v => /[,\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; return "﻿" + [d.headers, ...d.rows].map(r => r.map(x => q(String(x || ""))).join(",")).join("\r\n"); }
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
let JSZIP = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (JSZIP) return JSZIP;
  JSZIP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = () => res(window.JSZip); s.onerror = () => { JSZIP = null; rej(new Error("jszip")); }; document.head.appendChild(s); });
  return JSZIP;
}
const staticJson = p => fetch(p, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
async function ioAction(a, btn) {
  const k = IO.k;
  if (a === "copy") { const s = toTSV(curData(k)); try { await navigator.clipboard.writeText(s); toast(`${curData(k).rows.length}件をコピーしました`); } catch (e) { IO.text = s; renderIO(); toast("コピーできなかったので、読み込み欄に表示しました", 5000); } return; }
  if (a === "csv") { download(`rxrdb-${k}.csv`, new Blob([toCSV(curData(k))], { type: "text/csv" })); return; }
  if (a === "ghdata") {
    try { const Z = await loadJSZip(); const z = new Z(); TABLES.forEach(t => { const d = curData(t); if (d.headers.length) z.file(`data/${t}.json`, JSON.stringify({ headers: d.headers, rows: d.rows }, null, 1)); });
      z.file("data/news.json", JSON.stringify(NEWSLIST, null, 1));
      z.file("data/tiers.json", JSON.stringify({ tiers: TIERPUB, at: now() }, null, 1));
      download(`rxrdb-data-${R.jstDay()}.zip`, await z.generateAsync({ type: "blob" })); toast("data/*.json を書き出しました"); }
    catch (e) { toast("ZIP を作れませんでした。通信状態を確認してください", 5000); } return;
  }
  if (a === "publish") { try { for (const t of TABLES) await publish(t, true); toast("公開データを更新しました"); } catch (e) { toast(fbErr(e), 5000); } return; }
  if (a === "no") { IO.confirm = null; renderIO(); return; }
  if (a === "loadgh") { try { const d = await staticJson(`data/${k}.json`); IO.text = toTSV(d); IO.hr = 0; IO.confirm = null; renderIO(); window.scrollTo(0, 0); toast(`data/${k}.json（${d.rows.length}件）を読み込みました。差分を確認してください`, 5000); } catch (e) { toast("data/" + k + ".json を読み込めませんでした"); } return; }
  if (a === "restore" || a === "replace") { IO.confirm = a; if (a === "replace") document.getElementById("iopv").innerHTML = ioPreview(); else renderIO(); return; }
  IO.busy = true; if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }
  try {
    if (a === "seed") {
      for (const t of TABLES) { if (seeded(t)) continue; const d = await staticJson(`data/${t}.json`); await applyTable(t, d, "replace", "seed"); }
      toast("初期データを登録しました。数秒で公開データも作られます", 5000);
    } else if (a === "restoreyes") {
      const d = await staticJson(`data/${k}.json`); const r = await applyTable(k, d, "replace", "restore");
      toast(`置き換えました（追加${r.added}・変更${r.changed}・削除${r.removed}）`, 5000);
    } else if (a === "merge" || a === "replaceyes") {
      const inc = ioParsed(); if (!inc) throw new Error("no data");
      const r = await applyTable(k, inc, a === "merge" ? "merge" : "replace");
      IO.text = ""; IO.hr = -1;
      toast(`${TLABEL[k]}データを保存しました（追加${r.added}・変更${r.changed}${a === "merge" ? "" : `・削除${r.removed}`}）`, 5000);
    }
  } catch (e) { toast(fbErr(e), 6000); }
  IO.busy = false; IO.confirm = null; renderIO();
}

/* ================= images ================= */
const IM = { k: "char", files: [], busy: false, cq: "" };
const IKIND = { char: "キャラ", script: "スクリプト", icon: "アイコン", hero: "ヘッダー背景" };
const ICON_ALIAS = { "アタッカー": ["attacker", "attaker", "atk"], "シューター": ["shooter"], "ブレイカー": ["breaker"], "ヒーラー": ["healer"], "トリックスター": ["trickster", "trickstar"], "サポーター": ["supporter", "support"], "ブレイドライン": ["bladeline"], "千紫": ["colors", "senshi"], "Mazlab": ["maze", "mazlab", "mazelab"], "第六起源魔術教会": ["sixth"], "リンドブルム": ["lindwurm", "lindblum"], "オッター貿易": ["otter"], "アクシオンゲート": ["axiongate", "axion"], "ORANGE": ["orange"] };
function targets(k) {
  if (k === "char") return R.CH.map(c => ({ key: c.id, label: c.name, alts: [c.id, c.name, c.base + (c.style || "")] }));
  if (k === "script") { const seen = new Set(); return R.SC.filter(s => s.name && !seen.has(s.name) && seen.add(s.name)).map(s => ({ key: s.name, label: s.name, alts: [s.name] })); }
  if (k === "icon") return [...R.ATTRS, ...R.ROLES, ...R.RANKS, ...R.ORDERS].map(x => ({ key: x, label: x, alts: [x, ...(ICON_ALIAS[x] || [])] }));
  return [{ key: "main", label: "ヘッダー背景", alts: ["main", "header", "hero"] }];
}
const READ = [["一番", "いちばん"], ["可愛", "かわい"], ["全て", "すべて"], ["出来", "でき"], ["下さい", "ください"], ["貴方", "あなた"], ["僕", "ぼく"], ["私", "わたし"], ["御用心", "ごようじん"], ["ご用心", "ごようじん"], ["綺譚", "奇譚"], ["見て", "みて"]];
const ROMAN = { "iii": "3", "ii": "2", "iv": "4", "vi": "6", "v": "5", "i": "1" };
function norm(s) {
  s = String(s || "").normalize("NFKC").toLowerCase().replace(/\.(png|jpe?g|webp|gif|bmp|avif)$/, "").replace(/defalut|defualt/g, "default");
  for (const [k, v] of READ) s = s.split(k).join(v);
  s = s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/(^|[^a-z])(iii|ii|iv|vi|v|i)$/, (m, a, b) => a + ROMAN[b]);
  s = s.replace(/[ーｰ―‐\-–—]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  return s;
}
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; }
function sim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const na = (a.match(/\d+$/) || [""])[0], nb = (b.match(/\d+$/) || [""])[0];
  let s; const sa = a.length < b.length ? a : b, lb = a.length < b.length ? b : a;
  if (sa.length >= 4 && lb.includes(sa)) s = 0.75 + 0.2 * sa.length / lb.length;
  else { const A = bigrams(a), B = bigrams(b); let inter = 0; A.forEach((v, k) => { if (B.has(k)) inter += Math.min(v, B.get(k)); }); s = (2 * inter) / Math.max(1, (a.length - 1) + (b.length - 1)); }
  if (na !== nb) s *= (na && nb) ? 0.35 : 0.8;
  return Math.min(s, 0.99);
}
function scoreFile(name, tg) { const n = norm(name); let best = 0; tg.alts.forEach(a => { best = Math.max(best, sim(n, norm(a))); }); return best; }
function hasImage(k, key) { return k === "char" ? !!R.BASE.IMG[key] : k === "script" ? !!R.BASE.SIMG[key] : k === "icon" ? !!R.BASE.ICON[key] : !!R.BASE.HERO; }
function matchAll() {
  const tg = targets(IM.k);
  IM.files.forEach(f => { f.cands = tg.map(t => ({ key: t.key, label: t.label, s: scoreFile(f.name, t) })).sort((a, b) => b.s - a.s).slice(0, 8); });
  const pairs = []; IM.files.forEach((f, fi) => f.cands.forEach(c => pairs.push([c.s, fi, c.key])));
  pairs.sort((a, b) => b[0] - a[0]); const usedT = new Set(), usedF = new Set();
  IM.files.forEach(f => { if (!f.manual) f.key = ""; });
  pairs.forEach(([s, fi, key]) => { const f = IM.files[fi]; if (f.manual || usedF.has(fi) || usedT.has(key) || s < 0.45) return; f.key = key; f.score = s; usedF.add(fi); usedT.add(key); });
  IM.files.forEach(f => { f.on = f.on == null ? !!f.key && f.score >= 0.6 : f.on && !!f.key; });
}
function renderImg() {
  const tg = targets(IM.k); const has = tg.filter(t => hasImage(IM.k, t.key)); const miss = tg.filter(t => !hasImage(IM.k, t.key));
  let h = userBar() + `<div class="toolbar"><h2><small>IMAGES</small>画像</h2><div class="seg">${Object.keys(IKIND).map(k => `<button data-imk="${k}" aria-pressed="${IM.k === k}">${IKIND[k]}</button>`).join("")}</div>${tg.length > 1 ? `<span class="count">画像あり ${has.length} / ${tg.length}</span>` : ""}</div>`;
  let tail = "";
  if (tg.length > 1) tail += `<section class="apanel"><h3 class="ph">画像がないもの（${miss.length}）</h3>${miss.length ? `<div class="misslist">${miss.map(t => `<span>${esc(t.label)}</span>`).join("")}</div>` : `<p class="hint" style="margin:0">すべて画像があります。</p>`}</section>`;
  h += ghPanel() + `<section class="apanel"><h3 class="ph">画像をアップロード</h3>
  <p class="hint" style="margin-top:0">ここに画像を入れると、${IM.k === "char" ? "ファイル名をキャラID（例：カノン_DEFAULT）やキャラ名と照らし合わせて" : IM.k === "script" ? "ファイル名とスクリプト名の表記ゆれ（全角半角・記号・カタカナひらがな・末尾の番号など）を吸収して" : IM.k === "icon" ? "属性・ロール・階級・騎士団名（英語のファイル名にも対応）と照らし合わせて" : ""}割り当てます。割り当てを確認して${GH ? "「アップロード」を押すと、サイズを整えて GitHub に保存されます（サムネイルは自動で切り抜きます。ずれていたら「データ編集」で行を開いて調整してください）。" : "「ZIP にまとめる」で書き出し、GitHub に上書きアップロードしてください。"}</p>
  <label class="drop" id="drop"><input type="file" id="imfiles" accept="image/*" ${IM.k === "hero" ? "" : "multiple"}><span>画像ファイルを選ぶか、ここにドラッグ</span></label>`;
  if (IM.files.length) {
    const cnt = {}; IM.files.forEach(f => { if (f.key) cnt[f.key] = (cnt[f.key] || 0) + 1; });
    const on = IM.files.filter(f => f.on && f.key && f.status !== "done").length;
    h += `<div class="mtbl"><div class="mrow mh"><span></span><span>ファイル</span><span>割り当て先</span><span>判定</span></div>${IM.files.map((f, i) => {
      const st = f.status === "done" ? `<span class="mb ok">アップロード済み</span>` : !f.key ? `<span class="mb bad">未割り当て</span>` : f.manual ? `<span class="mb ok">手動</span>` : f.score >= 0.97 ? `<span class="mb ok">一致</span>` : f.score >= 0.6 ? `<span class="mb mid">近い ${Math.round(f.score * 100)}%</span>` : `<span class="mb bad">要確認 ${Math.round(f.score * 100)}%</span>`;
      const warn = f.key && cnt[f.key] > 1 ? `<small class="err">同じ割り当て先が複数あります</small>` : f.key && hasImage(IM.k, f.key) ? `<small class="count">今の画像を置き換えます</small>` : "";
      return `<div class="mrow"><label class="ck"><input type="checkbox" data-imon="${i}" ${f.on ? "checked" : ""} ${!f.key ? "disabled" : ""}><img src="${f.url}" alt=""></label><span class="fname">${esc(f.name)}</span>
      <span><select data-imkey="${i}"><option value="">（割り当てない）</option><optgroup label="候補">${f.cands.map(c => `<option value="${esc(c.key)}" ${c.key === f.key ? "selected" : ""}>${esc(c.label)}（${Math.round(c.s * 100)}%）</option>`).join("")}</optgroup><optgroup label="すべて">${tg.map(t => `<option value="${esc(t.key)}" ${!f.cands.some(c => c.key === f.key) && t.key === f.key ? "selected" : ""}>${esc(t.label)}${hasImage(IM.k, t.key) ? "" : "　※画像なし"}</option>`).join("")}</optgroup></select>${warn}</span><span>${st}</span></div>`;
    }).join("")}</div>
    <div class="row2">${GH ? `<button class="btn primary" data-im="upload" ${on && !IM.busy ? "" : "disabled"}>チェックした ${on} 件をアップロード</button>` : ""}<button class="btn ${GH ? "" : "primary"}" data-im="zip" ${on && !IM.busy ? "" : "disabled"}>チェックした ${on} 件を ZIP にまとめる</button><button class="btn" data-im="clear">一覧をクリア</button><span class="count">「近い」「要確認」は割り当て先を確認してからチェックを入れてください。</span></div>`;
  }
  h += `</section>`;
  h += tail;
  AM.innerHTML = h;
  const inp = document.getElementById("imfiles"); inp.addEventListener("change", () => addFiles(inp.files));
  const cq = document.getElementById("cropq"); if (cq) R.liveInput(cq, () => { IM.cq = cq.value; const p = cq.selectionStart; renderImg(); const n = document.getElementById("cropq"); n.focus(); n.setSelectionRange(p, p); });
  const dr = document.getElementById("drop");
  dr.addEventListener("dragover", e => { e.preventDefault(); dr.classList.add("over"); }); dr.addEventListener("dragleave", () => dr.classList.remove("over"));
  dr.addEventListener("drop", e => { e.preventDefault(); dr.classList.remove("over"); addFiles(e.dataTransfer.files); });
  AM.querySelectorAll("[data-imkey]").forEach(s => s.addEventListener("change", () => { const f = IM.files[+s.dataset.imkey]; f.key = s.value; f.manual = !!s.value; f.score = 1; f.on = !!s.value; renderImg(); }));
  AM.querySelectorAll("[data-imon]").forEach(c => c.addEventListener("change", () => { IM.files[+c.dataset.imon].on = c.checked; renderImg(); }));
}
function addFiles(list) {
  [...list].filter(f => /^image\//.test(f.type)).forEach(f => IM.files.push({ file: f, name: f.name, url: URL.createObjectURL(f), key: "", score: 0, on: null, manual: false }));
  if (IM.k === "hero" && IM.files.length > 1) IM.files = IM.files.slice(-1);
  matchAll(); renderImg();
}
function loadImg(file) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
const safeName = s => String(s).replace(/[\\/:*?"<>|#%\s]/g, "_");
// 画像を Web 用に変換 → [{path, blob}] と images.json への書き込み内容を返す
async function processImage(kind, key, file) {
  const im = await loadImg(file); const W = im.naturalWidth, H = im.naturalHeight; const fit = mw => { const s = Math.min(1, mw / W); return [W * s, H * s]; };
  const nm = safeName(key); const files = []; const set = {}; const local = {};
  if (kind === "icon") { const s = Math.min(1, 96 / Math.max(W, H)); const p = `images/icons/${nm}.png`; const b = await R.canvasBlob(im, 0, 0, W, H, W * s, H * s, "image/png"); files.push({ path: p, blob: b }); set.icons = p; local.icons = b; }
  else if (kind === "hero") { const [dw, dh] = fit(1800); const b = await R.canvasBlob(im, 0, 0, W, H, dw, dh, "image/webp", .82); files.push({ path: "images/hero.webp", blob: b }); set.hero = "images/hero.webp"; local.hero = b; }
  else {
    const dir = kind === "char" ? "images/chars" : "images/scripts"; const [dw, dh] = fit(kind === "char" ? 1200 : 720);
    const full = await R.canvasBlob(im, 0, 0, W, H, dw, dh, "image/webp", .82);
    let side, sx, sy;
    if (W > H * 1.2) { side = H * 0.46; sx = W / 2 - side / 2; sy = H * 0.08; } else { side = Math.min(W, H) * 0.9; sx = (W - side) / 2; sy = Math.min(H - side, H * 0.04); }
    const thumb = await R.canvasBlob(im, sx, sy, side, side, 176, 176, "image/webp", .85);
    files.push({ path: `${dir}/${nm}.webp`, blob: full }, { path: `${dir}/thumb/${nm}.webp`, blob: thumb });
    if (kind === "char") { set.banners = `${dir}/${nm}.webp`; set.thumbs = `${dir}/thumb/${nm}.webp`; local.banners = full; local.thumbs = thumb; }
    else { set.sfull = `${dir}/${nm}.webp`; set.sthumbs = `${dir}/thumb/${nm}.webp`; local.sfull = full; local.sthumbs = thumb; }
  }
  return { kind, key, name: file.name, files, set, local };
}
// すでに images.json に登録がある画像は、同じファイル名に上書きする（古いファイルを残さない）
function reusePaths(json, items) {
  items.forEach(it => Object.entries(it.set).forEach(([sec, p]) => {
    const old = sec === "hero" ? json.hero : (json[sec] || {})[it.key];
    if (!old || old === p || old.split(".").pop() !== p.split(".").pop() || !/^images\//.test(old)) return;
    it.files.forEach(f => { if (f.path === p) f.path = old; }); it.set[sec] = old;
  }));
}
function applyImagesJson(json, items) {
  items.forEach(it => Object.entries(it.set).forEach(([sec, p]) => { if (sec === "hero") json.hero = p; else { json[sec] = json[sec] || {}; json[sec][it.key] = p; } }));
  return json;
}
// アップロード直後は GitHub Pages の反映（1分ほど）を待たずに、手元の画像で表示する
function showLocal(items) {
  const MAP = { thumbs: "IMG", banners: "BANNER", icons: "ICON", sthumbs: "SIMG", sfull: "SFULL" };
  items.forEach(it => Object.entries(it.local).forEach(([sec, b]) => { const u = URL.createObjectURL(b); if (sec === "hero") R.BASE.HERO = u; else R.BASE[MAP[sec]][it.key] = u; }));
  R.applyMedia(); R.rebuild();
}
/* ---- GitHub への直接アップロード（オーナーが secrets/github にトークンを登録） ---- */
async function gh(path, opt) {
  opt = opt || {};
  const r = await fetch("https://api.github.com/repos/" + GH.repo + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + GH.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, opt.body ? { "Content-Type": "application/json" } : {}) }));
  if (!r.ok) { const e = new Error("GitHub " + r.status); e.status = r.status; try { e.detail = (await r.json()).message; } catch (_) { } throw e; }
  return r.status === 204 ? null : r.json();
}
async function b64(blob) { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
function ghErr(e) {
  if (e && e.status === 401) return "GitHub のトークンが無効か期限切れです。オーナーが「画像」タブで登録し直してください";
  if (e && (e.status === 403 || e.status === 404)) return "GitHub に書き込む権限がありません（トークンの対象リポジトリと Contents の Read and write を確認してください）";
  return "GitHub へのアップロードに失敗しました：" + (e && (e.detail || e.message) || "");
}
async function ghCommit(items, progress) {
  const br = GH.branch || "main";
  let n = 0; const total = items.reduce((a, it) => a + it.files.length, 0);
  for (const it of items) for (const f of it.files) {
    const b = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: await b64(f.blob), encoding: "base64" }) });
    f.sha = b.sha; progress && progress(++n, total);
  }
  const msg = `画像を${items.length === 1 ? "更新" : items.length + "件追加・更新"}：${items.slice(0, 5).map(i => i.key).join("、")}${items.length > 5 ? " ほか" : ""}\n\n管理画面から ${meName()}（${me()}）`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await gh(`/git/ref/heads/${br}`); const base = ref.object.sha;
    const commit = await gh(`/git/commits/${base}`);
    let json = {}; try { json = JSON.parse(unb64((await gh(`/contents/data/images.json?ref=${base}`)).content)); } catch (e) { if (e.status !== 404) throw e; }
    reusePaths(json, items); applyImagesJson(json, items);
    const tree = []; items.forEach(it => it.files.forEach(f => tree.push({ path: f.path, mode: "100644", type: "blob", sha: f.sha })));
    const t = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree: tree.concat([{ path: "data/images.json", mode: "100644", type: "blob", content: JSON.stringify(json, null, 1) + "\n" }]) }) });
    const c = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message: msg, tree: t.sha, parents: [base] }) });
    try { await gh(`/git/refs/heads/${br}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) }); return c; }
    catch (e) { if (e.status === 422 && attempt < 2) continue; throw e; }
  }
}
async function uploadItems(items, btn, label) {
  const old = btn ? btn.textContent : "";
  const prog = (a, b) => { if (btn) btn.textContent = `${label || "アップロード中"}… ${a}/${b}`; };
  const c = await ghCommit(items, prog);
  await F.setDoc(F.doc(F.db, "log", rid()), logDoc({ act: "image", k: items[0].kind === "char" ? "chars" : items[0].kind === "script" ? "scripts" : "", label: `画像：${items.map(i => i.key).join("、").slice(0, 300)}`, commit: c && c.sha }));
  showLocal(items);
  if (btn) btn.textContent = old;
  return c;
}
async function quickUpload(kind, key, file) {
  if (!GH) { toast(S.role === "owner" ? "先に「画像」タブで GitHub 連携を設定してください" : "GitHub 連携がまだ設定されていません。オーナーに設定してもらってください", 5000); return; }
  toast("画像を変換してアップロードしています…", 20000);
  try { const it = await processImage(kind, key, file); await uploadItems([it]); toast("画像をアップロードしました。公開サイトには1〜2分で反映されます", 5000); if (DLG && DLG.open && !ED.dirty) renderForm(); }
  catch (e) { toast(e && e.status ? ghErr(e) : "画像を処理できませんでした", 6000); }
}
async function buildImageZip(btn) {
  const todo = IM.files.filter(f => f.on && f.key);
  IM.busy = true; btn.disabled = true; btn.textContent = "変換中…";
  try {
    const Z = await loadJSZip(); const z = new Z();
    const json = await staticJson("data/images.json").catch(() => ({}));
    const items = [];
    for (const f of todo) { items.push(await processImage(IM.k, f.key, f.file)); btn.textContent = `変換中… ${items.length}/${todo.length}`; }
    reusePaths(json, items); items.forEach(it => it.files.forEach(x => z.file(x.path, x.blob)));
    z.file("data/images.json", JSON.stringify(applyImagesJson(json, items), null, 1));
    z.file("README.txt", `RxRDB 画像追加 ${R.jstDay()}\n\nこの ZIP の中身（images/ と data/images.json）を、リポジトリ negiramen1922/RxRDB のルートに上書きしてください。\nGitHub の画面なら「Add file → Upload files」にフォルダごとドラッグして Commit すると公開されます。\n\n${todo.map(f => `${f.name} → ${f.key}`).join("\n")}\n`);
    download(`rxrdb-images-${R.jstDay()}.zip`, await z.generateAsync({ type: "blob" }));
    toast(`${items.length}件の画像を ZIP にまとめました`, 4000);
  } catch (e) { toast("ZIP を作れませんでした：" + (e && e.message || ""), 5000); }
  IM.busy = false; renderImg();
}
async function uploadChecked(btn) {
  const todo = IM.files.filter(f => f.on && f.key && f.status !== "done");
  if (!todo.length || !GH) return;
  IM.busy = true; btn.disabled = true;
  try {
    const items = [];
    for (const f of todo) { btn.textContent = `変換中… ${items.length + 1}/${todo.length}`; items.push(await processImage(IM.k, f.key, f.file)); }
    await uploadItems(items, btn);
    todo.forEach(f => { f.status = "done"; f.on = false; });
    toast(`${items.length}件の画像をアップロードしました。公開サイトには1〜2分で反映されます`, 6000);
  } catch (e) { toast(e && e.status ? ghErr(e) : "画像を処理できませんでした：" + (e && e.message || ""), 7000); }
  IM.busy = false; renderImg();
}
async function saveGhToken() {
  const token = (document.getElementById("ghtoken").value || "").trim();
  const repo = (document.getElementById("ghrepo").value || "").trim() || "negiramen1922/RxRDB";
  if (!token) return toast("トークンを貼り付けてください");
  const prev = GH; GH = { token, repo, branch: "main" };
  try { await gh(""); await gh("/git/ref/heads/main"); }
  catch (e) { GH = prev; toast(e.status === 401 ? "トークンが正しくないようです" : e.status === 404 ? "リポジトリが見つかりません（トークンの対象リポジトリを確認してください）" : ghErr(e), 6000); return; }
  try { await F.setDoc(F.doc(F.db, "secrets", "github"), { token, repo, branch: "main", at: now(), by: me() }); toast("GitHub 連携を保存しました"); }
  catch (e) { GH = prev; toast(fbErr(e) + "（Firestore のルールを最新にしてください）", 7000); }
}
async function delGhToken() { try { await F.deleteDoc(F.doc(F.db, "secrets", "github")); toast("GitHub 連携を解除しました"); } catch (e) { toast(fbErr(e)); } }
function ghPanel() {
  if (GH) return `<div class="astatus ok">GitHub 連携：<b>${esc(GH.repo)}</b> に直接アップロードできます。アップロードした画像は公開サイトに1〜2分で反映されます。${S.role === "owner" ? ` <button class="btn small" data-a="ghedit">トークンを変更</button>${IM.ghconfirm ? `<span class="danger-q">解除しますか？</span><button class="btn small danger" data-a="ghdelyes">解除</button><button class="btn small" data-a="ghdelno">やめる</button>` : `<button class="btn small" data-a="ghdel">連携を解除</button>`}` : ""}</div>${S.role === "owner" && IM.ghedit ? ghForm() : ""}`;
  if (S.role !== "owner") return `<div class="astatus warn">オーナーが GitHub 連携を設定すると、ここから画像を直接アップロードできます。今は「ZIP にまとめる」で書き出して GitHub に上げてください。</div>`;
  return `<section class="apanel seed"><h3 class="ph">GitHub 連携（画像の直接アップロード）</h3>${ghForm()}</section>`;
}
function ghForm() {
  return `<ol class="steps"><li>GitHub 右上のアイコン → <b>Settings</b> → 左下 <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b></li>
  <li>Token name は「RxRDB 画像」など、Expiration は1年（期限が来たらここで登録し直し）</li>
  <li><b>Repository access</b> → <b>Only select repositories</b> → <b>RxRDB</b> を選ぶ</li>
  <li><b>Permissions</b> → Repository permissions → <b>Contents</b> を <b>Read and write</b> にして作成</li>
  <li>表示されたトークン（github_pat_…）を下に貼って保存</li></ol>
  <p class="hint">トークンは Firestore に保存され、メンバー全員がアップロードに使えます（メンバー以外は読めません）。RxRDB 以外のリポジトリには使えないよう、必ず「Only select repositories」で作ってください。</p>
  <div class="addcol"><input id="ghtoken" type="password" placeholder="github_pat_…" autocomplete="off"><input id="ghrepo" value="${esc(GH ? GH.repo : "negiramen1922/RxRDB")}" style="max-width:220px"><button class="btn primary small" data-a="ghsave">確認して保存</button></div>`;
}

/* thumbnail crop editor (saved to public/crops, applied on the public site) */
function autoCrop(W, H) { if (W > H * 1.2) { const cs = .46; return { cs, cx: Math.max(0, .5 - cs * H / W / 2), cy: .08 }; } const s = Math.min(W, H) * .9; return { cs: s / H, cx: (W - s) / 2 / W, cy: Math.min(H - s, H * .04) / H }; }
const CR = { kind: "", key: "", c: null, W: 0, H: 0, drag: null };
async function saveCrop(id, val) {
  await F.runTransaction(F.db, async tx => {
    const ref = F.doc(F.db, "public", "crops"); const s = await tx.get(ref);
    let m = {}; try { m = s.exists() && s.data().json ? JSON.parse(s.data().json) : {}; } catch (e) { }
    if (val) m[id] = val; else delete m[id];
    tx.set(ref, { json: JSON.stringify(m), at: now(), by: me(), count: Object.keys(m).length });
    tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "crop", k: CR.kind === "char" ? "chars" : "scripts", label: `サムネイル位置：${CR.label}${val ? "" : "（自動に戻す）"}` }));
  });
}
function openCrop(kind, key) {
  const src = R.cropSrc(kind, key); if (!src) { toast("元の画像がないため調整できません"); return; }
  const id = "c_" + kind + "_" + R.hashId(key); const cur = R.CROPS[id];
  const label = kind === "char" ? (R.CHMAP[key] ? R.CHMAP[key].name : key) : key;
  Object.assign(CR, { kind, key, id, label, c: null });
  document.getElementById("cropBody").innerHTML = `<h2>${esc(label)}</h2><p class="hint" style="margin:0 0 10px">四角をドラッグして顔の位置に合わせ、スライダーで大きさを変えてください。</p>
  <div class="cropwrap" id="cropWrap"><img id="cropImg" src="${esc(src)}" alt="" draggable="false"><div id="cropBox"></div></div>
  <div class="croprow"><label class="inl" for="cropSize">大きさ</label><input type="range" id="cropSize" min="12" max="100" step="1"><canvas id="cropPrev" width="96" height="96"></canvas></div>
  <div class="foot">${cur ? `<button class="btn" id="cropReset">自動の位置に戻す</button>` : ""}<span style="flex:1"></span><button class="btn" data-close>キャンセル</button><button class="btn primary" id="cropSave">保存</button></div>`;
  const dl = document.getElementById("dlgCrop"); if (!dl.open) dl.showModal();
  const img = document.getElementById("cropImg"), box = document.getElementById("cropBox"), sz = document.getElementById("cropSize");
  const draw = () => { if (!CR.c) return; const s = img.clientWidth / CR.W; box.style.left = CR.c.cx * CR.W * s + "px"; box.style.top = CR.c.cy * CR.H * s + "px"; box.style.width = box.style.height = CR.c.cs * CR.H * s + "px";
    const cv = document.getElementById("cropPrev"); const x = cv.getContext("2d"); x.clearRect(0, 0, 96, 96); const side = CR.c.cs * CR.H; x.drawImage(img, CR.c.cx * CR.W, CR.c.cy * CR.H, side, side, 0, 0, 96, 96); };
  const clamp = () => { const c = CR.c; const maxS = Math.min(1, CR.W / CR.H); c.cs = Math.min(Math.max(c.cs, .08), maxS); c.cx = Math.min(Math.max(c.cx, 0), 1 - c.cs * CR.H / CR.W); c.cy = Math.min(Math.max(c.cy, 0), 1 - c.cs); };
  const init = () => { CR.W = img.naturalWidth; CR.H = img.naturalHeight; CR.c = cur ? { cx: cur.cx, cy: cur.cy, cs: cur.cs } : autoCrop(CR.W, CR.H); clamp(); sz.value = Math.round(CR.c.cs / Math.min(1, CR.W / CR.H) * 100); draw(); };
  if (img.complete && img.naturalWidth) init(); else img.onload = init;
  const toImg = e => { const r = img.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * CR.W, (e.clientY - r.top) / r.height * CR.H]; };
  const wrap = document.getElementById("cropWrap");
  wrap.addEventListener("pointerdown", e => { if (!CR.c) return; e.preventDefault(); const [px, py] = toImg(e); const c = CR.c; const side = c.cs * CR.H;
    const inside = px >= c.cx * CR.W && px <= c.cx * CR.W + side && py >= c.cy * CR.H && py <= c.cy * CR.H + side;
    if (!inside) { c.cx = (px - side / 2) / CR.W; c.cy = (py - side / 2) / CR.H; clamp(); draw(); }
    CR.drag = { px, py, cx: c.cx, cy: c.cy }; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener("pointermove", e => { if (!CR.drag) return; const [px, py] = toImg(e); CR.c.cx = CR.drag.cx + (px - CR.drag.px) / CR.W; CR.c.cy = CR.drag.cy + (py - CR.drag.py) / CR.H; clamp(); draw(); });
  wrap.addEventListener("pointerup", () => { CR.drag = null; }); wrap.addEventListener("pointercancel", () => { CR.drag = null; });
  sz.addEventListener("input", () => { const c = CR.c; if (!c) return; const midx = c.cx * CR.W + c.cs * CR.H / 2, midy = c.cy * CR.H + c.cs * CR.H / 2; c.cs = sz.value / 100 * Math.min(1, CR.W / CR.H); c.cx = (midx - c.cs * CR.H / 2) / CR.W; c.cy = (midy - c.cs * CR.H / 2) / CR.H; clamp(); draw(); });
  document.getElementById("cropSave").addEventListener("click", async e => { if (!CR.c) return; e.target.disabled = true;
    try { await saveCrop(CR.id, { kind: CR.kind, key: CR.key, cx: +CR.c.cx.toFixed(4), cy: +CR.c.cy.toFixed(4), cs: +CR.c.cs.toFixed(4) }); dl.close(); toast("サムネイルの位置を保存しました"); }
    catch (er) { e.target.disabled = false; toast(fbErr(er)); } });
  const rs = document.getElementById("cropReset"); if (rs) rs.addEventListener("click", async () => { try { await saveCrop(CR.id, null); dl.close(); toast("自動の位置に戻しました"); } catch (er) { toast(fbErr(er)); } });
}

/* ================= change log ================= */
const LG = { k: "", open: null };
const ACT = { create: "追加", update: "編集", delete: "削除", import: "読み込み", seed: "初期登録", restore: "置き換え", columns: "列", crop: "サムネイル", revert: "元に戻す", members: "メンバー", image: "画像", news: "お知らせ", tier: "Tier表", options: "選択肢" };
function renderLog() {
  const list = LOG.filter(l => !LG.k || l.k === LG.k);
  let h = userBar() + `<div class="toolbar"><h2><small>HISTORY</small>変更履歴</h2><div class="seg"><button data-lgk="" aria-pressed="${!LG.k}">すべて</button>${TABLES.map(k => `<button data-lgk="${k}" aria-pressed="${LG.k === k}">${TLABEL[k]}</button>`).join("")}</div><span class="count">新しい順に最大150件</span></div>`;
  h += `<div class="loglist">${list.map(l => {
    const chs = l.ch ? Object.keys(l.ch) : [];
    const canRevert = !!l.rowid && ((l.act === "update" && chs.length) || l.act === "delete" || l.act === "create");
    const open = LG.open === l.id;
    return `<div class="logrow${open ? " open" : ""}"><button class="loghead" data-lgopen="${esc(l.id)}"><span class="lt">${esc(fmtTime(l.at))}</span><span class="la a-${esc(l.act)}">${esc(ACT[l.act] || l.act)}</span><span class="lk">${esc(TLABEL[l.k] || "")}</span><span class="ll">${esc(l.label || "")}${chs.length ? `<small class="count"> ${esc(chs.slice(0, 4).join("・"))}${chs.length > 4 ? " ほか" : ""}</small>` : ""}</span><span class="lb">${esc(l.name || shortName(l.by))}</span></button>
    ${open ? `<div class="logbody">${chs.length ? `<table class="chtbl"><tr><th>項目</th><th>変更前</th><th>変更後</th></tr>${chs.map(c => `<tr><th>${esc(c)}</th><td>${esc(l.ch[c][0])}</td><td>${esc(l.ch[c][1])}</td></tr>`).join("")}</table>` : ""}${l.row && !chs.length ? `<p class="count">${esc(Object.entries(l.row).filter(([, v]) => v).slice(0, 8).map(([k, v]) => `${k}：${String(v).slice(0, 40)}`).join(" ／ "))}</p>` : ""}
    ${canRevert ? `<div class="row2"><button class="btn small" data-lgrevert="${esc(l.id)}">${l.act === "delete" ? "この行を復元する" : l.act === "create" ? "この追加を取り消す（行を削除）" : "この変更を元に戻す"}</button></div>` : ""}</div>` : ""}</div>`;
  }).join("") || '<p class="count">まだ履歴がありません</p>'}</div>`;
  AM.innerHTML = h;
}
async function revertLog(id) {
  const l = LOG.find(x => x.id === id); if (!l) return;
  if (!l.rowid) return;
  try {
    await F.runTransaction(F.db, async tx => {
      const r = F.doc(F.db, "tables", l.k, "rows", l.rowid);
      const s = await tx.get(r);
      if (l.act === "delete") {
        if (s.exists()) throw { message: "この行はすでにあります" };
        tx.set(r, { c: l.row, o: l.o || 0, t: now(), by: me(), rev: rid() });
      } else if (l.act === "create") {
        if (!s.exists()) throw { message: "この行はすでにありません" };
        tx.delete(r);
      } else {
        if (!s.exists()) throw { message: "この行は削除されています" };
        const c = Object.assign({}, s.data().c || {}); Object.keys(l.ch).forEach(h => { c[h] = l.ch[h][0]; });
        tx.set(r, Object.assign({}, s.data(), { c, t: now(), by: me(), rev: rid() }));
      }
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "revert", k: l.k, rowid: l.rowid, label: `${l.label}（${fmtTime(l.at)} の${ACT[l.act]}を取り消し）` }));
    });
    toast("元に戻しました");
  } catch (e) { toast(e && e.message && !e.code ? e.message : fbErr(e), 5000); }
}

/* ================= official tier (運営のTier表) ================= */
function applyOfficial(at) {
  const o = JSON.parse(JSON.stringify(TIERPUB));
  TIERPEND.forEach(([fk, id, t]) => { const P = o[fk] || (o[fk] = {}); if (t) P[id] = t; else delete P[id]; });
  R.setOfficial(o, at);
}
function floorLabel(fk) { const [t, f] = String(fk).split("|"); return `${t} ${f}F`; }
const TIERQ = { busy: false, q: [] };
function onTierMove(fk, id, tier, prev) {
  const op = [fk, id, tier]; TIERPEND.push(op);
  TIERQ.q.push({ op, prev });
  flushTier();
}
// 連続で動かしても1回のトランザクションにまとめて送る
async function flushTier() {
  if (TIERQ.busy || !TIERQ.q.length) return;
  TIERQ.busy = true;
  const batch = TIERQ.q.splice(0);
  try {
    await F.runTransaction(F.db, async tx => {
      const ref = F.doc(F.db, "public", "tiers"); const s = await tx.get(ref);
      let v = {}; try { v = s.exists() && s.data().json ? JSON.parse(s.data().json) : {}; } catch (e) { }
      const tiers = v.tiers || {};
      batch.forEach(({ op: [fk, id, t] }) => { const P = tiers[fk] || (tiers[fk] = {}); if (t) P[id] = t; else delete P[id]; if (!Object.keys(P).length) delete tiers[fk]; });
      const json = JSON.stringify({ tiers, at: now() });
      tx.set(ref, { json, at: now(), by: me(), count: Object.keys(tiers).length });
      const name = id => R.CHMAP[id] ? R.CHMAP[id].name : id;
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "tier", label: batch.map(({ op: [fk, id, t], prev }) => `${floorLabel(fk)} ${name(id)}：${prev || "未配置"} → ${t || "未配置"}`).join(" ／ ").slice(0, 600) }));
    });
  } catch (e) {
    toast("Tier表を保存できませんでした：" + fbErr(e), 6000);
  }
  batch.forEach(({ op }) => { const i = TIERPEND.indexOf(op); if (i >= 0) TIERPEND.splice(i, 1); });
  TIERQ.busy = false;
  if (TIERQ.q.length) flushTier(); else { applyOfficial(); if (S.tab === "tier") softRender(); }
}
const TT = { confirm: null };
function renderTierTab(soft) {
  if (soft && document.getElementById("admtier")) {
    if (document.querySelector("#admtier .dragging") || (document.activeElement && document.activeElement.id === "poolQ")) return;
    R.renderTier(); const ti = document.getElementById("tierinfo"); if (ti) ti.innerHTML = tierInfo(); return;
  }
  document.getElementById("main").innerHTML = "";
  AM.innerHTML = userBar() + `<div id="tierinfo">${tierInfo()}</div><div id="admtier"></div>`;
  R.setTierEdit(true, onTierMove);
  R.setMain(document.getElementById("admtier"), () => { if (S.tab === "tier") { R.renderTier(); const ti = document.getElementById("tierinfo"); if (ti) ti.innerHTML = tierInfo(); } });
  R.renderTier();
}
function tierInfo() {
  const f = R.curFloor; const fk = f ? f.key : "";
  const local = R.LOCAL_TIERS; const nLocal = Object.values(local).reduce((a, p) => a + Object.keys(p || {}).length, 0);
  const n = Object.keys(R.OFFICIAL[fk] || {}).length;
  return `<div class="astatus ok tierbar"><span>ここで並べた配置は、<b>そのまま公開サイトのTier表になります</b>（数秒で反映）。キャラを選んで下のバーからTierを選ぶか、ドラッグで動かしてください。</span>
  <span class="tieracts">${n ? (TT.confirm === fk ? `<span class="danger-q">${esc(floorLabel(fk))}の配置${n}件をすべて外しますか？</span><button class="btn small danger" data-a="tierclearyes">外す</button><button class="btn small" data-a="tierclearno">やめる</button>` : `<button class="btn small" data-a="tierclear">この階層の配置をすべて外す</button>`) : ""}
  ${nLocal ? (TT.confirm === "import" ? `<span class="danger-q">このブラウザの配置${nLocal}件で、同じキャラの公開中の配置を上書きします。</span><button class="btn small primary" data-a="tierimportyes">取り込む</button><button class="btn small" data-a="tierclearno">やめる</button>` : `<button class="btn small" data-a="tierimport">このブラウザに保存していた配置（${nLocal}件）を取り込む</button>`) : ""}</span></div>`;
}
function tierBulk(ops) { ops.forEach(([fk, id, t]) => { const P = R.OFFICIAL[fk] || (R.OFFICIAL[fk] = {}); const prev = P[id] || ""; if (prev === t) return; if (t) P[id] = t; else delete P[id]; onTierMove(fk, id, t, prev); }); }

/* ================= news (ユーザー向けお知らせ) ================= */
const NW = { edit: null, confirm: null };
function newsBlank() { return { title: "", body: "", cat: "info", date: R.jstDay(), pin: false, renew: false }; }
function renderNews() {
  const list = R.newsSorted(NEWSLIST);
  let h = userBar() + `<div class="toolbar"><h2><small>NEWS</small>お知らせ</h2><span class="count">${list.length}件</span><span style="flex:1"></span>${NW.edit ? "" : `<button class="btn primary" data-nw="new">＋ お知らせを書く</button>`}</div>
  <p class="hint" style="margin:-4px 0 12px">サイト上部の「お知らせ」と、新着バナーに表示されます。公開するとすぐ全員に見えます。</p>`;
  if (NW.edit) {
    const e = NW.edit;
    h += `<section class="apanel nwform"><h3 class="ph">${e.id ? "お知らせを編集" : "新しいお知らせ"}</h3>
    <div class="fields"><div class="field long"><label for="nwTitle">タイトル</label><input id="nwTitle" data-nwf="title" maxlength="100" value="${esc(e.title)}" placeholder="例：Ver.1.2 アップデートのお知らせ"></div>
    <div class="field"><label for="nwCat">種類</label><select id="nwCat" data-nwf="cat">${Object.entries(R.NCAT).map(([k, l]) => `<option value="${k}" ${e.cat === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label for="nwDate">日付</label><input id="nwDate" type="date" data-nwf="date" value="${esc(e.date)}"></div>
    <div class="field"><label>表示</label><label class="ck2"><input type="checkbox" data-nwf="pin" ${e.pin ? "checked" : ""}> 一番上に固定</label></div>
    ${e.id ? `<div class="field"><label>新着</label><label class="ck2"><input type="checkbox" data-nwf="renew" ${e.renew ? "checked" : ""}> もう一度 NEW として知らせる</label></div>` : ""}
    <div class="field long"><label for="nwBody">本文</label><textarea id="nwBody" data-nwf="body" rows="9" maxlength="5000" placeholder="改行はそのまま表示されます。URL は自動でリンクになります。">${esc(e.body)}</textarea></div></div>
    <p class="note-h" style="margin-top:14px">プレビュー</p><div class="nwprev" id="nwPrev">${R.newsItemHtml(Object.assign({ at: now() }, e), 0, true)}</div>
    <div class="formfoot"><span style="flex:1"></span><button class="btn" data-nw="cancel">キャンセル</button><button class="btn primary" data-nw="save">${e.id ? "保存して公開" : "公開する"}</button></div></section>`;
  }
  h += `<div class="nwlist">${list.map(n => `<div class="nwrow">${R.newsItemHtml(n, Infinity, false)}<div class="nwacts"><button class="btn small" data-nwedit="${esc(n.id)}">編集</button>${NW.confirm === n.id ? `<span class="danger-q">削除しますか？</span><button class="btn small danger" data-nwdelyes="${esc(n.id)}">削除</button><button class="btn small" data-nw="delno">やめる</button>` : `<button class="btn small" data-nwdel="${esc(n.id)}">削除</button>`}</div></div>`).join("") || '<p class="count">まだお知らせはありません。</p>'}</div>`;
  AM.innerHTML = h;
  AM.querySelectorAll("[data-nwf]").forEach(el => el.addEventListener("input", () => {
    NW.edit[el.dataset.nwf] = el.type === "checkbox" ? el.checked : el.value;
    const pv = document.getElementById("nwPrev"); if (pv) pv.innerHTML = R.newsItemHtml(Object.assign({ at: now() }, NW.edit), 0, true);
  }));
}
async function saveNews() {
  const e = NW.edit; const title = (e.title || "").trim();
  if (!title) return toast("タイトルを入力してください");
  const item = { id: e.id || "n" + rid(), title: title.slice(0, 100), body: (e.body || "").slice(0, 5000), cat: e.cat || "info", date: e.date || R.jstDay(), pin: !!e.pin };
  try {
    await F.runTransaction(F.db, async tx => {
      const ref = F.doc(F.db, "public", "news"); const s = await tx.get(ref);
      let list = []; try { list = s.exists() && s.data().json ? JSON.parse(s.data().json) : []; } catch (er) { }
      const old = list.find(x => x.id === item.id);
      item.at = old && !e.renew ? (old.at || now()) : now(); item.by = old ? old.by : me();
      list = list.filter(x => x.id !== item.id).concat([item]);
      tx.set(ref, { json: JSON.stringify(list), at: now(), by: me(), count: list.length });
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "news", label: `${old ? "編集" : "公開"}：${item.title}` }));
    });
    NW.edit = null; toast("お知らせを公開しました"); renderNews();
  } catch (er) { toast(fbErr(er), 5000); }
}
async function delNews(id) {
  try {
    await F.runTransaction(F.db, async tx => {
      const ref = F.doc(F.db, "public", "news"); const s = await tx.get(ref);
      let list = []; try { list = s.exists() && s.data().json ? JSON.parse(s.data().json) : []; } catch (er) { }
      const old = list.find(x => x.id === id); if (!old) return;
      list = list.filter(x => x.id !== id);
      tx.set(ref, { json: JSON.stringify(list), at: now(), by: me(), count: list.length });
      tx.set(F.doc(F.db, "log", rid()), logDoc({ act: "news", label: `削除：${old.title}` }));
    });
    NW.confirm = null; toast("削除しました"); renderNews();
  } catch (er) { toast(fbErr(er), 5000); }
}

/* ================= feedback ================= */
const FB = { st: "open", confirm: null };
const FKIND = { bug: "不具合", request: "ご要望", other: "その他" };
const FSTAT = { new: "未対応", doing: "対応中", done: "対応済み", hold: "保留" };
function renderFb() {
  const list = FEEDBACK.filter(f => FB.st === "all" ? true : FB.st === "open" ? (f.status === "new" || f.status === "doing") : f.status === FB.st);
  const c = s => FEEDBACK.filter(f => f.status === s).length;
  let h = userBar() + `<div class="toolbar"><h2><small>FEEDBACK</small>不具合・ご要望</h2><div class="seg">${[["open", `未完了 ${c("new") + c("doing")}`], ["new", `未対応 ${c("new")}`], ["doing", `対応中 ${c("doing")}`], ["done", `対応済み ${c("done")}`], ["hold", `保留 ${c("hold")}`], ["all", "すべて"]].map(([k, l]) => `<button data-fbst="${k}" aria-pressed="${FB.st === k}">${l}</button>`).join("")}</div></div>`;
  h += `<p class="hint" style="margin:-4px 0 12px">サイト下の「不具合・ご要望を送る」から届いた内容です（最新300件）。</p>`;
  h += `<div class="fblist">${list.map(f => `<article class="fbcard st-${esc(f.status)}"><header><span class="fk k-${esc(f.kind)}">${esc(FKIND[f.kind] || f.kind)}</span><span class="count">${esc(fmtTime(f.at))}</span>${f.page ? `<span class="count">${esc(f.page)}</span>` : ""}<span style="flex:1"></span>
    <select data-fbset="${esc(f.id)}">${Object.entries(FSTAT).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></header>
    <p class="fbtext">${esc(f.text)}</p>${f.contact ? `<p class="count">連絡先：${esc(f.contact)}</p>` : ""}${f.note ? `<p class="count">メモ：${esc(f.note)}${f.noteBy ? `（${esc(shortName(f.noteBy))}）` : ""}</p>` : ""}
    <footer><small class="count ua" title="${esc(f.ua || "")}">${esc(uaShort(f.ua))}</small><span style="flex:1"></span><button class="btn small" data-fbnote="${esc(f.id)}">メモ</button>${FB.confirm === f.id ? `<span class="danger-q">削除しますか？</span><button class="btn small danger" data-fbdelyes="${esc(f.id)}">削除</button><button class="btn small" data-fbdelno="1">やめる</button>` : `<button class="btn small" data-fbdel="${esc(f.id)}">削除</button>`}</footer></article>`).join("") || '<p class="count">該当するものはありません</p>'}</div>`;
  AM.innerHTML = h;
  AM.querySelectorAll("[data-fbset]").forEach(s => s.addEventListener("change", async () => {
    try { await F.updateDoc(F.doc(F.db, "feedback", s.dataset.fbset), { status: s.value, by: me(), t: now() }); toast(`「${FSTAT[s.value]}」にしました`); } catch (e) { toast(fbErr(e)); }
  }));
}
function uaShort(ua) { ua = ua || ""; const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : ""; const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ""; return [os, br].filter(Boolean).join(" / "); }
async function fbNote(id) {
  const f = FEEDBACK.find(x => x.id === id); if (!f) return;
  const v = window.prompt("メモ（メンバーだけが見られます）", f.note || ""); if (v == null) return;
  try { await F.updateDoc(F.doc(F.db, "feedback", id), { note: v.slice(0, 500), noteBy: me() }); } catch (e) { toast(fbErr(e)); }
}

/* ================= access stats ================= */
let statsAt = 0;
async function loadStats(force) {
  if (!force && STATS && now() - statsAt < 5 * 60e3) return;
  statsAt = now();
  try {
    const q = await F.getDocs(F.query(F.collection(F.db, "stats"), F.orderBy(F.documentId(), "desc"), F.limit(90)));
    STATS = q.docs.map(d => ({ day: d.id, pv: d.data().pv || 0, uv: d.data().uv || 0 }));
  } catch (e) { STATS = []; toast(fbErr(e)); }
  if (S.tab === "stats") renderStats(false);
}
function renderStats(soft) {
  if (soft && STATS) return;
  if (!STATS) { AM.innerHTML = userBar() + `<div class="astatus">読み込み中…</div>`; loadStats(); return; }
  const by = {}; STATS.forEach(s => { by[s.day] = s; });
  const days = []; for (let i = 29; i >= 0; i--) { const d = R.jstDay(now() - i * 86400e3); days.push(by[d] || { day: d, pv: 0, uv: 0 }); }
  const sum = (arr, f) => arr.reduce((a, x) => a + x[f], 0);
  const today = days[days.length - 1], last7 = days.slice(-7);
  const raw = Math.max(5, ...days.map(d => d.pv)) / 4; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(x => x * mag).find(x => x >= raw); const max = Math.ceil(Math.max(5, ...days.map(d => d.pv)) / step) * step;
  const W = 900, H = 240, pl = 36, pb = 26, pt = 10, bw = (W - pl - 6) / days.length;
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  let grid = ""; for (let v = 0; v <= max; v += step) grid += `<line x1="${pl}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const bars = days.map((d, i) => `<g><title>${d.day}　訪問 ${d.pv} ／ 訪問者 ${d.uv}</title><rect x="${pl + i * bw + 2}" y="${y(d.pv)}" width="${bw - 4}" height="${H - pb - y(d.pv)}" class="cbar"/>${i % 5 === 4 || i === days.length - 1 ? `<text x="${pl + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${+d.day.slice(5, 7)}/${+d.day.slice(8)}</text>` : ""}</g>`).join("");
  const line = days.map((d, i) => `${i ? "L" : "M"}${(pl + i * bw + bw / 2).toFixed(1)} ${y(d.uv).toFixed(1)}`).join(" ");
  let h = userBar() + `<div class="toolbar"><h2><small>ACCESS</small>アクセス数</h2><button class="btn small" data-a="statsreload">更新</button><a class="btn small" href="https://analytics.google.com/analytics/web/" target="_blank" rel="noopener">Google アナリティクスを開く</a></div>
  <div class="kpis"><div><small>今日の訪問</small><b>${today.pv}</b><span>訪問者 ${today.uv}</span></div><div><small>直近7日の訪問</small><b>${sum(last7, "pv")}</b><span>訪問者 ${sum(last7, "uv")}</span></div><div><small>直近30日の訪問</small><b>${sum(days, "pv")}</b><span>訪問者 ${sum(days, "uv")}</span></div><div><small>届いたご意見（未対応）</small><b>${FEEDBACK.filter(f => f.status === "new").length}</b><span>全${FEEDBACK.length}件</span></div></div>
  <section class="apanel"><h3 class="ph">直近30日</h3><div class="legend"><span class="lg-bar"></span>訪問（ページを開いた回数・同じタブ内の再読み込みは数えない）<span class="lg-line"></span>訪問者（その日に初めて来た端末の数）</div>
  <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="直近30日のアクセス数">${grid}${bars}<path d="${line}" class="uvl"/>${days.map((d, i) => `<circle cx="${(pl + i * bw + bw / 2).toFixed(1)}" cy="${y(d.uv).toFixed(1)}" r="2.6" class="uvd"/>`).join("")}</svg>
  <p class="hint">日付は日本時間です。ここの数字はサイトが自分で数えた簡易集計です。流入元・地域・滞在時間などの詳しい分析は Google アナリティクスで見られます（メンバーを Google アナリティクスにも追加すると見られるようになります）。</p></section>`;
  AM.innerHTML = h;
}

/* ================= members ================= */
const MB = { email: "", confirm: null };
function renderMembers(soft) {
  if (soft && document.activeElement && document.activeElement.id === "mbemail") return;
  const owner = S.role === "owner";
  const list = ROLES.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  const pres = Object.values(EDITING).filter(e => now() - (e.at || 0) < STALE);
  let h = userBar() + `<div class="toolbar"><h2><small>MEMBERS</small>メンバー</h2><span class="count">${list.length + 1}人</span></div>
  <section class="apanel"><div class="mblist"><div class="mbrow"><b>${esc(F.OWNER)}</b><span class="rolebadge">オーナー</span><span style="flex:1"></span></div>
  ${list.map(m => `<div class="mbrow"><b>${esc(m.email)}</b>${m.name ? `<span class="count">${esc(m.name)}</span>` : ""}<span class="rolebadge ed">編集者</span>${pres.some(p => p.email === m.email) ? `<span class="pres">編集中</span>` : ""}<span style="flex:1"></span><span class="count">${m.at ? esc(fmtTime(m.at)) + " 追加" : ""}</span>${owner ? (MB.confirm === m.email ? `<span class="danger-q">外しますか？</span><button class="btn small danger" data-mbdelyes="${esc(m.email)}">外す</button><button class="btn small" data-mbdelno="1">やめる</button>` : `<button class="btn small" data-mbdel="${esc(m.email)}">外す</button>`) : ""}</div>`).join("")}</div>
  ${owner ? `<div class="addcol" style="margin-top:14px"><input id="mbemail" type="email" placeholder="招待する人の Gmail アドレス" value="${esc(MB.email)}"><input id="mbname" placeholder="表示名（任意）" style="max-width:180px"><button class="btn primary small" data-a="mbadd">メンバーに追加</button></div>` : `<p class="hint">メンバーの追加・削除はオーナーだけができます。</p>`}
  <p class="hint">招待された人は、そのメールアドレスの Google アカウントで <b>${esc(location.origin + location.pathname)}#admin</b> を開いて「Google でログイン」すると編集できます。</p></section>`;
  AM.innerHTML = h;
  const mi = document.getElementById("mbemail"); if (mi) mi.addEventListener("input", () => { MB.email = mi.value; });
}
async function addMember() {
  const e = (document.getElementById("mbemail").value || "").trim().toLowerCase();
  const name = (document.getElementById("mbname").value || "").trim().slice(0, 40);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast("メールアドレスの形が正しくありません");
  if (e === F.OWNER || ROLES.some(r => r.email === e)) return toast("すでにメンバーです");
  try {
    const b = F.writeBatch(F.db);
    b.set(F.doc(F.db, "roles", e), { role: "editor", name, at: now(), by: me() });
    b.set(F.doc(F.db, "log", rid()), logDoc({ act: "members", label: `${e} をメンバーに追加` }));
    await b.commit(); MB.email = ""; toast(`${e} を追加しました`);
  } catch (err) { toast(fbErr(err)); }
}
async function delMember(e) {
  try {
    const b = F.writeBatch(F.db);
    b.delete(F.doc(F.db, "roles", e));
    b.set(F.doc(F.db, "log", rid()), logDoc({ act: "members", label: `${e} をメンバーから外す` }));
    await b.commit(); MB.confirm = null; toast(`${e} を外しました`);
  } catch (err) { toast(fbErr(err)); }
}

/* ================= events ================= */
AM.addEventListener("click", e => onAdminClick(e));
function onAdminClick(e) {
  const t = e.target.closest("[data-a],[data-edk],[data-edrow],[data-ed],[data-iok],[data-io],[data-imk],[data-im],[data-crop],[data-lgk],[data-lgopen],[data-lgrevert],[data-fbst],[data-fbdel],[data-fbdelyes],[data-fbdelno],[data-fbnote],[data-mbdel],[data-mbdelyes],[data-mbdelno],[data-nw],[data-nwedit],[data-nwdel],[data-nwdelyes],[data-adrow],[data-cprm],[data-optadd],[data-optrm],[data-optmv]");
  if (!t) return; const ds = t.dataset;
  if (ds.a === "login") { login(); return; }
  if (ds.a === "logout") { clearPresence(); F.signOut(F.auth); return; }
  if (ds.a === "reload") { location.reload(); return; }
  if (ds.a === "seed") { seedAll(); return; }
  if (ds.a === "ghimport") { ghImport(false); return; }
  if (ds.a === "ghimportnew") { ghImport(true); return; }
  if (ds.adrow) { openEditor(ED.k, ds.adrow); return; }
  if (ds.a === "cpadd") { charpickAdd(); return; }
  if (ds.cprm) { ED.draft["おすすめキャラID"] = String(ED.draft["おすすめキャラID"] || "").split(/[,、，\s]+/).filter(x => x && x !== ds.cprm).join(","); ED.dirty = true; renderForm(); return; }
  if (ds.optadd) { const inp = AM.querySelector(`[data-optin="${CSS.escape(ds.optadd)}"]`); const v = (inp && inp.value || "").trim(); if (!v) return; const key = ds.optadd; saveOpts(o => { if (!o[key].includes(v)) o[key].push(v); }, `選択肢「${key}」に ${v} を追加`); return; }
  if (ds.optrm) { const [key, v] = ds.optrm.split("|"); saveOpts(o => { o[key] = o[key].filter(x => x !== v); }, `選択肢「${key}」から ${v} を外す`); return; }
  if (ds.optmv) { const [key, i, d] = ds.optmv.split("|"); saveOpts(o => { const a = o[key]; const j = +i + (+d); if (j < 0 || j >= a.length) return; [a[+i], a[j]] = [a[j], a[+i]]; }, `選択肢「${key}」の並び替え`); return; }
  if (ds.a === "tierclear") { TT.confirm = R.curFloor.key; renderTierTab(true); return; }
  if (ds.a === "tierimport") { TT.confirm = "import"; renderTierTab(true); return; }
  if (ds.a === "tierclearno") { TT.confirm = null; renderTierTab(true); return; }
  if (ds.a === "tierclearyes") { const fk = R.curFloor.key; TT.confirm = null; tierBulk(Object.keys(R.OFFICIAL[fk] || {}).map(id => [fk, id, ""])); renderTierTab(true); toast("この階層の配置を外しました"); return; }
  if (ds.a === "tierimportyes") { TT.confirm = null; const ops = []; Object.entries(R.LOCAL_TIERS).forEach(([fk, P]) => Object.entries(P || {}).forEach(([id, t]) => { if (t) ops.push([fk, id, t]); })); tierBulk(ops); renderTierTab(true); toast(`${ops.length}件の配置を取り込みました`); return; }
  if (ds.a === "copyme") { navigator.clipboard.writeText(me()).then(() => toast("コピーしました"), () => { }); return; }
  if (ds.a === "goio") { S.tab = "io"; renderAll(); return; }
  if (ds.a === "statsreload") { loadStats(true); return; }
  if (ds.a === "mbadd") { addMember(); return; }
  if (ds.a === "ghsave") { saveGhToken().then(() => { IM.ghedit = false; renderImg(); }); return; }
  if (ds.a === "ghedit") { IM.ghedit = !IM.ghedit; renderImg(); return; }
  if (ds.a === "ghdel") { IM.ghconfirm = true; renderImg(); return; }
  if (ds.a === "ghdelno") { IM.ghconfirm = false; renderImg(); return; }
  if (ds.a === "ghdelyes") { IM.ghconfirm = false; delGhToken(); return; }
  if (ds.a === "edcrop") { const ik = ED.k === "chars" ? "char" : "script"; openCrop(ik, ik === "char" ? ED.base["ID"] : ED.base["名前"]); return; }
  if (ds.edk) { ED.k = ds.edk; resetEd(); CL.q = ""; renderEdit(false); return; }
  if (ds.ed) { edAction(ds.ed); return; }
  if (ds.iok) { IO.k = ds.iok; IO.confirm = null; renderIO(); return; }
  if (ds.io) { ioAction(ds.io, t); return; }
  if (ds.imk) { IM.k = ds.imk; IM.files.forEach(f => URL.revokeObjectURL(f.url)); IM.files = []; renderImg(); return; }
  if (ds.im === "clear") { IM.files.forEach(f => URL.revokeObjectURL(f.url)); IM.files = []; renderImg(); return; }
  if (ds.im === "zip") { buildImageZip(t); return; }
  if (ds.im === "upload") { uploadChecked(t); return; }
  if (ds.lgk !== undefined) { LG.k = ds.lgk; renderLog(); return; }
  if (ds.lgopen) { LG.open = LG.open === ds.lgopen ? null : ds.lgopen; renderLog(); return; }
  if (ds.lgrevert) { revertLog(ds.lgrevert); return; }
  if (ds.fbst) { FB.st = ds.fbst; renderFb(); return; }
  if (ds.fbdel) { FB.confirm = ds.fbdel; renderFb(); return; }
  if (ds.fbdelno) { FB.confirm = null; renderFb(); return; }
  if (ds.fbdelyes) { F.deleteDoc(F.doc(F.db, "feedback", ds.fbdelyes)).then(() => toast("削除しました"), er => toast(fbErr(er))); FB.confirm = null; return; }
  if (ds.fbnote) { fbNote(ds.fbnote); return; }
  if (ds.mbdel) { MB.confirm = ds.mbdel; renderMembers(false); return; }
  if (ds.mbdelno) { MB.confirm = null; renderMembers(false); return; }
  if (ds.mbdelyes) { delMember(ds.mbdelyes); return; }
  if (ds.nw === "new") { NW.edit = newsBlank(); renderNews(); window.scrollTo(0, 0); return; }
  if (ds.nw === "cancel") { NW.edit = null; renderNews(); return; }
  if (ds.nw === "save") { saveNews(); return; }
  if (ds.nw === "delno") { NW.confirm = null; renderNews(); return; }
  if (ds.nwedit) { const n = NEWSLIST.find(x => x.id === ds.nwedit); if (n) { NW.edit = Object.assign(newsBlank(), n, { renew: false }); renderNews(); window.scrollTo(0, 0); } return; }
  if (ds.nwdel) { NW.confirm = ds.nwdel; renderNews(); return; }
  if (ds.nwdelyes) { delNews(ds.nwdelyes); return; }
}
window.addEventListener("beforeunload", e => { if (S.open && ED.dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ================= styles (admin only) ================= */
function injectStyle() {
  if (document.getElementById("adminCss")) return;
  const s = document.createElement("style"); s.id = "adminCss";
  s.textContent = `
.whoami{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13.5px;flex-wrap:wrap}
.whoami img{width:28px;height:28px;border-radius:50%}
.whoami small{color:var(--muted)}
.rolebadge{font-size:11.5px;font-weight:700;padding:1px 9px;background:linear-gradient(100deg,#0d3b8c,var(--accent));color:#fff;clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)}
.rolebadge.ed{background:var(--muted)}
.empty.login{max-width:560px;margin:30px auto}
.astatus.ok{border-left-color:var(--good)}
.pubrow{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center}
.mb{display:inline-block;font-size:11.5px;padding:0 7px;border:1px solid var(--line2);background:var(--field);font-weight:700}
.mb.ok{color:var(--good);border-color:currentColor}.mb.mid{color:#d98a00;border-color:currentColor}.mb.warn,.mb.bad{color:var(--bad);border-color:currentColor}
.pres{margin-left:auto;font-size:11px;font-weight:700;color:#fff;background:#e08a00;padding:0 6px;border-radius:2px;white-space:nowrap}
.adm-list button{position:relative}
.field.changed label{color:var(--accent)}
.field.changed input,.field.changed textarea{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.field.clash input,.field.clash textarea{border-color:var(--bad);box-shadow:0 0 0 1px var(--bad) inset}
.astatus.conflict{border-left-color:var(--bad)}
.astatus .row2{margin-top:8px}
.nbadge{display:inline-block;min-width:18px;margin-left:6px;padding:0 5px;border-radius:9px;background:var(--bad);color:#fff;font-size:11px;line-height:18px;text-align:center}
.loglist{display:flex;flex-direction:column;gap:4px}
.logrow{background:var(--panel);box-shadow:var(--shadow)}
.loghead{display:grid;grid-template-columns:7.5em 6em 6em 1fr auto;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:8px 12px;font-size:13.5px;color:var(--ink)}
.loghead .lt{color:var(--muted);font-variant-numeric:tabular-nums}
.la{font-weight:700;font-size:12px}.a-delete{color:var(--bad)}.a-create{color:var(--good)}.a-revert{color:#d98a00}
.lk{color:var(--muted);font-size:12px}.lb{color:var(--muted);font-size:12.5px}
.logbody{padding:0 12px 12px}
.chtbl{width:100%;border-collapse:collapse;font-size:12.5px}
.chtbl th,.chtbl td{border:1px solid var(--line);padding:4px 8px;vertical-align:top;text-align:left;white-space:pre-wrap;word-break:break-word}
.chtbl td:nth-child(2){background:rgba(226,61,99,.06)}.chtbl td:nth-child(3){background:rgba(15,158,99,.07)}
.fblist{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.fbcard{background:var(--panel);box-shadow:var(--shadow);padding:12px 14px;border-left:4px solid var(--bad);display:flex;flex-direction:column;gap:6px}
.fbcard.st-doing{border-left-color:#e08a00}.fbcard.st-done{border-left-color:var(--good);opacity:.8}.fbcard.st-hold{border-left-color:var(--muted)}
.fbcard header,.fbcard footer{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fbcard select{border:1px solid var(--line2);background:var(--field);padding:3px 6px;color:var(--ink)}
.fk{font-size:12px;font-weight:700;padding:0 8px;color:#fff;background:var(--bad)}.fk.k-request{background:var(--accent)}.fk.k-other{background:var(--muted)}
.fbtext{margin:0;white-space:pre-wrap;word-break:break-word;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:14px}
.kpis div{background:var(--panel);box-shadow:var(--shadow);padding:10px 14px;border-left:4px solid var(--accent)}
.kpis small{display:block;color:var(--muted);font-size:12px}.kpis b{font-family:var(--display);font-size:30px;font-weight:600;line-height:1.2}.kpis span{display:block;color:var(--muted);font-size:12px}
.chart{width:100%;height:240px;display:block}
.chart text{font-size:11px;fill:var(--muted)}.chart .gl{stroke:var(--line);stroke-width:1}
.chart .cbar{fill:var(--accent);opacity:.75}.chart g:hover .cbar{opacity:1}
.chart .uvl{fill:none;stroke:#e08a00;stroke-width:2;vector-effect:non-scaling-stroke}.chart .uvd{fill:#e08a00}
.legend{display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:6px}
.lg-bar{display:inline-block;width:12px;height:12px;background:var(--accent);opacity:.75}.lg-line{display:inline-block;width:16px;height:3px;background:#e08a00}
.mblist{display:flex;flex-direction:column;gap:4px}
.mbrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 4px;border-bottom:1px solid var(--line);font-size:14px}
#admin .seg{flex-wrap:wrap}#admin .seg button{white-space:nowrap}
.apanel.seed{border-left:4px solid #f0a020}
.imgacts{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.filebtn{cursor:pointer}
.addcol .btn{white-space:nowrap;flex:none}
.steps{margin:4px 0 8px;padding-left:1.4em;font-size:13.5px;line-height:1.8}
#dlgEdit{width:min(1080px,calc(100% - 24px))}
#dlgEdit .dlg{padding:18px 22px 0}
.edhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.edhead h2{margin:0}
.edimgs{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;padding:12px 14px;background:var(--field);margin:8px 0 14px;border:1px solid var(--line)}
.edth,.edfull{display:flex;flex-direction:column;gap:3px}
.edth img,.edth .noimg{width:104px;height:104px;object-fit:cover;display:block;background:var(--soft)}
.edfull img{height:150px;max-width:280px;object-fit:contain;display:block;background:var(--soft)}
.edth small,.edfull small{font-size:11px;color:var(--muted)}
.edimgbtns{display:flex;flex-direction:column;gap:6px;align-items:flex-start;max-width:360px}
.dlg .filebtn{display:inline-flex;margin:0;font-weight:700}
.preslist{font-size:13px;margin:-4px 0 10px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}
.preslist .pres{margin:0}
.edtool{margin-bottom:10px}
#dlgEdit .formfoot{padding-bottom:14px}
.seedbox{max-width:760px;margin:20px auto}
.ghnewbar{display:flex;flex-direction:column;gap:6px}
.edseg{flex-wrap:wrap;align-items:center}
.segsep{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;margin:0 4px 0 10px;padding-left:10px;border-left:2px solid var(--line2)}
.fgroup{margin:0 0 14px;padding:12px 14px 14px;background:var(--field);border:1px solid var(--line)}
.fgh{margin:0 0 10px;font-size:13px;font-weight:900;color:var(--accent-ink);letter-spacing:.12em;display:flex;align-items:center;gap:8px}
.fgh::before{content:"";width:4px;height:14px;background:linear-gradient(var(--accent),var(--accent2))}
.fgnote{margin:-4px 0 10px!important}
.fields2{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 14px}
.fields2.numgrid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
.fields2 .field.long{grid-column:1/-1}
.field select{border:1px solid var(--line2);background:var(--panel2);padding:6px 8px;border-radius:2px;width:100%;font-size:14px;color:var(--ink)}
.field.numf input{text-align:right;font-variant-numeric:tabular-nums}
.field.idf input{background:transparent;border-style:dashed;color:var(--muted)}
.field.idf small{font-size:11px}
.field.masterf .mval{padding:6px 8px;border:1px dashed var(--line2);font-size:14px;min-height:32px}
.req{color:var(--bad);font-size:10.5px;font-weight:700}
.cpchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.cpchip{display:inline-flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--line2);padding:2px 4px 2px 2px;font-size:13px;font-weight:700}
.cpchip img{width:26px;height:26px;object-fit:cover}
.cpchip button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:12px}
.addcolbox{margin:4px 0 0;font-size:13px;color:var(--muted)}
.addcolbox summary{cursor:pointer}
.optgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.optcard{margin:0}
.optchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.optchip{display:inline-flex;align-items:center;gap:4px;background:var(--field);border:1px solid var(--line2);padding:3px 6px;font-size:13.5px}
.optchip small{color:var(--muted);font-size:11px}
.optchip button{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 2px;font-size:13px}
.optchip button:hover{color:var(--accent)}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.pcard{display:flex;gap:12px;align-items:flex-start;text-align:left;border:0;background:var(--panel);box-shadow:var(--shadow);padding:10px;cursor:pointer;color:var(--ink);position:relative}
.pcard:hover{background:var(--soft)}
.pcard>img,.pcard>.noimg{width:64px;height:64px;object-fit:cover;flex:none;background:var(--soft)}
.ptags img{width:16px;height:16px;object-fit:contain}
.pinfo{display:flex;flex-direction:column;gap:3px;min-width:0}
.pinfo b{font-size:16px}
.ptags{display:flex;gap:4px 10px;flex-wrap:wrap;font-size:12.5px}
.ptags span{display:inline-flex;align-items:center;gap:3px}
.ptags .miss{color:var(--bad)}
.pcard .pres{position:absolute;top:6px;right:6px}
.stbl{width:100%}
.stbl tr{cursor:pointer}
.btn.big{font-size:16px;padding:12px 26px}
.nwform select{border:1px solid var(--line2);background:var(--field);padding:5px 8px;font-size:14px;color:var(--ink)}
.ck2{display:flex!important;align-items:center;gap:6px;font-size:13.5px!important;font-weight:500!important;color:var(--ink)!important;min-height:32px}
.ck2 input{width:auto!important;flex:none}
.tierbar{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center}
.tieracts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-left:auto}
.nwform .formfoot{position:static}
.nwprev{background:var(--panel2);padding:0 12px;border:1px dashed var(--line2)}
.nwprev .news{border:0}
.nwlist{display:flex;flex-direction:column;gap:6px}
.nwrow{background:var(--panel);box-shadow:var(--shadow);padding:0 12px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
.nwrow .news{flex:1;min-width:260px;border:0}
.nwacts{display:flex;gap:6px;align-items:center;padding:9px 0;flex-wrap:wrap}
@media (max-width:700px){.loghead{grid-template-columns:6.5em 1fr;}.loghead .lk,.loghead .lb{display:none}}
`;
  document.head.appendChild(s);
}
