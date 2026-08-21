// Custom JavaScript for HomeServer Homepage — Service Controls
// Injects start/stop/restart/update/logs buttons into each service card.
// Calls the local control-plane API at http://localhost:8787
// (the FastAPI backend behind the old dashboard; UI retired, API kept).

(function () {
  "use strict";

  // Map Homepage *display names* -> backend service ids (services.yaml)
  const NAME_TO_ID = {
    "SurfSense": "surfsense",
    "Immich": "immich",
    "FreeLLMAPI": "freellmapi",
    "Vaultwarden": "vaultwarden",
    "PuppyGraph": "puppygraph",
    "Homepage": "homepage",
    "Mealie": "mealie",
    "Actual Budget": "actual-budget",
    "Beszel": "beszel",
    "Paperless-ngx": "paperless-ngx",
    "AdventureLog": "adventurelog",
    "Nextcloud": "nextcloud",
  };

  // Where the control API lives (same-host access).
  // TODO: for tailnet/remote access, swap to the tailscale URL of the ctl API.
  const API_BASE = "http://localhost:8787";

  const processed = new WeakSet();

  function nameToId(name) {
    if (!name) return null;
    // exact match first
    if (NAME_TO_ID[name]) return NAME_TO_ID[name];
    // case-insensitive fallthrough
    const lower = name.toLowerCase();
    for (const key of Object.keys(NAME_TO_ID)) {
      if (key.toLowerCase() === lower) return NAME_TO_ID[key];
    }
    return null;
  }

  function makeButton(serviceId, serviceName, action, icon, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hs-ctrl-btn hs-ctrl-" + action;
    btn.innerHTML = icon;
    btn.title = title + " " + serviceName;
    btn.setAttribute("aria-label", title + " " + serviceName);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "⏳";
      try {
        const resp = await fetch(
          API_BASE + "/api/services/" + serviceId + "/" + action,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        if (resp.ok) {
          btn.innerHTML = "✅";
          if (action === "logs") {
            // logs stream via SSE; open a simple popup with the tail
            window.open(
              API_BASE + "/api/services/" + serviceId + "/logs",
              "_blank",
              "width=800,height=600"
            );
          }
        } else {
          const err = await resp.json().catch(() => ({}));
          btn.innerHTML = "❌";
          console.error("Control error:", err);
          alert("Failed to " + action + " " + serviceName + ": " + (err.detail || resp.status));
        }
      } catch (err) {
        btn.innerHTML = "❌";
        console.error("Control fetch error:", err);
        alert("Error " + action + " " + serviceName + ": " + err.message);
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = original;
        }, 1500);
      }
    });
    return btn;
  }

  function injectControls(card) {
    if (processed.has(card)) return;

    const nameEl = card.querySelector(".service-name");
    if (!nameEl) return;

    // The name element contains the title plus a description <p>; grab only the title text node.
    const name = nameEl.childNodes[0] && nameEl.childNodes[0].nodeType === Node.TEXT_NODE
      ? nameEl.childNodes[0].textContent.trim()
      : nameEl.textContent.trim();

    const serviceId = nameToId(name);
    if (!serviceId) return; // not a managed backend service (e.g. links/dashboard entries)

    const serviceName = name;

    const group = document.createElement("div");
    group.className = "hs-ctrl-group";
    group.style.cssText =
      "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;";

    const actions = [
      { a: "up", i: "▶️", t: "Start" },
      { a: "stop", i: "⏹️", t: "Stop" },
      { a: "restart", i: "🔄", t: "Restart" },
      { a: "pull", i: "📥", t: "Update" },
      { a: "logs", i: "📜", t: "Logs" },
    ];

    actions.forEach((act) => {
      const b = makeButton(serviceId, serviceName, act.a, act.i, act.t);
      b.style.cssText =
        "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.15);" +
        "color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;" +
        "display:flex;align-items:center;justify-content:center;transition:all .15s ease;";
      b.addEventListener("mouseenter", () => {
        b.style.background = "rgba(255,255,255,0.25)";
        b.style.transform = "scale(1.08)";
      });
      b.addEventListener("mouseleave", () => {
        b.style.background = "rgba(255,255,255,0.12)";
        b.style.transform = "scale(1)";
      });
      group.appendChild(b);
    });

    card.appendChild(group);
    processed.add(card);
  }

  function scan() {
    document.querySelectorAll(".service-card").forEach(injectControls);
  }

  // Initial run after DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(scan, 800));
  } else {
    setTimeout(scan, 800);
  }

  // Re-scan when Homepage re-renders service cards (React mutates the DOM).
  const observer = new MutationObserver(() => scan());
  const startObs = () => {
    const root = document.querySelector("#root") || document.body;
    observer.observe(root, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObs);
  } else {
    startObs();
  }

  // Periodic fallback in case mutations are missed.
  setInterval(scan, 5000);
})();
