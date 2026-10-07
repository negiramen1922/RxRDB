// RxRDB 管理画面（Firebase: Google ログイン + Firestore）
// index.html の footer「管理者ログイン」（#admin）から読み込まれる。
import * as F from "./fb.js";

let R = null;            // index.html 側の橋渡し (window.RXR)
const AM = document.getElementById("admin");
const NAV = document.getElementById("adminTabs");
const TABLES = ["chars", "scripts", "babel"];
const TLABEL = { chars: "キャラ", scripts: "スクリプト", babel: "バベル" };
const KEYCOLS = { chars: ["ID"], scripts: ["名前"], babel: ["バベル種類", "階層"] };
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
  window.RXR_ADMIN = { open, close };
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
  NAV.hidden = false;
  const ab = document.getElementById("actionbar"); if (ab) ab.classList.add("hidden");
  renderAll();
  window.scrollTo(0, 0);
}
function close() {
  if (!S.open) return;
  S.open = false;
  clearPresence();
  R.setMode("user");
  AM.hidden = true; NAV.hidden = true;
  document.getElementById("main").hidden = false;
  document.getElementById("userTabs").hidden = false;
  R.rebuild(); R.renderUser();
  if (location.hash === "#admin" || location.hash === "#") history.replaceState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);
}
async function resolveRole(u) {
  const e = (u.email || "").toLowerCase();
  if (!u.emailVerified) return null;
  if (e === F.OWNER) return "owner";
  try { const s = await F.getDoc(F.doc(F.db, "roles", e)); return s.exists() ? "editor" : null; }
  catch (err) { return null; }
}

