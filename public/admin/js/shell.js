import { signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { auth, waitForUser, isAdmin } from "./firebase.js";

// One entry per page. `ready: false` shows the link greyed out with a
// "Soon" badge until that phase's page exists.
const NAV = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "space_dashboard", href: "/admin/", ready: true },
      { id: "audit-log", label: "Audit Log", icon: "history", href: "/admin/audit-log.html", ready: false },
    ],
  },
  {
    label: "Telemetry",
    items: [
      { id: "tokens", label: "Token Tracking", icon: "bolt", href: "/admin/tokens.html", ready: false },
      { id: "errors", label: "Error Log", icon: "error", href: "/admin/errors.html", ready: false },
    ],
  },
  {
    label: "Governance",
    items: [
      { id: "users", label: "User Directory", icon: "group", href: "/admin/users.html", ready: false },
      { id: "content", label: "Content & Libraries", icon: "menu_book", href: "/admin/content.html", ready: false },
      { id: "config", label: "Remote Config", icon: "tune", href: "/admin/config.html", ready: false },
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function initials(user) {
  const source = user.displayName || user.email || "?";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function navHtml(active) {
  return NAV.map((group) => `
    <div class="nav-group">
      <div class="nav-group-label">${group.label}</div>
      ${group.items.map((item) => `
        <a class="nav-link" href="${item.href}"
          ${item.id === active ? 'aria-current="page"' : ""}
          ${item.ready ? "" : 'aria-disabled="true" tabindex="-1"'}>
          <span class="material-symbols-outlined">${item.icon}</span>
          ${item.label}
          ${item.ready ? "" : '<span class="badge badge-info">Soon</span>'}
        </a>`).join("")}
    </div>`).join("");
}

function userChipHtml(user) {
  const avatar = user.photoURL
    ? `<img class="avatar" src="${escapeHtml(user.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="avatar">${escapeHtml(initials(user))}</span>`;
  return `
    <div class="user-chip">
      ${avatar}
      <div class="user-chip-text">
        <div class="user-chip-name">${escapeHtml(user.displayName || user.email)}</div>
        <div class="user-chip-role">Admin</div>
      </div>
      <button class="icon-btn" id="sign-out" type="button" aria-label="Sign out" title="Sign out">
        <span class="material-symbols-outlined">logout</span>
      </button>
    </div>`;
}

function renderShell({ active, crumbs, user }) {
  const shell = document.querySelector(".shell");
  const crumbHtml = crumbs
    .map((crumb, i) => (i === crumbs.length - 1
      ? `<strong>${escapeHtml(crumb)}</strong>`
      : `<span>${escapeHtml(crumb)}</span><span aria-hidden="true">/</span>`))
    .join("");

  shell.insertAdjacentHTML("afterbegin", `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-mark"><span class="material-symbols-outlined">shelves</span></span>
        <div>
          <div class="brand-name">ShelfSnap</div>
          <div class="brand-sub">Admin Console</div>
        </div>
      </div>
      <nav class="nav" aria-label="Admin">${navHtml(active)}</nav>
      <div class="sidebar-footer">${userChipHtml(user)}</div>
    </aside>
    <div class="scrim" id="scrim"></div>`);

  document.querySelector(".main").insertAdjacentHTML("afterbegin", `
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Open menu"
        aria-controls="sidebar" aria-expanded="false">
        <span class="material-symbols-outlined">menu</span>
      </button>
      <nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}</nav>
    </header>`);

  const menuBtn = document.getElementById("menu-btn");
  const setNavOpen = (open) => {
    shell.dataset.navOpen = String(open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => setNavOpen(shell.dataset.navOpen !== "true"));
  document.getElementById("scrim").addEventListener("click", () => setNavOpen(false));

  document.getElementById("sign-out").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("/admin/login.html");
  });
}

// Every admin page calls this first. It sends signed-out visitors to the
// login page and non-admins to the not-admin page, then draws the sidebar
// and top bar and hands back the user.
export async function startAdminPage({ active, crumbs }) {
  const user = await waitForUser();
  if (!user) {
    location.replace("/admin/login.html");
    return new Promise(() => {});
  }
  if (!(await isAdmin(user))) {
    location.replace("/admin/not-admin.html");
    return new Promise(() => {});
  }

  renderShell({ active, crumbs, user });
  document.getElementById("boot")?.remove();
  return user;
}

export { escapeHtml };
