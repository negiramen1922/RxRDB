// 一般ユーザーのログインと、所持キャラなどの記録のアカウント保存（公開サイトから必要なときだけ読み込む ES module）
// ・ログインしない人には読み込まれない（公開サイトの読み込みは今まで通り public/all だけ）
// ・記録は users/{uid} の1ドキュメント（d＝下の SYNC の項目を JSON にした文字列、t＝保存時刻）。開いたときに1回読み、変更は数秒まとめて1回書く
import * as F from "./fb.js";
import { GoogleAuthProvider, TwitterAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const R = window.RXR;
const esc = R.esc;
// アカウントに保存する項目（所持キャラ・所持スクリプト・共有名・自分用Tier表・並び・運用メモ・階層メモ・くらべるトレイ）
const SYNC = ["own", "sown", "ownName", "tiers", "tord", "tnote", "notes", "cmp", "ccmp"];
const LS = { on: "rxr-login", uid: "rxr-login-uid", dirty: "rxr-sync-dirty" };
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }, del(k) { try { localStorage.removeItem(k); } catch (_) {} } };

const U = { user: null, ready: false, synced: false, last: "", at: null, busy: false, err: "", timer: 0 };
const pick = () => { const S = R.S, o = {}; SYNC.forEach(k => { if (S[k] !== undefined && S[k] !== null) o[k] = S[k]; }); return o; };
const isEmpty = o => !o || SYNC.every(k => { const v = o[k]; return v === undefined || v === null || v === "" || (typeof v === "object" && !Object.keys(v).length); });
const userRef = uid => F.doc(F.db, "users", uid);

function apply(o) { const S = R.S; SYNC.forEach(k => { if (o && o[k] !== undefined) S[k] = o[k]; else if (k === "ownName") delete S[k]; else S[k] = Array.isArray(S[k]) ? [] : {}; }); if (!S.tiers) S.tiers = {}; if (!S.notes) S.notes = {}; R.saveLocal(); R.renderUser(); }
// 合わせる：所持は多いほう（★の大きいほう）、ほかは階層・キャラごとにアカウント側を優先して足りない分をこの端末から
function merge(cloud, local) {
  const o = Object.assign({}, local, cloud);
  for (const k of ["own", "sown"]) { const a = Object.assign({}, local[k] || {}); for (const [id, v] of Object.entries(cloud[k] || {})) a[id] = Math.max(+a[id] || 0, +v || 0) || a[id] || v; o[k] = a; }
  for (const k of ["tiers", "tord", "tnote", "notes"]) o[k] = Object.assign({}, local[k] || {}, cloud[k] || {});
  for (const k of ["cmp", "ccmp"]) o[k] = [...new Set([...(cloud[k] || []), ...(local[k] || [])])].slice(0, 4);
  return o;
}

async function upload(force) {
  if (!U.user || !U.synced) return;
  const d = JSON.stringify(pick());
  if (!force && d === U.last) { ls.del(LS.dirty); return; }
  if (d.length > 800000) { U.err = "記録が大きすぎてアカウントに保存できません"; renderDlg(); return; }
  try { await F.setDoc(userRef(U.user.uid), { d, t: F.serverTimestamp(), v: 1 }); U.last = d; U.at = new Date(); U.err = ""; ls.del(LS.dirty); }
  catch (e) { U.err = "アカウントへの保存に失敗しました（あとで自動でもう一度保存します）"; console.warn(e); clearTimeout(U.timer); U.timer = setTimeout(() => upload(), 15000); }
  renderDlg();
}
// index.html の save() から呼ばれる（記録が変わったら数秒まとめて保存）
function onSave() {
  if (!U.user || !U.synced) return;
  if (JSON.stringify(pick()) === U.last) return;
  ls.set(LS.dirty, String(Date.now()));
  clearTimeout(U.timer); U.timer = setTimeout(() => upload(), 3000);
}
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && U.timer) { clearTimeout(U.timer); U.timer = 0; upload(); } });

