import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Resolves once Firebase has restored (or failed to restore) the saved
// session. auth.currentUser is null until then, even for a signed-in admin.
export function waitForUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Reads the admin claim. forceRefresh pulls a fresh token so a claim that
// was just granted or revoked shows up without signing out.
export async function isAdmin(user, forceRefresh = false) {
  const { claims } = await user.getIdTokenResult(forceRefresh);
  return claims.admin === true;
}
