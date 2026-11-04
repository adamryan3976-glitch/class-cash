// Paste your Firebase web app config here.
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config
// These values are not secret: access to data is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDdoceBDkPjIv5n_kg7XnzNlIzRDwXfoZw",
  authDomain: "class-cash-1c794.firebaseapp.com",
  projectId: "class-cash-1c794",
  storageBucket: "class-cash-1c794.firebasestorage.app",
  messagingSenderId: "486439780854",
  appId: "1:486439780854:web:7b56b3e843ac6f843907d7",
};

export const FIREBASE_VERSION = "10.12.2";

// Only Google accounts on this domain can sign in as teachers.
// The real enforcement is in firestore.rules; keep the two in sync.
export const ALLOWED_DOMAIN = "ddsb.ca";
