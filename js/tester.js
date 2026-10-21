// テスターモード（公開前の確認のお願い用）。?tester=1 で開いた端末だけ index.html が読み込む（?tester=0 で終わる）。
// 画面の右端の「テスト」ボタンでチェックリスト（data/all.json の testlist、無ければ data/testlist.json）を開き、
// サイトを見ながら項目ごとに OK／気になる／できなかった・メモを付ける。記録はこの端末（localStorage rxr-test）に残り、
// 変更から少したつと testers/{tid}（d＝記録の JSON 文字列。編集者だけが読める）に自動で送る。結果は管理画面の「テスト」タブ。
const LS = "rxr-test";
const ST = { ok: "OK", ng: "気になる", na: "できなかった" };
let L = null;          // {groups:[{title, items:[{id,text,free}]}]}
let D = null;          // {tid, name, r:{id:{s,n,p,u,at}}, f:{id:text}, rep:[{id,text,p,u,at}], open:{}, sent, dirty}
let DLG = null, SENDT = null, SENDING = false, ERR = "", REPDRAFT = "";
const MEMO = new Set();   // メモ欄を開いている項目
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(""); };
const items = () => L.groups.flatMap(g => g.items);
const checks = () => items().filter(i => !i.free);
const done = () => checks().filter(i => D.r[i.id] && D.r[i.id].s).length;
const hm = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
// 今見ているページ（タブの題名と URL。報告に付ける）
const page = () => { const t = document.title; return { p: (/\|\s*RxRwiki/.test(t) ? t.replace(/\s*\|\s*RxRwiki.*$/, "") : "ホーム").slice(0, 80), u: location.href.slice(0, 300) }; };