// ログインしたとき・開いたときに1回だけアカウントの記録を読む
async function syncIn(user) {
  U.synced = false; U.err = "";
  let snap;
  try { snap = await F.getDoc(userRef(user.uid)); } catch (e) { U.err = "アカウントの記録を読めませんでした。時間をおいて「今すぐ同期」を押してください"; console.warn(e); renderDlg(); return; }
  const local = pick(), sameUser = ls.get(LS.uid) === user.uid, dirty = +ls.get(LS.dirty) || 0;
  let cloud = null, ct = 0;
  if (snap.exists()) { try { cloud = JSON.parse(snap.data().d || "{}"); } catch (_) { cloud = {}; } const t = snap.data().t; ct = t && t.toMillis ? t.toMillis() : 0; }
  U.synced = true; ls.set(LS.uid, user.uid);
  if (!cloud) { U.last = ""; await upload(true); R.toast("この端末の記録をアカウントに保存しました"); return; }
  if (sameUser) {
    // 同じアカウントで前にも使った端末：保存しそこねた変更がアカウントより新しければこの端末、そうでなければアカウント
    if (dirty && dirty > ct) { U.last = JSON.stringify(cloud); await upload(); }
    else { U.last = JSON.stringify(cloud); if (JSON.stringify(local) !== U.last) apply(cloud); ls.del(LS.dirty); }
    renderDlg(); return;
  }
  // この端末で初めてログイン：この端末に記録がなければアカウントの記録を使う。両方あれば選んでもらう
  U.last = JSON.stringify(cloud);
  if (isEmpty(local) || JSON.stringify(local) === U.last) { apply(cloud); R.toast("アカウントの記録を読み込みました"); renderDlg(); return; }
  askMerge(cloud, local);
}
function askMerge(cloud, local) {
  const n = o => Object.keys(o.own || {}).length, ns = o => Object.keys(o.sown || {}).length, nt = o => Object.keys(o.tiers || {}).length;
  const row = (l, o) => `<li><b>${l}</b>：所持キャラ ${n(o)}・所持スクリプト ${ns(o)}・自分用Tier表 ${nt(o)}階層</li>`;
  dlg().querySelector(".dlg").innerHTML = `<h2>記録をどうしますか？</h2>
    <p class="hint">アカウントとこの端末の両方に記録があります。</p><ul class="acmerge">${row("アカウント", cloud)}${row("この端末", local)}</ul>
    <div class="acbtns col"><button class="btn primary" data-acm="merge">合わせる（おすすめ）<small>所持は多いほう、ほかはアカウント優先で足りない分を足す</small></button>
    <button class="btn" data-acm="cloud">アカウントの記録を使う<small>この端末の記録は消えます</small></button>
    <button class="btn" data-acm="local">この端末の記録でアカウントを上書き<small>アカウントの記録は消えます</small></button></div>`;
  dlg().onclick = async e => { const b = e.target.closest("[data-acm]"); if (!b) return; const m = b.dataset.acm; dlg().onclick = null;
    if (m === "cloud") apply(cloud); else if (m === "merge") { apply(merge(cloud, local)); await upload(true); } else await upload(true);
    R.toast(m === "cloud" ? "アカウントの記録を読み込みました" : m === "merge" ? "記録を合わせてアカウントに保存しました" : "この端末の記録をアカウントに保存しました"); renderDlg(); };
  if (!dlg().open) dlg().showModal();
}

