// Shared pieces for the admin pages: drawer, confirm dialog, toasts, and
// the small HTML builders every list uses.
import { escapeHtml } from "./shell.js";

// ---------- HTML builders ----------

export function icon(name) {
  return `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
}

export function alertHtml(kind, iconName, html) {
  return `<div class="alert alert-${kind}">${icon(iconName)}<span>${html}</span></div>`;
}

export function emptyHtml(iconName, message) {
  return `<div class="empty-state">${icon(iconName)}<span>${escapeHtml(message)}</span></div>`;
}

export function loadingHtml(message = "Loading…") {
  return `<div class="empty-state">${icon("hourglass_empty")}<span>${escapeHtml(message)}</span></div>`;
}

/**
 * The error box for a failed list load. A missing Firestore index gets the
 * one-time setup link instead of a plain error.
 */
export function loadErrorHtml(err, what) {
  const indexUrl = err.data?.createIndexUrl;
  if (indexUrl) {
    return alertHtml("warning", "build", `This filter needs a Firestore index. It's a one-time setup:
      <a href="${escapeHtml(indexUrl)}" target="_blank" rel="noopener">create the index</a>,
      wait a few minutes for it to build, then try again.`);
  }
  return alertHtml("error", "error", escapeHtml(`Couldn't load ${what}: ${err.message}`));
}

function initialsOf(text) {
  return String(text || "?")
    .split(/[\s@._]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";
}

export function avatarHtml(person, size = "") {
  const label = person.name || person.username || person.email || "?";
  const cls = `avatar${size ? ` avatar-${size}` : ""}`;
  return person.photoUrl
    ? `<img class="${cls}" src="${escapeHtml(person.photoUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="${cls}" aria-hidden="true">${escapeHtml(initialsOf(label))}</span>`;
}

/** "@username" with the display name under it, falling back to the uid. */
export function personHtml(person, { withUid = false } = {}) {
  const primary = person.username ? `@${person.username}` : person.name || "No profile";
  const secondary = person.username && person.name ? person.name : null;
  return `
    <span class="person">
      ${avatarHtml(person)}
      <span class="person-text">
        <strong>${escapeHtml(primary)}</strong>
        ${secondary ? `<span class="muted">${escapeHtml(secondary)}</span>` : ""}
        ${withUid ? `<span class="uid">${escapeHtml(person.uid)}</span>` : ""}
      </span>
    </span>`;
}

/** A book cover, or a plain green block with the title's first letter. */
export function coverHtml(url, title, size = "") {
  const cls = `cover${size ? ` cover-${size}` : ""}`;
  return url
    ? `<img class="${cls}" src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="${cls} cover-blank" aria-hidden="true">${escapeHtml((title || "?")[0])}</span>`;
}

const ACCESS_BADGES = {
  public: ["badge-primary", "public", "Public"],
  unlisted: ["badge-secondary", "link", "Unlisted"],
  private: ["badge-info", "lock", "Private"],
};

export function accessBadge(access) {
  const [cls, iconName, label] = ACCESS_BADGES[access] ?? ACCESS_BADGES.private;
  return `<span class="badge ${cls}">${icon(iconName)}${label}</span>`;
}

const STATUS_BADGES = {
  requested: "badge-accent",
  approved: "badge-primary",
  lent: "badge-secondary",
  returned: "badge-info",
  cancelled: "badge-info",
  rejected: "badge-info",
  lost: "badge-error",
  pending: "badge-warning",
  accepted: "badge-primary",
};

export function statusBadge(status) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="badge ${STATUS_BADGES[status] ?? "badge-info"}">${escapeHtml(label)}</span>`;
}

export function catalogUrl(handle) {
  return `${location.origin}/lib/${encodeURIComponent(handle)}`;
}

// ---------- Toasts ----------

let toastRegion;

// The region is a popover, so it sits in the top layer above an open drawer
// or dialog. Re-showing it moves it back on top of anything opened since.
export function toast(message, kind = "success") {
  if (!toastRegion) {
    toastRegion = document.createElement("div");
    toastRegion.className = "toasts";
    toastRegion.setAttribute("popover", "manual");
    toastRegion.setAttribute("role", "status");
    toastRegion.setAttribute("aria-live", "polite");
    document.body.append(toastRegion);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "error" : "check_circle")}<span>${escapeHtml(message)}</span>`;
  toastRegion.append(el);
  if (toastRegion.matches(":popover-open")) toastRegion.hidePopover();
  toastRegion.showPopover();

  setTimeout(() => {
    el.remove();
    if (!toastRegion.childElementCount) toastRegion.hidePopover();
  }, kind === "error" ? 7000 : 4000);
}

/**
 * Runs [fn] with [button] disabled. Shows [success] as a toast when it
 * works and the server's message when it doesn't. Returns whether it worked.
 */
