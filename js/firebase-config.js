// Paste your Firebase web app config here.
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config
// These values are not secret: access to data is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

export const FIREBASE_VERSION = "10.12.2";

// Only Google accounts on this domain can sign in as teachers.
// The real enforcement is in firestore.rules; keep the two in sync.
export const ALLOWED_DOMAIN = "ddsb.ca";