function load() { try { D = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { D = null; } if (!D || !D.tid) D = { tid: rid(24), name: "", r: {}, f: {}, rep: [], open: { 0: true } }; }
function save(send) { if (send !== false) { D.dirty = true; ERR = ""; } try { localStorage.setItem(LS, JSON.stringify(D)); } catch (e) { } if (send !== false) schedule(); badge(); }
function schedule(ms) { clearTimeout(SENDT); SENDT = setTimeout(sendNow, ms == null ? 12000 : ms); }

async function sendNow() {
  clearTimeout(SENDT);
  if (!D.dirty || SENDING) return;
  if (!D.name.trim()) { foot(); return; }   // 名前を入れてから送る
  SENDING = true; foot();
  try {
    const ac = await import("./appcheck.js");
    const c = ac.firebaseConfig; let tk = ""; try { tk = await ac.appCheckToken(); } catch (e) { }
    const body = JSON.stringify({ name: D.name, r: D.r, f: D.f, rep: D.rep, n: done(), of: checks().length });
    const sv = v => ({ stringValue: String(v) });
    const name = `projects/${c.projectId}/databases/(default)/documents/testers/${D.tid}`;
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents:commit?key=${c.apiKey}`, {
      method: "POST", keepalive: body.length < 60000, headers: Object.assign({ "Content-Type": "application/json" }, tk ? { "X-Firebase-AppCheck": tk } : {}),
      body: JSON.stringify({ writes: [{ update: { name, fields: { name: sv(D.name.slice(0, 40)), d: sv(body), ua: sv(navigator.userAgent.slice(0, 200)), v: { integerValue: "1" } } },
        updateMask: { fieldPaths: ["name", "d", "ua", "v"] }, updateTransforms: [{ fieldPath: "t", setToServerValue: "REQUEST_TIME" }] }] })
    });
    if (!r.ok) throw new Error("送信できませんでした（" + r.status + "）");
    D.dirty = false; D.sent = Date.now(); save(false);
  } catch (e) { ERR = e.message || "送信できませんでした"; schedule(60000); }
  SENDING = false; foot();
}

/* ---- 画面 ---- */
const STYLE = `
.tstbtn{position:fixed;right:0;top:42%;z-index:45;writing-mode:vertical-rl;border:0;padding:12px 7px;font-weight:800;font-size:13px;letter-spacing:.1em;color:#fff;background:linear-gradient(180deg,#0f9e63,#19c38a);box-shadow:0 6px 18px rgba(0,0,0,.3);border-radius:8px 0 0 8px;cursor:pointer}
.tstbtn small{font-weight:700;letter-spacing:0;opacity:.9}
.tstin{position:sticky;top:0;z-index:6;display:block;margin:0 0 -30px auto;width:max-content;border:0;padding:4px 10px;font-size:12px;font-weight:800;color:#fff;background:#0f9e63;border-radius:0 0 0 8px;cursor:pointer}
#dlgTest{position:fixed;inset:0 0 0 auto;margin:0;width:min(440px,100%);max-width:100%;height:100%;max-height:100%;border-radius:0;padding:0;z-index:60}
#dlgTest[open]{display:flex;flex-direction:column}
@media (max-width:640px){#dlgTest{inset:auto 0 0 0;width:100%;height:68vh;border-radius:14px 14px 0 0}}
#dlgTest .th{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:linear-gradient(100deg,#0b6b45,#0f9e63);color:#fff}
#dlgTest .th b{font-size:16px}#dlgTest .th .x{margin-left:auto;border:0;background:rgba(255,255,255,.2);color:#fff;font-size:18px;width:34px;height:34px;border-radius:50%;cursor:pointer}
#dlgTest .tbar{height:6px;background:rgba(255,255,255,.3);border-radius:3px;flex:1;max-width:120px;overflow:hidden}#dlgTest .tbar i{display:block;height:100%;background:#fff}
#dlgTest .tb{overflow:auto;padding:10px 14px 16px;flex:1;overscroll-behavior:contain}
#dlgTest .tf{padding:8px 14px calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dlgTest .thint{font-size:12.5px;color:var(--muted);margin:0 0 8px}
#dlgTest .tname{display:flex;gap:6px;align-items:center;margin:0 0 10px;font-size:13px;font-weight:700}#dlgTest .tname input{flex:1;min-width:0;padding:6px 8px;border:1px solid var(--line2);background:var(--field);color:var(--ink);font-size:14px}
#dlgTest .tname.need input{border-color:var(--bad);box-shadow:0 0 0 2px rgba(226,61,99,.2)}
#dlgTest details.tg{border:1px solid var(--line);background:var(--panel);margin:0 0 8px;border-radius:6px}
#dlgTest details.tg>summary{cursor:pointer;padding:9px 10px;font-weight:800;display:flex;gap:8px;align-items:center;list-style:none}
#dlgTest details.tg>summary::-webkit-details-marker{display:none}#dlgTest details.tg>summary::before{content:"▶";font-size:10px;color:var(--muted)}#dlgTest details.tg[open]>summary::before{content:"▼"}
#dlgTest details.tg>summary .c{margin-left:auto;font-size:12px;color:var(--muted);font-weight:700}#dlgTest details.tg>summary .c.all{color:var(--good)}
#dlgTest .ti{padding:8px 10px;border-top:1px solid var(--line)}
#dlgTest .ti .tt{font-size:13.5px;line-height:1.5}#dlgTest .ti .tt .id{font-size:11px;color:var(--muted);font-weight:800;margin-right:5px}
#dlgTest .ti .tbs{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
#dlgTest .ti .tbs button{border:1px solid var(--line2);background:var(--field);color:var(--ink);padding:3px 10px;font-size:12.5px;font-weight:700;border-radius:14px;cursor:pointer}
#dlgTest .ti .tbs button[aria-pressed="true"].ok{background:var(--good);border-color:var(--good);color:#fff}
#dlgTest .ti .tbs button[aria-pressed="true"].ng{background:#f08c00;border-color:#f08c00;color:#fff}
#dlgTest .ti .tbs button[aria-pressed="true"].na{background:#6b7a92;border-color:#6b7a92;color:#fff}
#dlgTest .ti .tbs .memo{margin-left:auto}
#dlgTest textarea{width:100%;box-sizing:border-box;margin-top:6px;padding:6px 8px;border:1px solid var(--line2);background:var(--field);color:var(--ink);font:inherit;font-size:13.5px;min-height:3.4em;resize:vertical}
#dlgTest .tpg{font-size:11.5px;color:var(--muted);margin-top:2px}
#dlgTest .trep{border:1px dashed var(--line2);padding:8px 10px;margin:0 0 10px;border-radius:6px;background:var(--panel)}
#dlgTest .trep .r{font-size:12.5px;border-top:1px solid var(--line);padding:5px 0}#dlgTest .trep .r:first-of-type{border-top:0}
#dlgTest .tsm{border:0;background:none;color:var(--accent-ink);font-weight:700;font-size:12px;cursor:pointer;padding:0;text-decoration:underline}
#dlgTest .err{color:var(--bad);font-weight:700}
`;

export async function init() {
  load();
  try { const all = window.RXR && window.RXR.testlist; L = all && all.groups ? all : await fetch("data/testlist.json", { cache: "no-cache" }).then(r => r.json()); } catch (e) { L = null; }
  if (!L || !L.groups) { console.warn("テスト項目を読めませんでした"); return; }
  const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
  const b = document.createElement("button"); b.className = "tstbtn"; b.type = "button"; b.dataset.tst = "open"; document.body.appendChild(b);
  DLG = document.createElement("dialog"); DLG.id = "dlgTest"; DLG.setAttribute("aria-label", "テスト項目"); document.body.appendChild(DLG);
  DLG.addEventListener("cancel", e => { e.preventDefault(); DLG.close(); });
  document.addEventListener("click", onClick);
  DLG.addEventListener("input", onInput);
  DLG.addEventListener("toggle", e => { const g = e.target.closest && e.target.closest("details.tg"); if (g) { D.open[g.dataset.g] = g.open; save(false); } }, true);
  // ほかのダイアログ（キャラ詳細など）が開いている間は、その外のボタンは押せないので、ダイアログの中にもボタンを出す
  const inject = d => { if (d.tagName === "DIALOG" && d !== DLG && d.open && !d.querySelector(":scope>.tstin")) d.insertAdjacentHTML("afterbegin", `<button class="tstin" type="button" data-tst="open">✅ テスト項目</button>`); };
  new MutationObserver(ms => ms.forEach(m => inject(m.target))).observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
  document.querySelectorAll("dialog[open]").forEach(inject);
  addEventListener("pagehide", () => { if (D.dirty) sendNow(); });
  badge();
  if (!D.seen) { D.seen = 1; save(false); open(); }
  if (D.dirty) schedule(3000);
}
function badge() { const b = document.querySelector(".tstbtn"); if (b) b.innerHTML = `✅ テスト <small>${done()}/${checks().length}</small>`; }
function open() {
  render();
  if (DLG.open) DLG.close();
  // ほかのダイアログが開いていればその上に（モーダル）、そうでなければサイトを触れるまま横に出す
  if (document.querySelector("dialog:modal")) DLG.showModal(); else DLG.show();
}
function render() {
  const n = done(), of = checks().length, pg = page();
  const item = it => {
    const r = D.r[it.id] || {};
    if (it.free) return `<div class="ti"><div class="tt"><span class="id">${esc(it.id)}</span>${esc(it.text)}</div><textarea data-tf="${esc(it.id)}" maxlength="2000" placeholder="自由に書いてください">${esc(D.f[it.id] || "")}</textarea></div>`;
    const memo = MEMO.has(it.id) || !!r.n;
    return `<div class="ti" data-ti="${esc(it.id)}"><div class="tt"><span class="id">${esc(it.id)}</span>${esc(it.text)}</div>
      <div class="tbs">${Object.entries(ST).map(([k, l]) => `<button type="button" class="${k}" data-ts="${esc(it.id)}|${k}" aria-pressed="${r.s === k}">${l}</button>`).join("")}${r.n ? "" : `<button type="button" class="memo" data-tm="${esc(it.id)}">${memo ? "メモを閉じる" : "メモ"}</button>`}</div>
      ${memo ? `<textarea data-tn="${esc(it.id)}" maxlength="2000" placeholder="どうなった・どうしてほしい（見ているページも一緒に記録されます）">${esc(r.n || "")}</textarea><div class="tpg">${r.p ? `記録したページ：${esc(r.p)}` : `今のページ：${esc(pg.p)}`}</div>` : ""}</div>`;
  };
  DLG.innerHTML = `<div class="th"><b>テスト項目</b><span class="tbar"><i style="width:${of ? Math.round(n / of * 100) : 0}%"></i></span><span>${n}/${of}</span><button class="x" type="button" data-tst="close" aria-label="閉じる">×</button></div>
  <div class="tb"><p class="thint">サイトを見ながら、当てはまるものを選んでください。閉じても、ページを移っても記録は残ります（自動で送信されます）。全部でなくても大丈夫です。</p>
  <label class="tname${D.name.trim() ? "" : " need"}">お名前<input data-tname maxlength="40" placeholder="ニックネームでOK" value="${esc(D.name)}"></label>
  <div class="trep"><b style="font-size:13px">📝 この画面のことを報告</b><div class="tpg">今のページ：${esc(pg.p)}</div><textarea data-trep maxlength="2000" placeholder="項目と関係なく、気になったこと・不具合・データの間違いなど">${esc(REPDRAFT)}</textarea><div style="text-align:right;margin-top:4px"><button type="button" class="btn small primary" data-tst="rep">報告に追加</button></div>
  ${D.rep.length ? D.rep.slice().reverse().map(x => `<div class="r">${esc(x.text)}<div class="tpg">${esc(x.p)}・${hm(x.at)} <button class="tsm" type="button" data-trdel="${esc(x.id)}">取り消す</button></div></div>`).join("") : ""}</div>
  ${L.groups.map((g, gi) => { const cs = g.items.filter(i => !i.free), k = cs.filter(i => D.r[i.id] && D.r[i.id].s).length;
    return `<details class="tg" data-g="${gi}" ${D.open[gi] ? "open" : ""}><summary>${esc(g.title)}<span class="c${cs.length && k === cs.length ? " all" : ""}">${cs.length ? `${k}/${cs.length}` : ""}</span></summary>${g.items.map(item).join("")}</details>`; }).join("")}
  <p style="text-align:center;margin:14px 0 0"><button class="tsm" type="button" data-tst="quit">テスターモードを終わる</button></p></div>
  <div class="tf" id="tstfoot"></div>`;
  foot();
}
function foot() {
  const f = DLG && DLG.querySelector("#tstfoot"); if (!f) return;
  const st = SENDING ? "送信中…" : !D.name.trim() && D.dirty ? `<span class="err">お名前を入れると送信されます</span>` : ERR ? `<span class="err">${esc(ERR)}</span>` : D.dirty ? "未送信の変更があります（少したつと自動で送ります）" : D.sent ? `送信済み（${hm(D.sent)}）` : "まだ記録がありません";
  f.innerHTML = `<span style="flex:1">${st}</span>${D.dirty && D.name.trim() && !SENDING ? `<button type="button" class="btn small" data-tst="send">今すぐ送る</button>` : ""}`;
}
function onClick(e) {
  const t = e.target.closest("[data-tst],[data-ts],[data-tm],[data-trdel]"); if (!t) return;
  if (t.dataset.tst === "open") { e.preventDefault(); open(); return; }
  if (!DLG.contains(t)) return;
  const a = t.dataset.tst;
  if (a === "close") { DLG.close(); return; }
  if (a === "send") { sendNow(); return; }
  if (a === "quit") { if (!confirm("テスターモードを終わりますか？（記録は送信済みの分が残ります。もう一度テストするときは、もらったリンクから開き直してください）")) return; if (D.dirty) sendNow(); try { localStorage.removeItem("rxr-tester"); } catch (x) { } DLG.close(); document.querySelectorAll(".tstbtn,.tstin").forEach(x => x.remove()); return; }
  if (a === "rep") { const ta = DLG.querySelector("[data-trep]"); const v = ta.value.trim(); if (!v) { ta.focus(); return; } D.rep.push(Object.assign({ id: rid(8), text: v.slice(0, 2000), at: Date.now() }, page())); REPDRAFT = ""; save(); keepScroll(render); return; }
  if (t.dataset.trdel) { D.rep = D.rep.filter(x => x.id !== t.dataset.trdel); save(); keepScroll(render); return; }
  if (t.dataset.ts) { const [id, s] = t.dataset.ts.split("|"); const r = D.r[id] || (D.r[id] = {}); r.s = r.s === s ? "" : s; if (!r.p && (r.s === "ng" || r.s === "na")) Object.assign(r, page()); r.at = Date.now(); if (r.s === "ng") MEMO.add(id); save(); keepScroll(render); if (r.s === "ng") { const ta = DLG.querySelector(`[data-tn="${CSS.escape(id)}"]`); if (ta && !ta.value) ta.focus(); } return; }
  if (t.dataset.tm) { const id = t.dataset.tm; if (MEMO.has(id)) MEMO.delete(id); else MEMO.add(id); keepScroll(render); const ta = DLG.querySelector(`[data-tn="${CSS.escape(id)}"]`); if (ta) ta.focus(); return; }
}
function onInput(e) {
  const el = e.target;
  if (el.matches("[data-trep]")) { REPDRAFT = el.value; return; }
  if (el.matches("[data-tname]")) { D.name = el.value; el.parentElement.classList.toggle("need", !el.value.trim()); save(); foot(); return; }
  if (el.dataset.tf) { D.f[el.dataset.tf] = el.value.slice(0, 2000); save(); return; }
  if (el.dataset.tn) { const r = D.r[el.dataset.tn] || (D.r[el.dataset.tn] = {}); r.n = el.value.slice(0, 2000); if (!r.p) Object.assign(r, page()); r.at = Date.now(); save(); }
}
function keepScroll(fn) { const b = DLG.querySelector(".tb"), y = b ? b.scrollTop : 0; fn(); const b2 = DLG.querySelector(".tb"); if (b2) b2.scrollTop = y; }
