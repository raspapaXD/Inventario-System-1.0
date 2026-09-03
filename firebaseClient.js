import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
console.log("DBG apiKey:", import.meta.env.VITE_FIREBASE_API_KEY);
console.log("DBG projectId:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

// Ayuda para detectar rápidamente un .env mal configurado en desarrollo:
if (!firebaseConfig?.projectId) {
  // eslint-disable-next-line no-console
  console.error(
    "⚠️ Firebase 'projectId' no está definido. Revisa tu archivo .env.local y que las variables empiecen por VITE_."
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
