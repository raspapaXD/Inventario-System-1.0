/// src/firebaseClient.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
   apiKey: "AIzaSyCMrEjUiMNnnaKniSg0MVtfdWU_ZVTO6TI",
  authDomain: "tek-inventory.firebaseapp.com",
  projectId: "tek-inventory",
  storageBucket: "tek-inventory.firebasestorage.app",
  messagingSenderId: "141762912469",
  appId: "1:141762912469:web:4718234f427b338a82825c"
};

// Reutiliza la app si ya está creada (hot-reload de Vite)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