/* ---- 画面 ---- */
let DLG = null;
function dlg() { if (DLG) return DLG; DLG = document.createElement("dialog"); DLG.id = "dlgAccount"; DLG.innerHTML = `<div class="dlg"></div>`; document.body.appendChild(DLG);
  const st = document.createElement("style"); st.textContent = `#dlgAccount{width:min(460px,calc(100% - 24px))}#dlgAccount h2{margin:0 0 8px}
.acbtns{display:flex;flex-direction:column;gap:8px;margin:12px 0}.acbtns .btn{width:100%;justify-content:center;padding:10px 12px;font-size:14px}.acbtns .btn small{display:block;font-size:11px;font-weight:500;opacity:.8;margin-top:2px}
.acbtns.col .btn{flex-direction:column;display:flex;align-items:center}
.acor{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;margin:14px 0 8px}.acor::before,.acor::after{content:"";flex:1;border-top:1px solid var(--line)}
.acform{display:grid;gap:8px}.acform input{width:100%;border:1px solid var(--line2);background:var(--field);padding:9px 10px;font-size:15px;color:var(--ink)}
.acrow{display:flex;gap:8px;flex-wrap:wrap}.acrow .btn{flex:1}
.acerr{color:#d33;font-size:13px;margin:8px 0 0;min-height:1em}.acinfo{background:var(--soft);padding:10px 12px;font-size:13px;line-height:1.7;margin:8px 0}
.acmerge{font-size:13px;line-height:1.8;padding-left:1.2em}.aclink{border:0;background:none;color:var(--accent-ink);text-decoration:underline;padding:0;font-size:12.5px;cursor:pointer}
.acgoogle::before{content:"G";font-weight:900;color:#4285f4;margin-right:8px}.acx::before{content:"𝕏";font-weight:900;margin-right:8px}`;
  document.head.appendChild(st);
  DLG.addEventListener("click", onClick); return DLG; }
