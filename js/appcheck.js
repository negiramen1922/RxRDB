// Firebase アプリの初期化と App Check（reCAPTCHA Enterprise＝Fraud Defense）。
// 管理画面（fb.js 経由）・ログイン（user.js）・公開サイトのご意見送信が使う。一般の閲覧では読み込まれない。
// App Check を「適用」にすると、このサイトのページからのアクセス以外は Firestore に拒否される（不正な大量書き込みの対策）
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCYj4L5oskCq3mOM3vuRJoSzaC8n1at0dM",
  authDomain: "my-log-vh3o3b.firebaseapp.com",
  projectId: "my-log-vh3o3b",
  storageBucket: "my-log-vh3o3b.firebasestorage.app",
  messagingSenderId: "259834284152",
  appId: "1:259834284152:web:78a601e30e6da654b4058d"
};
// reCAPTCHA Enterprise のサイトキー（公開してよい値。Google Cloud の Fraud Defense で negiramen1922.github.io 用に作成）
export const APPCHECK_KEY = "6LfU4-wtAAAAAFfVg1892CXAOTaDr252UMb6P434";

export const app = getApps()[0] || initializeApp(firebaseConfig);
// ローカル確認（localhost）ではキーのドメインに合わないので使わない
const LOCAL = /^(localhost|127\.)/.test(location.hostname);
let AC = null;
export const ready = LOCAL ? Promise.resolve(null) : import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js")
  .then(m => { AC = { m, ac: m.initializeAppCheck(app, { provider: new m.ReCaptchaEnterpriseProvider(APPCHECK_KEY), isTokenAutoRefreshEnabled: true }) }; return AC; })
  .catch(e => { console.warn("App Check", e); return null; });
// REST で Firestore に書くとき（公開サイトのご意見送信）に付けるトークン。取れなければ空
export async function appCheckToken() {
  const a = await ready; if (!a) return "";
  try { return (await a.m.getToken(a.ac, false)).token || ""; } catch (e) { console.warn("App Check", e); return ""; }
}
