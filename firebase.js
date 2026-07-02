/* ============================================================
   Cagómetro · Firebase init
   On localhost  -> connects to the local emulators (safe dev).
   In production -> uses the real project (fill PROD_CONFIG later
   from Firebase Console → Project settings → Your apps → Web).
   ============================================================ */
import {
  initializeApp,
  getAuth, connectAuthEmulator,
  getFirestore, connectFirestoreEmulator,
  getMessaging, getToken, onMessage, isSupported,
} from "./firebase-bundle.js";

// Use emulators on localhost, EXCEPT when ?prod is in the URL (to test the real
// project from your Mac before hosting). On a real domain it's always prod.
const FORCE_PROD = new URLSearchParams(location.search).has("prod");
export const IS_LOCAL = !FORCE_PROD && ["localhost", "127.0.0.1"].includes(location.hostname);

// In the emulator a demo projectId + dummy apiKey is all that's needed.
const DEMO_CONFIG = { projectId: "demo-cagometro", apiKey: "demo-key", authDomain: "localhost" };

// Real project (cagometro-app). The apiKey is public by design — protected by
// Firestore security rules.
const PROD_CONFIG = {
  apiKey: "AIzaSyAPDB_Jw8JePerKkaTlPzNx5NC8AXK2qhc",
  authDomain: "cagometro-app.firebaseapp.com",
  projectId: "cagometro-app",
  storageBucket: "cagometro-app.firebasestorage.app",
  messagingSenderId: "877322489104",
  appId: "1:877322489104:web:5db0fa4edaec9f8a886995",
};

export const app  = initializeApp(IS_LOCAL ? DEMO_CONFIG : PROD_CONFIG);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Cloud Messaging (push) ─────────────────────────────────────────────
// Clave pública del certificado push web (Console → Cloud Messaging).
export const VAPID_KEY = "BBTE4Qf92an4In805pKi72wb63haMD2zOIskrMQkBmiqRIW9fHAmT9qWDz5w_YrIWUwFjcHgX_2cJztD2h7U1p8";
export { getToken, onMessage };
// Devuelve la instancia de messaging si el navegador lo soporta (y no es emulador).
export async function getMessagingIfSupported(){
  try{ if (IS_LOCAL) return null; if (!(await isSupported())) return null; return getMessaging(app); }
  catch(e){ return null; }
}

if (IS_LOCAL) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8081);
  console.log("🔧 Cagómetro: usando emuladores locales de Firebase");
}
