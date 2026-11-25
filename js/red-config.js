// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBvPU_mb8I-aL3kVYE7MZRYWO_NsiA5yiw",
  authDomain: "tp-simulacion1.firebaseapp.com",
  databaseURL: "https://tp-simulacion1-default-rtdb.firebaseio.com",
  projectId: "tp-simulacion1",
  storageBucket: "tp-simulacion1.firebasestorage.app",
  messagingSenderId: "278631085234",
  appId: "1:278631085234:web:3bf4dcda3ed5ed18d145ab",
  measurementId: "G-SJ2GB0PYRB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);