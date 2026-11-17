import { auth } from "./firebase.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
    location.replace("/admin/login.html");
  } else if (res.status === 403) {
    location.replace("/admin/not-admin.html");
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data;
}
