// Firebase 初期化（管理画面とログインした人だけが読み込む。一般の閲覧では読み込まれない）。アプリの初期化と App Check は appcheck.js
import { app, firebaseConfig, ready } from "./appcheck.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, query, orderBy, limit, documentId, where, serverTimestamp, Timestamp, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// オーナー（メンバーの追加・削除ができる人）。firestore.rules と同じにすること
export const OWNER = "negiramen23@gmail.com";

// App Check の準備ができてから Firestore を使い始める（最初の読み込みからトークンが付くように）
await ready;
export { app, firebaseConfig };
export const auth = getAuth(app);
export const db = getFirestore(app);
export { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, query, orderBy, limit, documentId, where, serverTimestamp, Timestamp, getCountFromServer };