const PROV = { "google.com": "Google", "twitter.com": "X", password: "メールアドレス" };
function renderDlg() {
  if (!DLG || !DLG.open || DLG.onclick) return;
  const b = DLG.querySelector(".dlg"), u = U.user;
  if (u) {
    const p = (u.providerData[0] || {}).providerId, who = u.email || u.displayName || "";
    b.innerHTML = `<h2>アカウント</h2>
      <div class="acinfo">${esc(PROV[p] || "")}でログイン中${who ? `<br><b>${esc(who)}</b>` : ""}<br>${U.synced ? `記録はアカウントに保存されています${U.at ? `（最後の保存 ${U.at.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}）` : ""}` : "アカウントの記録を確認しています…"}</div>
      <p class="hint">所持キャラ・所持スクリプト・自分用Tier表・メモ・運用メモ・くらべるトレイを保存しています。ほかの端末でも同じアカウントでログインすると同じ記録になります。</p>
      <p class="acerr">${esc(U.err)}</p>
      <div class="acbtns"><button class="btn" data-ac="sync">今すぐ同期</button><button class="btn" data-ac="out">ログアウト</button></div>
      <p style="text-align:right;margin:4px 0 0"><button class="aclink" data-ac="del">アカウントを削除する</button></p>
      <div class="foot"><button class="btn primary" data-close>閉じる</button></div>`;
    return;
  }
  const x = !!(window.SITE && window.SITE.authX);
  b.innerHTML = `<h2>ログイン・新規登録</h2>
    <p class="hint">ログインすると、所持キャラ・所持スクリプト・自分用Tier表・メモなどの記録をアカウントに保存できます。機種変更やブラウザのデータを消しても記録が残り、スマホとPCで同じ記録を使えます。ログインしなくても今まで通り使えます。</p>
    <div class="acbtns"><button class="btn acgoogle" data-ac="google">Google でログイン</button>${x ? `<button class="btn acx" data-ac="x">X（Twitter）でログイン</button>` : ""}</div>
    <div class="acor">メールアドレスで</div>
    <div class="acform"><input type="email" id="acMail" placeholder="メールアドレス" autocomplete="email"><input type="password" id="acPass" placeholder="パスワード（6文字以上）" autocomplete="current-password">
      <div class="acrow"><button class="btn primary" data-ac="mlogin">ログイン</button><button class="btn" data-ac="msignup">新規登録</button></div>
      <p style="margin:0"><button class="aclink" data-ac="reset">パスワードを忘れた</button></p></div>
    <p class="acerr" id="acErr">${esc(U.err)}</p>
    <p class="hint" style="font-size:11.5px">メールアドレスなどのアカウント情報はログインのためだけに使い、ほかの人には表示されません。</p>
    <div class="foot"><button class="btn" data-close>閉じる</button></div>`;
}
const ERR = { "auth/invalid-email": "メールアドレスの形が正しくありません", "auth/missing-password": "パスワードを入力してください", "auth/weak-password": "パスワードは6文字以上にしてください", "auth/email-already-in-use": "このメールアドレスはもう登録されています。「ログイン」を押してください", "auth/invalid-credential": "メールアドレスかパスワードが違います", "auth/wrong-password": "メールアドレスかパスワードが違います", "auth/user-not-found": "メールアドレスかパスワードが違います", "auth/too-many-requests": "何度も失敗したため、しばらくログインできません。時間をおいてください", "auth/popup-closed-by-user": "", "auth/cancelled-popup-request": "", "auth/operation-not-allowed": "このログイン方法はまだ使えません", "auth/account-exists-with-different-credential": "このメールアドレスは別のログイン方法で登録されています。前に使った方法でログインしてください", "auth/network-request-failed": "通信できませんでした", "auth/requires-recent-login": "安全のため、もう一度ログインしてから削除してください" };
const errMsg = e => { const c = e && e.code; return c in ERR ? ERR[c] : `うまくいきませんでした（${c || e}）`; };
function setErr(m) { U.err = m; const el = DLG && DLG.querySelector(".acerr"); if (el) el.textContent = m; }
async function popup(p) {
  try { await signInWithPopup(F.auth, p); }
  catch (e) { if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) { await signInWithRedirect(F.auth, p); return; } throw e; }
}
async function onClick(e) {
  const t = e.target.closest("[data-ac]"); if (!t || U.busy) return; const a = t.dataset.ac;
  const mail = () => (document.getElementById("acMail") || {}).value.trim(), pass = () => (document.getElementById("acPass") || {}).value;
  U.busy = true; t.disabled = true; setErr("");
  try {
    if (a === "google") await popup(new GoogleAuthProvider());
    else if (a === "x") await popup(new TwitterAuthProvider());
    else if (a === "mlogin") await signInWithEmailAndPassword(F.auth, mail(), pass());
    else if (a === "msignup") await createUserWithEmailAndPassword(F.auth, mail(), pass());
    else if (a === "reset") { if (!mail()) setErr("メールアドレスを入れてから押してください"); else { await sendPasswordResetEmail(F.auth, mail()); R.toast("パスワードを設定し直すメールを送りました（届かないときは迷惑メールも見てください）", 6000); } }
    else if (a === "sync") { await upload(); if (U.user) await syncIn(U.user); R.toast("同期しました"); }
    else if (a === "out") { await upload(); await signOut(F.auth); R.toast("ログアウトしました（この端末の記録はそのまま残ります）"); }
    else if (a === "del") {
      if (confirm("アカウントと、アカウントに保存した記録を削除しますか？（この端末の記録は残ります）元に戻せません。")) {
        const u = U.user; await F.deleteDoc(userRef(u.uid));
        try { await deleteUser(u); } catch (x) { await upload(true); throw x; }   // 削除できなかったときは記録を戻す
        ls.del(LS.uid); R.toast("アカウントを削除しました");
      }
    }
  } catch (x) { setErr(errMsg(x)); }
  U.busy = false; if (t.isConnected) t.disabled = false;
}
function setBtn() { document.querySelectorAll("[data-account]").forEach(b => { if (b.dataset.account === "head") b.textContent = U.user ? "アカウント" : "ログイン"; }); }

export function open() { dlg(); DLG.onclick = null; if (!DLG.open) DLG.showModal(); renderDlg(); }
export function init() {
  R.setSaveHook(onSave);
  getRedirectResult(F.auth).catch(e => { U.err = errMsg(e); });
  onAuthStateChanged(F.auth, async u => {
    const was = U.user; U.user = u; U.ready = true;
    if (u) { ls.set(LS.on, "1"); R.setLoggedIn(true); setBtn(); renderDlg(); await syncIn(u); }
    else { if (was) { clearTimeout(U.timer); } U.synced = false; U.last = ""; ls.del(LS.on); R.setLoggedIn(false); setBtn(); renderDlg(); }
  });
}