/* ================= live listeners ================= */
function stopListeners() { S.unsubs.forEach(f => { try { f(); } catch (e) { } }); S.unsubs = []; clearInterval(S.heartbeat); }
function startListeners() {
  const on = (ref, fn) => S.unsubs.push(F.onSnapshot(ref, fn, err => { console.warn(err); toast(fbErr(err), 5000); }));
  TABLES.forEach(k => {
    on(F.doc(F.db, "tables", k), s => { T[k].hdrExists = s.exists(); T[k].headers = s.exists() ? (s.data().headers || []) : []; T[k].hdrReady = true; tableChanged(k); });
    on(F.collection(F.db, "tables", k, "rows"), q => {
      if (q.metadata.fromCache && !T[k].rowsReady) return;
      const m = new Map(); q.docs.forEach(d => m.set(d.id, Object.assign({ id: d.id }, d.data())));
      T[k].rows = m; T[k].rowsReady = true; T[k].pending = q.metadata.hasPendingWrites; tableChanged(k);
    });
  });
  ["chars", "scripts", "babel", "crops"].forEach(k => on(F.doc(F.db, "public", k), s => {
    const d = s.exists() ? s.data() : null;
    PUB[k] = d ? { sig: d.sig, at: d.at, by: d.by, count: d.count } : null;
    if (k === "crops") { try { R.setCrops(d && d.json ? JSON.parse(d.json) : {}); } catch (e) { } }
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
  if (seeded(k)) { const d = derive(k); R.setLive(k, { headers: d.headers, rows: d.rows }); R.rebuild(); }
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
  return R.hashId(t.headers.join("\u0001") + "\u0002" + ids.join(","));
}
const pubTimers = {};
function maybePublish(k) {
  if (k === "crops" || !seeded(k) || T[k].pending || !(k in PUB)) return;
  const sig = sigOf(k);
  if (PUB[k] && PUB[k].sig === sig) return;
  clearTimeout(pubTimers[k]);
  pubTimers[k] = setTimeout(() => publish(k).catch(e => console.warn(e)), 1200 + Math.random() * 1500);
}
async function publish(k, force) {
  if (!seeded(k)) return;
  const sig = sigOf(k);
  if (!force && PUB[k] && PUB[k].sig === sig) return;
  const d = derive(k);
  const json = JSON.stringify({ headers: d.headers, rows: d.rows });
  if (json.length > 1000000) { toast(`${TLABEL[k]}データが大きすぎて公開できません（1MB超）`, 6000); return; }
  await F.setDoc(F.doc(F.db, "public", k), { json, sig, at: now(), by: me(), count: d.rows.length });
}
function pubState(k) {
  if (!seeded(k)) return { cls: "warn", t: "未登録" };
  if (!PUB[k]) return { cls: "warn", t: "未公開" };
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
const TABS = [["edit", "データ編集"], ["io", "読み込み・書き出し"], ["img", "画像"], ["log", "変更履歴"], ["fb", "ご意見"], ["stats", "アクセス"], ["members", "メンバー"]];
function renderNav() {
  if (!S.role) { NAV.innerHTML = `<button role="tab" data-atab="back" aria-selected="false">← ユーザー画面へ</button>`; return; }
  const nf = FEEDBACK.filter(f => f.status === "new").length;
  NAV.innerHTML = TABS.map(([k, l]) => `<button role="tab" data-atab="${k}" aria-selected="${S.tab === k}">${l}${k === "fb" && nf ? `<span class="nbadge">${nf}</span>` : ""}</button>`).join("") + `<button role="tab" data-atab="back" aria-selected="false">← ユーザー画面へ</button>`;
}
NAV.addEventListener("click", e => {
  const b = e.target.closest("[data-atab]"); if (!b) return;
  const t = b.dataset.atab;
  if (t === "back") { location.hash = ""; close(); return; }
  if (S.tab === "edit" && ED.dirty && !ED.leaveOk) { ED.leaveOk = true; toast("保存していない変更があります。もう一度押すと破棄して切り替えます", 3500); return; }
  if (S.tab === "edit" && t !== "edit") { ED.leaveOk = false; resetEd(); clearPresence(); }
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
  if (notSeeded.length) return `<div class="astatus warn">Firestore にまだ登録されていないデータがあります（${notSeeded.map(k => TLABEL[k]).join("・")}）。「読み込み・書き出し」の「初期データを登録」から始めてください。今の公開サイトは GitHub の data/*.json を表示しています。</div>`;
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
const ED = { k: "chars", q: "", id: null, isNew: false, draft: null, base: null, baseRev: null, dirty: false, confirmDel: false, newCol: "", remote: null, gone: false, saving: false, conflict: null, leaveOk: false };
function resetEd() { Object.assign(ED, { id: null, isNew: false, draft: null, base: null, baseRev: null, dirty: false, confirmDel: false, remote: null, gone: false, conflict: null }); }
function keyOf(k, hd, r) { const g = n => { const i = hd.indexOf(n); return i >= 0 ? String(r[i] || "").trim() : ""; }; return KEYCOLS[k].map(g).join("|"); }
function keyOfCells(k, c) { return KEYCOLS[k].map(n => String(c[n] || "").trim()).join("|"); }
function labelOf(k, c) {
  if (k === "babel") return `${c["バベル種類"] || ""} ${c["階層"] || ""}F ${c["ボス"] || ""}`.trim();
  if (k === "chars") return c["キャラ名"] ? `${c["キャラ名"]}${c["スタイル"] && c["スタイル"] !== "DEFAULT" ? "" : ""}` : (c["ID"] || "(名前なし)");
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
function renderEdit(soft) {
  if (!allReady()) { AM.innerHTML = userBar() + statusBar(); return; }
  const k = ED.k;
  if (!seeded(k)) {
    AM.innerHTML = userBar() + statusBar() + `<div class="toolbar"><h2><small>EDIT</small>データ編集</h2>${tableSeg("edk", k)}</div><div class="empty"><h2>${TLABEL[k]}データがまだ登録されていません</h2><p>「読み込み・書き出し」→「初期データを登録」で、今の公開データ（GitHub の data/*.json）を取り込めます。</p><div class="row"><button class="btn primary" data-a="goio">読み込み・書き出しへ</button></div></div>`;
    return;
  }
  const rows = [...T[k].rows.values()].sort((a, b) => (a.o - b.o) || (a.id < b.id ? -1 : 1));
  let list = rows;
  if (ED.q) { const q = ED.q.toLowerCase(); list = rows.filter(r => Object.values(r.c || {}).some(v => String(v || "").toLowerCase().includes(q))); }
  const listHtml = list.map(r => {
    const who = othersOn(k, r.id);
    return `<button data-edrow="${esc(r.id)}" aria-current="${ED.id === r.id}">${thumbOf(k, r.c || {})}<span>${esc(labelOf(k, r.c || {}))}</span>${who.length ? `<span class="pres" title="${esc(who.map(w => w.name || w.email).join("、"))}が編集中">✎ ${esc(who[0].name || shortName(who[0].email))}</span>` : ""}</button>`;
  }).join("") || '<p class="count" style="padding:12px">該当なし</p>';
  if (soft && document.getElementById("edlist") && (ED.dirty || ED.isNew)) {
    // keep the form (unsaved typing) — refresh list, status and banners only
    const el = document.getElementById("edlist"); const st = el.scrollTop; el.innerHTML = listHtml; el.scrollTop = st;
    const bn = document.getElementById("edbanner"); if (bn) bn.innerHTML = bannerHtml();
    const sb = document.getElementById("adstatus"); if (sb) sb.innerHTML = statusBar();
    document.getElementById("edcount").textContent = `${list.length} / ${rows.length}`;
    return;
  }
  const scroll = document.getElementById("edlist") ? document.getElementById("edlist").scrollTop : 0;
  AM.innerHTML = userBar() + `<div id="adstatus">${statusBar()}</div><div class="toolbar"><h2><small>EDIT</small>データ編集</h2>${tableSeg("edk", k)}
  <input class="search" id="edq" placeholder="検索" value="${esc(ED.q)}"><span class="count" id="edcount">${list.length} / ${rows.length}</span><button class="btn small" data-ed="new">＋ 行を追加</button></div>
  <div class="adm-grid"><div class="adm-list" id="edlist">${listHtml}</div><div class="adm-form" id="edform">${editForm()}</div></div>`;
  document.getElementById("edlist").scrollTop = scroll;
  const q = document.getElementById("edq");
  q.addEventListener("input", () => { ED.q = q.value; const p = q.selectionStart; renderEdit(false); const n = document.getElementById("edq"); n.focus(); n.setSelectionRange(p, p); });
  AM.querySelectorAll("[data-field]").forEach(el => el.addEventListener("input", () => {
    ED.draft[el.dataset.field] = el.value; ED.dirty = true;
    const sb = document.getElementById("edsave"); if (sb) sb.disabled = false;
    el.closest(".field").classList.toggle("changed", (ED.base[el.dataset.field] || "") !== el.value);
  }));
  const nc = document.getElementById("ednewcol"); if (nc) nc.addEventListener("input", () => { ED.newCol = nc.value; });
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
  if (!ED.id || !ED.draft) return `<div class="empty" style="box-shadow:none"><h2>行を選んでください</h2><p>左の一覧から編集したい行を選ぶか、「行を追加」で新しく作れます。</p></div>`;
  const hd = T[ED.k].headers;
  const r = T[ED.k].rows.get(ED.id);
  const both = ED.conflict ? ED.conflict.both : [];
  let h = `<div id="edbanner">${bannerHtml()}</div><div class="formhead"><h3 class="fh">${ED.isNew ? "新しい行" : esc(labelOf(ED.k, ED.draft))}</h3>${ED.k === "chars" && !ED.isNew && R.IMG[ED.draft["ID"]] ? `<img class="formth" src="${esc(R.IMG[ED.draft["ID"]])}" alt="">` : ""}</div>`;
  if (r && !ED.isNew) h += `<p class="count" style="margin:-6px 0 10px">最終更新：${esc(shortName(r.by))}（${esc(fmtTime(r.t))}）</p>`;
  h += `<div class="fields">` + hd.map((name, i) => {
    const v = ED.draft[name] == null ? "" : String(ED.draft[name]);
    const long = v.length > 34 || /\n/.test(v) || /効果|解析|ポイント|コメント/.test(name); const id = "f_" + i;
    const changed = (ED.base[name] || "") !== v;
    const key = KEYCOLS[ED.k].includes(name);
    return `<div class="field${long ? " long" : ""}${changed ? " changed" : ""}${both.includes(name) ? " clash" : ""}"><label for="${id}">${esc(name)}${key ? ' <small class="count">（識別用）</small>' : ""}</label>${long ? `<textarea id="${id}" data-field="${esc(name)}" rows="${Math.min(10, Math.max(2, Math.ceil(v.length / 42) + (v.match(/\n/g) || []).length))}">${esc(v)}</textarea>` : `<input id="${id}" data-field="${esc(name)}" value="${esc(v)}">`}</div>`;
  }).join("") + `</div>`;
  h += `<div class="addcol"><input id="ednewcol" placeholder="列名を入力して列を追加" value="${esc(ED.newCol)}"><button class="btn small" data-ed="addcol">列を追加</button></div>`;
  h += `<div class="formfoot">${ED.confirmDel ? `<span class="danger-q">この行を削除しますか？</span><button class="btn small danger" data-ed="delyes">削除する</button><button class="btn small" data-ed="delno">やめる</button>` : (!ED.isNew ? `<button class="btn small" data-ed="del">この行を削除</button>` : "")}<span style="flex:1"></span><button class="btn small" data-ed="cancel">変更を取り消す</button><button class="btn primary" id="edsave" data-ed="save" ${ED.dirty || ED.gone ? "" : "disabled"}>保存して公開</button></div>`;
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
  const k = ED.k, hd = T[k].headers;
  const cells = {}; hd.forEach(h => { cells[h] = String(ED.draft[h] == null ? "" : ED.draft[h]); });
  const dup = dupKey(k, cells, ED.id);
  if (dup === "empty") { toast(`「${KEYCOLS[k].join("」「")}」を入力してください`, 4000); return; }
  if (dup) { toast(`「${KEYCOLS[k].join("・")}」が「${dup}」と同じです。別の値にしてください`, 5000); return; }
  const creating = ED.isNew || ED.gone;
  const id = creating ? (ED.id && ED.gone ? ED.id : "r" + rid()) : ED.id;
  const ref = F.doc(F.db, "tables", k, "rows", id);
  const rev = rid();
  const btn = document.getElementById("edsave"); if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }
  ED.saving = true;
  try {
    await F.runTransaction(F.db, async tx => {
      const s = await tx.get(ref);
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
    toast("保存しました。数秒で公開サイトに反映されます");
    renderEdit(false);
  } catch (e) {
    ED.saving = false;
    if (e && e.code === "conflict") {
      const both = []; const hdr = hd;
      hdr.forEach(h => { const mine = String(ED.draft[h] || ""), base = String(ED.base[h] || ""), th = String((e.other.c || {})[h] || ""); if (mine !== base && th !== base && th !== mine) both.push(h); });
      ED.conflict = { other: e.other, both }; renderEdit(false); toast("ほかのメンバーの更新と重なりました。内容を確認してください", 5000); return;
    }
    if (e && e.code === "gone") { ED.gone = true; renderEdit(false); toast("この行はほかのメンバーが削除していました", 5000); return; }
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
    toast("削除しました"); clearPresence(); resetEd(); renderEdit(false);
  } catch (e) {
    if (e && e.code === "conflict") { toast("削除する前にほかのメンバーが更新しました。内容を確認してからもう一度削除してください", 6000); loadRow(k, id); renderEdit(false); return; }
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
  if (a === "new") { ED.id = "new"; ED.isNew = true; ED.draft = {}; ED.base = {}; ED.baseRev = null; ED.dirty = true; ED.confirmDel = false; ED.conflict = null; ED.remote = null; ED.gone = false; renderEdit(false); return; }
  if (a === "cancel") { if (ED.isNew) resetEd(); else loadRow(k, ED.id); renderEdit(false); return; }
  if (a === "del") { ED.confirmDel = true; renderEdit(false); return; }
  if (a === "delno") { ED.confirmDel = false; renderEdit(false); return; }
  if (a === "delyes") { deleteRow(); return; }
  if (a === "addcol") { addColumn(); return; }
  if (a === "save") { saveRow(false); return; }
  if (a === "merge") { if (ED.remote) { const both = mergeRemote(ED.remote); if (both.length) toast(`両方が変えた項目はあなたの内容のままです：${both.join("、")}`, 6000); } renderEdit(false); return; }
  if (a === "mergesave") { const both = mergeRemote(Object.assign({}, ED.conflict.other)); ED.conflict = null; if (both.length) { toast("両方が変えた項目はあなたの内容で保存します", 3000); } saveRow(false); return; }
  if (a === "force") { ED.conflict = null; saveRow(true); return; }
  if (a === "discard") { loadRow(k, ED.id); renderEdit(false); return; }
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
  ${seeded(k) ? `<h3 class="ph" style="margin-top:22px">GitHub のデータで置き換える</h3><p class="hint" style="margin-top:0">${TLABEL[k]}データを GitHub の data/${k}.json の内容で丸ごと置き換えます（バックアップから戻すとき用）。</p>
  <div class="row2">${IO.confirm === "restore" ? `<span class="danger-q">今の${TLABEL[k]}データは上書きされます。よろしいですか？</span><button class="btn small danger" data-io="restoreyes">置き換える</button><button class="btn small" data-io="no">やめる</button>` : `<button class="btn" data-io="restore">data/${k}.json で置き換える</button>`}</div>` : ""}</section></div>`;
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
      download(`rxrdb-data-${R.jstDay()}.zip`, await z.generateAsync({ type: "blob" })); toast("data/*.json を書き出しました"); }
    catch (e) { toast("ZIP を作れませんでした。通信状態を確認してください", 5000); } return;
  }
  if (a === "publish") { try { for (const t of TABLES) await publish(t, true); toast("公開データを更新しました"); } catch (e) { toast(fbErr(e), 5000); } return; }
  if (a === "no") { IO.confirm = null; renderIO(); return; }
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
  if (IM.k === "char" || IM.k === "script") {
    const src = tg.filter(x => R.cropSrc(IM.k, x.key)); const q = (IM.cq || "").toLowerCase(); const shown = src.filter(x => !q || x.label.toLowerCase().includes(q) || String(x.key).toLowerCase().includes(q));
    const adj = t => R.CROPS["c_" + IM.k + "_" + R.hashId(t.key)];
    h += `<section class="apanel"><h3 class="ph">サムネイルの位置調整</h3><p class="hint" style="margin-top:0">一覧の正方形サムネイルがずれているものを選んで、切り抜く位置を直せます。保存するとすぐ公開サイトに反映されます。調整済みのものには印が付きます。</p>
    <input class="search" id="cropq" placeholder="名前で絞り込み" value="${esc(IM.cq || "")}" style="max-width:320px;margin-bottom:10px">
    <div class="cropgrid">${shown.map(x => { const th = IM.k === "char" ? R.IMG[x.key] : R.SIMG[x.key]; return `<button data-crop="${esc(x.key)}" title="${esc(x.label)}" class="${adj(x) ? "adj" : ""}">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}<span>${esc(x.label)}</span></button>`; }).join("") || '<span class="count">元画像のあるものがありません</span>'}</div></section>`;
  }
  if (tg.length > 1) h += `<section class="apanel"><h3 class="ph">画像がないもの（${miss.length}）</h3>${miss.length ? `<div class="misslist">${miss.map(t => `<span>${esc(t.label)}</span>`).join("")}</div>` : `<p class="hint" style="margin:0">すべて画像があります。</p>`}</section>`;
  h += `<section class="apanel"><h3 class="ph">画像を追加する（GitHub 用に変換）</h3>
  <p class="hint" style="margin-top:0">画像そのものは GitHub のリポジトリに置いています。ここに画像を入れると、${IM.k === "char" ? "ファイル名をキャラID（例：カノン_DEFAULT）やキャラ名と照らし合わせて" : IM.k === "script" ? "ファイル名とスクリプト名の表記ゆれ（全角半角・記号・カタカナひらがな・末尾の番号など）を吸収して" : IM.k === "icon" ? "属性・ロール・階級・騎士団名（英語のファイル名にも対応）と照らし合わせて" : ""}割り当て、サイズを整えた画像と新しい data/images.json を ZIP にまとめます。ZIP を展開して GitHub に上書きアップロード（または Claude Code に渡して push）すると公開されます。</p>
  <label class="drop" id="drop"><input type="file" id="imfiles" accept="image/*" ${IM.k === "hero" ? "" : "multiple"}><span>画像ファイルを選ぶか、ここにドラッグ</span></label>`;
  if (IM.files.length) {
    const cnt = {}; IM.files.forEach(f => { if (f.key) cnt[f.key] = (cnt[f.key] || 0) + 1; });
    const on = IM.files.filter(f => f.on && f.key).length;
    h += `<div class="mtbl"><div class="mrow mh"><span></span><span>ファイル</span><span>割り当て先</span><span>判定</span></div>${IM.files.map((f, i) => {
      const st = !f.key ? `<span class="mb bad">未割り当て</span>` : f.manual ? `<span class="mb ok">手動</span>` : f.score >= 0.97 ? `<span class="mb ok">一致</span>` : f.score >= 0.6 ? `<span class="mb mid">近い ${Math.round(f.score * 100)}%</span>` : `<span class="mb bad">要確認 ${Math.round(f.score * 100)}%</span>`;
      const warn = f.key && cnt[f.key] > 1 ? `<small class="err">同じ割り当て先が複数あります</small>` : f.key && hasImage(IM.k, f.key) ? `<small class="count">今の画像を置き換えます</small>` : "";
      return `<div class="mrow"><label class="ck"><input type="checkbox" data-imon="${i}" ${f.on ? "checked" : ""} ${!f.key ? "disabled" : ""}><img src="${f.url}" alt=""></label><span class="fname">${esc(f.name)}</span>
      <span><select data-imkey="${i}"><option value="">（割り当てない）</option><optgroup label="候補">${f.cands.map(c => `<option value="${esc(c.key)}" ${c.key === f.key ? "selected" : ""}>${esc(c.label)}（${Math.round(c.s * 100)}%）</option>`).join("")}</optgroup><optgroup label="すべて">${tg.map(t => `<option value="${esc(t.key)}" ${!f.cands.some(c => c.key === f.key) && t.key === f.key ? "selected" : ""}>${esc(t.label)}${hasImage(IM.k, t.key) ? "" : "　※画像なし"}</option>`).join("")}</optgroup></select>${warn}</span><span>${st}</span></div>`;
    }).join("")}</div>
    <div class="row2"><button class="btn primary" data-im="zip" ${on && !IM.busy ? "" : "disabled"}>チェックした ${on} 件を ZIP にまとめる</button><button class="btn" data-im="clear">一覧をクリア</button><span class="count">「近い」「要確認」は割り当て先を確認してからチェックを入れてください。</span></div>`;
  }
  h += `</section>`;
  AM.innerHTML = h;
  const inp = document.getElementById("imfiles"); inp.addEventListener("change", () => addFiles(inp.files));
  const cq = document.getElementById("cropq"); if (cq) cq.addEventListener("input", () => { IM.cq = cq.value; const p = cq.selectionStart; renderImg(); const n = document.getElementById("cropq"); n.focus(); n.setSelectionRange(p, p); });
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
async function buildImageZip(btn) {
  const todo = IM.files.filter(f => f.on && f.key);
  IM.busy = true; btn.disabled = true; btn.textContent = "変換中…";
  try {
    const Z = await loadJSZip(); const z = new Z();
    const im0 = await staticJson("data/images.json").catch(() => ({}));
    const out = Object.assign({ thumbs: {}, banners: {}, icons: {}, sthumbs: {}, sfull: {}, hero: "" }, im0);
    let n = 0;
    for (const f of todo) {
      const im = await loadImg(f.file); const W = im.naturalWidth, H = im.naturalHeight; const fit = mw => { const s = Math.min(1, mw / W); return [W * s, H * s]; };
      const nm = safeName(f.key);
      if (IM.k === "icon") { const s = Math.min(1, 96 / Math.max(W, H)); const p = `images/icons/${nm}.png`; z.file(p, await R.canvasBlob(im, 0, 0, W, H, W * s, H * s, "image/png")); out.icons[f.key] = p; }
      else if (IM.k === "hero") { const [dw, dh] = fit(1800); z.file("images/hero.webp", await R.canvasBlob(im, 0, 0, W, H, dw, dh, "image/webp", .82)); out.hero = "images/hero.webp"; }
      else {
        const dir = IM.k === "char" ? "images/chars" : "images/scripts"; const [dw, dh] = fit(IM.k === "char" ? 1200 : 720);
        z.file(`${dir}/${nm}.webp`, await R.canvasBlob(im, 0, 0, W, H, dw, dh, "image/webp", .82));
        let side, sx, sy;
        if (W > H * 1.2) { side = H * 0.46; sx = W / 2 - side / 2; sy = H * 0.08; } else { side = Math.min(W, H) * 0.9; sx = (W - side) / 2; sy = Math.min(H - side, H * 0.04); }
        z.file(`${dir}/thumb/${nm}.webp`, await R.canvasBlob(im, sx, sy, side, side, 176, 176, "image/webp", .85));
        if (IM.k === "char") { out.banners[f.key] = `${dir}/${nm}.webp`; out.thumbs[f.key] = `${dir}/thumb/${nm}.webp`; }
        else { out.sfull[f.key] = `${dir}/${nm}.webp`; out.sthumbs[f.key] = `${dir}/thumb/${nm}.webp`; }
      }
      n++; btn.textContent = `変換中… ${n}/${todo.length}`;
    }
    z.file("data/images.json", JSON.stringify(out, null, 1));
    z.file("README.txt", `RxRDB 画像追加 ${R.jstDay()}\n\nこの ZIP の中身（images/ と data/images.json）を、リポジトリ negiramen1922/RxRDB のルートに上書きしてください。\nGitHub の画面なら「Add file → Upload files」にフォルダごとドラッグして Commit すると公開されます。\n\n${todo.map(f => `${f.name} → ${f.key}`).join("\n")}\n`);
    download(`rxrdb-images-${R.jstDay()}.zip`, await z.generateAsync({ type: "blob" }));
    toast(`${n}件の画像を ZIP にまとめました`, 4000);
  } catch (e) { toast("ZIP を作れませんでした：" + (e && e.message || ""), 5000); }
  IM.busy = false; renderImg();
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
const ACT = { create: "追加", update: "編集", delete: "削除", import: "読み込み", seed: "初期登録", restore: "置き換え", columns: "列", crop: "サムネイル", revert: "元に戻す", members: "メンバー" };
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
AM.addEventListener("click", e => {
  const t = e.target.closest("[data-a],[data-edk],[data-edrow],[data-ed],[data-iok],[data-io],[data-imk],[data-im],[data-crop],[data-lgk],[data-lgopen],[data-lgrevert],[data-fbst],[data-fbdel],[data-fbdelyes],[data-fbdelno],[data-fbnote],[data-mbdel],[data-mbdelyes],[data-mbdelno]");
  if (!t) return; const ds = t.dataset;
  if (ds.a === "login") { login(); return; }
  if (ds.a === "logout") { clearPresence(); F.signOut(F.auth); return; }
  if (ds.a === "copyme") { navigator.clipboard.writeText(me()).then(() => toast("コピーしました"), () => { }); return; }
  if (ds.a === "goio") { S.tab = "io"; renderAll(); return; }
  if (ds.a === "statsreload") { loadStats(true); return; }
  if (ds.a === "mbadd") { addMember(); return; }
  if (ds.edk) { if (ED.dirty && !ED.leaveOk) { ED.leaveOk = true; toast("保存していない変更があります。もう一度押すと破棄して切り替えます", 3500); return; } ED.leaveOk = false; ED.k = ds.edk; resetEd(); ED.q = ""; clearPresence(); renderEdit(false); return; }
  if (ds.edrow !== undefined) {
    if (ED.dirty && !ED.leaveOk && ds.edrow !== ED.id) { ED.leaveOk = true; toast("保存していない変更があります。もう一度押すと破棄して切り替えます", 3500); return; }
    ED.leaveOk = false; loadRow(ED.k, ds.edrow); setPresence(); renderEdit(false);
    if (window.innerWidth < 820) { const f = document.getElementById("edform"); if (f) f.scrollIntoView({ block: "start" }); }
    return;
  }
  if (ds.ed) { edAction(ds.ed); return; }
  if (ds.iok) { IO.k = ds.iok; IO.confirm = null; renderIO(); return; }
  if (ds.io) { ioAction(ds.io, t); return; }
  if (ds.imk) { IM.k = ds.imk; IM.files.forEach(f => URL.revokeObjectURL(f.url)); IM.files = []; renderImg(); return; }
  if (ds.im === "clear") { IM.files.forEach(f => URL.revokeObjectURL(f.url)); IM.files = []; renderImg(); return; }
  if (ds.im === "zip") { buildImageZip(t); return; }
  if (ds.crop !== undefined) { openCrop(IM.k, ds.crop); return; }
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
});
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
@media (max-width:700px){.loghead{grid-template-columns:6.5em 1fr;}.loghead .lk,.loghead .lb{display:none}}
`;
  document.head.appendChild(s);
}
