// Firebase 初期化（管理画面だけが読み込む。一般の閲覧では読み込まれない）
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, query, orderBy, limit, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCYj4L5oskCq3mOM3vuRJoSzaC8n1at0dM",
  authDomain: "my-log-vh3o3b.firebaseapp.com",
  projectId: "my-log-vh3o3b",
  storageBucket: "my-log-vh3o3b.firebasestorage.app",
  messagingSenderId: "259834284152",
  appId: "1:259834284152:web:78a601e30e6da654b4058d"
};
// オーナー（メンバーの追加・削除ができる人）。firestore.rules と同じにすること
export const OWNER = "negiramen23@gmail.com";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, query, orderBy, limit, documentId };
