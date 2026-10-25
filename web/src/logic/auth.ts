// Firebase Auth (Google sign-in). Without PUBLIC_FIREBASE_API_KEY the app runs in local mode:
// no sign-in, and the API must run with NIDO_AUTH=none.
import type { Auth, User } from "firebase/auth";

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID as string | undefined,
};

export const authEnabled = Boolean(config.apiKey);

let authPromise: Promise<Auth> | null = null;

// Loaded on demand so local mode never downloads the Firebase SDK.
function getAuthInstance(): Promise<Auth> {
  authPromise ??= (async () => {
    const [{ initializeApp }, { getAuth }] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
    ]);
    return getAuth(initializeApp(config));
  })();
  return authPromise;
}

export async function watchUser(callback: (user: User | null) => void): Promise<() => void> {
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(await getAuthInstance(), callback);
}

export async function signIn(): Promise<void> {
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  await signInWithPopup(await getAuthInstance(), new GoogleAuthProvider());
}

export async function signOut(): Promise<void> {
  const { signOut: firebaseSignOut } = await import("firebase/auth");
  await firebaseSignOut(await getAuthInstance());
}

export async function idToken(): Promise<string | null> {
  if (!authEnabled) return null;
  const user = (await getAuthInstance()).currentUser;
  return user ? user.getIdToken() : null;
}
