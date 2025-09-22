// src/config/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCMrEjUiMNnnaKniSg0MVtfdWU_ZVTO6TI",
  authDomain: "tek-inventory.firebaseapp.com",
  projectId: "tek-inventory",
  storageBucket: "tek-inventory.appspot.com",
  messagingSenderId: "141762912469",
  appId: "1:141762912469:web:4718234f427b338a82825c"
};

const app = initializeApp(firebaseConfig)


export const db = getFirestore(app);
export const storage = getStorage(app);


