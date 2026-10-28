// ユーザー投稿（みんなの攻略）のデータ部分。公開サイトで「みんなの攻略」を開いたとき・投稿するときだけ読み込む ES module。
// 画面は index.html が作る（ここは Firestore の読み書きだけ）。
// posts/{pid}：uid・name（投稿したときの投稿者名）・f（階層キー）・title・body（自由記述）・m（編成の JSON 文字列
//   [[キャラID,★,覚醒Lv,BLADE Lv,スクリプトID,スクリプト凸,スクリプトランク,出撃順]…]）・w（WAVEごとのメモの JSON 文字列 [文…]）・v（動画のURL）・
//   at（投稿時刻）・t（更新時刻）・likes・views・rc（通報の数）・hidden（運営が非表示）
// posts/{pid}/likes/{uid}：いいね（1人1回）。reports/{pid_uid}：通報（1人1回）。profiles/{uid}：投稿者名・フレンドID・公開するか。banned/{uid}：投稿停止
import * as F from "./fb.js";
import { collection, query, where, limit, getDocs, getDoc, doc, writeBatch, runTransaction, serverTimestamp, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = F.db;
export const LIM = { title: 40, body: 500, wave: 300, waves: 20, name: 20, fid: 40, video: 300 };
export const HIDE_AT = 3;   // 通報がこの数になったら一覧に出さない（運営が確認する）
const me = () => F.auth.currentUser;
export const user = () => { const u = me(); return u ? { uid: u.uid } : null; };
export function onUser(fn) { return F.onAuthStateChanged(F.auth, u => fn(u ? { uid: u.uid } : null)); }

const ts = v => v && v.toMillis ? v.toMillis() : 0;
function toPost(d) {
  const x = d.data(); let m = [], w = [];
  try { m = JSON.parse(x.m || "[]"); } catch (e) { }
  try { w = JSON.parse(x.w || "[]"); } catch (e) { }
  return { id: d.id, uid: x.uid, name: x.name || "", f: x.f || "", title: x.title || "", body: x.body || "", m: Array.isArray(m) ? m : [], w: Array.isArray(w) ? w : [], v: x.v || "", at: ts(x.at), t: ts(x.t), likes: x.likes || 0, views: x.views || 0, rc: x.rc || 0, hidden: !!x.hidden };
}
const visible = p => !p.hidden && p.rc < HIDE_AT;

export async function listByFloor(f) { const q = await getDocs(query(collection(db, "posts"), where("f", "==", f), limit(100))); return q.docs.map(toPost).filter(visible); }
export async function listByUser(uid, all) { const q = await getDocs(query(collection(db, "posts"), where("uid", "==", uid), limit(100))); return q.docs.map(toPost).filter(p => all || visible(p)); }
export async function get(pid) { const s = await getDoc(doc(db, "posts", pid)); return s.exists() ? toPost(s) : null; }

const clip = (s, n) => String(s || "").trim().slice(0, n);
// o：{id?, f, title, body, m:[…], w:[…], v}。新しい投稿は id 無し
export async function save(o) {
  const u = me(); if (!u) throw new Error("login");
  const prof = await getProfile(u.uid);
  const name = clip(prof && prof.name, LIM.name); if (!name) throw new Error("name");
  const v = clip(o.v, LIM.video); if (v && !/^https?:\/\//i.test(v)) throw new Error("video");
  const body = { name, f: clip(o.f, 80), title: clip(o.title, LIM.title), body: clip(o.body, LIM.body), m: JSON.stringify(o.m || []).slice(0, 3000), w: JSON.stringify((o.w || []).slice(0, LIM.waves).map(x => clip(x, LIM.wave))), v, t: serverTimestamp() };
  if (o.id) { const b = writeBatch(db); b.update(doc(db, "posts", o.id), body); await b.commit(); return o.id; }
  const ref = doc(collection(db, "posts"));
  const b = writeBatch(db); b.set(ref, Object.assign({ uid: u.uid, at: serverTimestamp(), likes: 0, views: 0, rc: 0, hidden: false }, body)); await b.commit();
  return ref.id;
}
export async function remove(pid) { await deleteDoc(doc(db, "posts", pid)); }

// 閲覧数：同じ端末では1つの投稿につき1日1回だけ数える
export async function view(pid) {
  const k = "rxr-pv-" + pid, day = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem(k) === day) return false; localStorage.setItem(k, day); } catch (e) { }
  try { const b = writeBatch(db); b.update(doc(db, "posts", pid), { views: increment(1) }); await b.commit(); return true; } catch (e) { console.warn("view", e); return false; }
}
export async function liked(pid) { const u = me(); if (!u) return false; const s = await getDoc(doc(db, "posts", pid, "likes", u.uid)); return s.exists(); }
// いいね／取り消し（いいねの記録と数を一緒に書く。ルールで1人1回を確かめる）
export async function toggleLike(pid) {
  const u = me(); if (!u) throw new Error("login");
  const lr = doc(db, "posts", pid, "likes", u.uid), pr = doc(db, "posts", pid);
  return runTransaction(db, async tx => {
    const s = await tx.get(lr);
    if (s.exists()) { tx.delete(lr); tx.update(pr, { likes: increment(-1) }); return false; }
    tx.set(lr, { t: serverTimestamp() }); tx.update(pr, { likes: increment(1) }); return true;
  });
}
export async function report(pid, reason, text) {
  const u = me(); if (!u) throw new Error("login");
  const rr = doc(db, "reports", pid + "_" + u.uid), pr = doc(db, "posts", pid);
  return runTransaction(db, async tx => {
    const s = await tx.get(rr); if (s.exists()) return false;
    tx.set(rr, { pid, uid: u.uid, reason: clip(reason, 40), text: clip(text, 500), at: serverTimestamp() }); tx.update(pr, { rc: increment(1) }); return true;
  });
}
export async function getProfile(uid) { const s = await getDoc(doc(db, "profiles", uid)); return s.exists() ? s.data() : null; }
// 投稿者名を変えたら、自分の投稿に書いてある名前も直す
export async function saveProfile(p) {
  const u = me(); if (!u) throw new Error("login");
  const name = clip(p.name, LIM.name); if (!name) throw new Error("name");
  // フレンドIDは公開するときだけ保存する（プロフィールはだれでも読めるため）
  const b = writeBatch(db); b.set(doc(db, "profiles", u.uid), { name, fid: p.fpub ? clip(p.fid, LIM.fid) : "", fpub: !!p.fpub, t: serverTimestamp() });
  const mine = await listByUser(u.uid, true); mine.filter(x => x.name !== name).forEach(x => b.update(doc(db, "posts", x.id), { name, t: serverTimestamp() }));
  await b.commit();
}
export async function banned() { const u = me(); if (!u) return false; try { const s = await getDoc(doc(db, "banned", u.uid)); return s.exists(); } catch (e) { return false; } }