export async function runAction(button, fn, success) {
  if (button) button.disabled = true;
  try {
    await fn();
    if (success) toast(success);
    return true;
  } catch (err) {
    toast(err.message, "error");
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- Drawer ----------

/**
 * A panel that slides in from the right, built on <dialog> so focus, Esc
 * and the backdrop come for free. Returns the body element to fill.
 */
export function openDrawer({ title, onClose }) {
  const dialog = document.createElement("dialog");
  dialog.className = "drawer";
  dialog.setAttribute("aria-labelledby", "drawer-title");
  dialog.innerHTML = `
    <header class="drawer-head">
      <h2 class="title-lg" id="drawer-title">${escapeHtml(title)}</h2>
      <button class="icon-btn" type="button" data-close aria-label="Close">${icon("close")}</button>
    </header>
    <div class="drawer-body">${loadingHtml()}</div>`;
  document.body.append(dialog);

  const close = () => dialog.close();
  dialog.querySelector("[data-close]").addEventListener("click", close);
  // A click on the backdrop lands on the dialog element itself
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.();
  });
  dialog.showModal();

  return {
    body: dialog.querySelector(".drawer-body"),
    setTitle: (text) => (dialog.querySelector("#drawer-title").textContent = text),
    close,
  };
}

// ---------- Confirm dialog ----------

/**
 * Asks before an action. Resolves true when confirmed, false when not.
 * With [input], resolves the typed text instead (null when cancelled).
 * With [typeToConfirm], the button stays off until that exact text is typed.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  input = null,
  typeToConfirm = null,
}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.setAttribute("aria-labelledby", "modal-title");

    const field = input
      ? `<div class="field">
          <label for="modal-input">${escapeHtml(input.label)}</label>
          <input class="input" id="modal-input" value="${escapeHtml(input.value ?? "")}"
            placeholder="${escapeHtml(input.placeholder ?? "")}" autocomplete="off" spellcheck="false">
          ${input.hint ? `<span class="hint">${escapeHtml(input.hint)}</span>` : ""}
        </div>`
      : typeToConfirm
        ? `<div class="field">
            <label for="modal-input">Type <strong>${escapeHtml(typeToConfirm)}</strong> to confirm</label>
            <input class="input" id="modal-input" autocomplete="off" spellcheck="false">
          </div>`
        : "";

    dialog.innerHTML = `
      <form method="dialog" class="modal-form">
        <h2 class="title-lg" id="modal-title">${escapeHtml(title)}</h2>
        <div class="modal-message">${message}</div>
        ${field}
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" value="cancel" type="submit">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-sm" value="ok" type="submit"
            id="modal-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;
    document.body.append(dialog);

    const inputEl = dialog.querySelector("#modal-input");
    const okBtn = dialog.querySelector("#modal-ok");
    if (typeToConfirm) {
      okBtn.disabled = true;
      inputEl.addEventListener("input", () => {
        okBtn.disabled = inputEl.value.trim() !== typeToConfirm;
      });
    }

    dialog.addEventListener("close", () => {
      const ok = dialog.returnValue === "ok";
      dialog.remove();
      if (input) resolve(ok ? inputEl.value.trim() : null);
      else resolve(ok);
    });
    dialog.showModal();
    (inputEl ?? dialog.querySelector('[value="cancel"]')).focus();
    inputEl?.select();
  });
}

// ---------- Paged lists ----------

/**
 * Keeps a cursor-paged list in [body] with a "Load more" button in [more].
 * [fetchPage(after)] returns { items, nextCursor }; [render(items)] returns
 * the list HTML. Call reload() after a filter changes.
 */
export function pagedList({ body, more, fetchPage, render, what }) {
  let items = [];
  let cursor = null;
  // Bumped on each fresh load so a slow older response can't overwrite a newer one
  let requestId = 0;
  const moreBtn = more.querySelector("button");

  async function load(append) {
    const id = append ? requestId : ++requestId;
    if (append) moreBtn.disabled = true;
    else {
      body.innerHTML = loadingHtml();
      more.hidden = true;
    }
    try {
      const page = await fetchPage(append ? cursor : null);
      if (id !== requestId) return;
      items = append ? [...items, ...page.items] : page.items;
      cursor = page.nextCursor;
      body.innerHTML = render(items);
      more.hidden = !cursor;
    } catch (err) {
      if (id !== requestId) return;
      if (append) toast(err.message, "error");
      else body.innerHTML = loadErrorHtml(err, what);
    } finally {
      moreBtn.disabled = false;
    }
  }

  moreBtn.addEventListener("click", () => load(true));
  return {
    reload: () => load(false),
    get items() {
      return items;
    },
    /** Re-renders after an item was changed or removed in place. */
    update(next) {
      items = next;
      body.innerHTML = render(items);
    },
  };
}

/** Wires a group of [data-filter] chips; calls onChange with the value. */
export function chipFilter(group, onChange) {
  const chips = [...group.querySelectorAll("[data-filter]")];
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      onChange(chip.dataset.filter);
    });
  });
}
