import { signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { auth } from "./firebase.js";

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Calls /api/admin/<path> with the signed-in admin's ID token. The server
// checks the admin claim again on every call; the page check is only UX.
export async function api(path, { method = "GET", body } = {}) {
  const user = auth.currentUser;
  if (!user) {
    location.replace("/admin/login.html");
    throw new ApiError(401, "Not signed in");
  }

  const token = await user.getIdToken();
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    // Sign out first: the login page sends a signed-in admin straight back
    // here, so leaving the session in place would bounce between the two.
    await signOut(auth).catch(() => {});
    location.replace("/admin/login.html?reason=rejected");
  } else if (res.status === 403) {
    location.replace("/admin/not-admin.html");
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  }
  return data;
}
