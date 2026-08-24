// =============================================================================
// HomeServer Homepage — Service Control Buttons + Status Dots
// -----------------------------------------------------------------------------
// HOW THIS WORKS
//   Each Homepage service card gets a row of buttons (Start/Stop/Restart/
//   Update/Logs) and a colored status dot. Clicking a button calls Portainer's
//   Docker API through a tiny local proxy at http://localhost:8788 (which adds
//   CORS headers + your Portainer API key, so the key is NEVER in this file).
//
//   We control containers at the Docker level, grouped by their compose
//   "project" label (e.g. "immich"). This works for stacks you started with
//   `docker compose` directly — Portainer does not need to have "adopted" them.
//
//   Mapping: Homepage display name  ->  compose project name (== our service id)
//   Verified against the running containers' com.docker.compose.project labels.
//
// ENDPOINT: the local Docker environment in Portainer is endpoint id 1.
// =============================================================================

(function () {
  "use strict";

  var API = "http://localhost:8788";   // the secure proxy (NOT 8787 — that's retired)
  var ENDPOINT = 1;                   // Portainer's local Docker environment id

  // Homepage display name  ->  Docker compose project name.
  // (These match the ids in HomeServer/services.yaml exactly.)
  var NAME_TO_PROJECT = {
    "SurfSense": "surfsense",
    "Immich": "immich",
    "LiteLLM": "litellm",
    "Vaultwarden": "vaultwarden",
    "PuppyGraph": "puppygraph",
    "Homepage": "homepage",
    "Mealie": "mealie",
    "Actual Budget": "actual-budget",
    "Beszel": "beszel",
    "Paperless-ngx": "paperless-ngx",
    "AdventureLog": "adventurelog",
    "Nextcloud": "nextcloud",
    "FreeLLMAPI": "freellmapi",
    "OpenCode Agent": "opencode-agent",
    "Open WebUI": "open-webui",
    "Ollama": "ollama",
    "Firecrawl": "firecrawl"
  };

  // ---- low-level API helpers (all go through the proxy, which adds auth) ----
  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body || undefined
    });
  }
  function apiJson(path, opts) {
    return api(path, opts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // Docker label key that groups containers of one compose stack.
  var PROJECT_LABEL = "com.docker.compose.project";

  // ---- status state, refreshed periodically ----
  var stateCache = {}; // project -> "running" | "stopped" | "degraded"

  function dotColor(st) {
    if (st === "running") return "#3fb950";   // green
    if (st === "stopped") return "#f85149";   // red
    if (st === "degraded") return "#d29922";  // yellow (partial / looping)
    return "#8b949e";                          // unknown / grey
  }

  // Fetch ALL containers once and group their running-state by project.
  function refreshStates() {
    apiJson("/api/endpoints/" + ENDPOINT + "/docker/containers/json")
      .then(function (list) {
        var byProject = {};
        list.forEach(function (c) {
          var p = c.Labels && c.Labels[PROJECT_LABEL];
          if (!p) return;
          var running = c.State === "running";
          var rec = byProject[p] || { total: 0, running: 0 };
          rec.total += 1;
          if (running) rec.running += 1;
          byProject[p] = rec;
        });
        stateCache = {};
        for (var proj in byProject) {
          var r = byProject[proj];
          var st = r.total === 0 ? "stopped"
                 : r.running === r.total ? "running"
                 : "degraded";
          stateCache[proj] = st;
        }
        // recolor any dots already on the page
        cardRegistry.forEach(function (rec) {
          if (rec.dotEl) rec.dotEl.style.background = dotColor(stateCache[rec.project]);
        });
      })
      .catch(function () { /* endpoint not connected yet, or proxy down */ });
  }

  // ---- containers of a project (used by action buttons) ----
  function projectContainers(project) {
    var f = encodeURIComponent(JSON.stringify({ label: [PROJECT_LABEL + "=" + project] }));
    return apiJson("/api/endpoints/" + ENDPOINT + "/docker/containers/json?filters=" + f)
      .then(function (list) { return list.map(function (c) { return c.Id; }); });
  }

  // ---- one container lifecycle operations ----
  function stopContainer(id) {
    return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "/stop", { method: "POST" });
  }
  function startContainer(id) {
    return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "/start", { method: "POST" });
  }
  function restartContainer(id) {
    return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "/restart", { method: "POST" });
  }

  // Update = pull latest image, then recreate the container from its current
  // spec (this is what `docker compose pull && up -d` does, per container).
  function updateContainer(id) {
    return apiJson("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "/json")
      .then(function (insp) {
        var name = (insp.Name || "").replace(/^\//, "");
        var img = insp.Config.Image || "";
        var sep = img.lastIndexOf(":");
        var repo = sep >= 0 ? img.slice(0, sep) : img;
        var tag = sep >= 0 ? img.slice(sep + 1) : "latest";
        // 1) pull latest image
        return api("/api/endpoints/" + ENDPOINT + "/docker/images/create?fromImage=" +
                   encodeURIComponent(repo) + "&tag=" + encodeURIComponent(tag), { method: "POST" })
          .then(function () {
            // 2) stop + remove old container
            return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "/stop", { method: "POST" })
              .catch(function () {});
          })
          .then(function () {
            return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + id + "?force=true", { method: "DELETE" })
              .catch(function () {});
          })
          .then(function () {
            // 3) recreate from the inspected spec
            var spec = {
              Image: img,
              Config: insp.Config,
              HostConfig: insp.HostConfig,
              NetworkingConfig: insp.NetworkingConfig
            };
            delete spec.Config.Image;            // Image passed separately
            if (spec.HostConfig && spec.HostConfig.Mounts) delete spec.HostConfig.Binds; // avoid clash
            return api("/api/endpoints/" + ENDPOINT + "/docker/containers/create?name=" +
                       encodeURIComponent(name), { method: "POST", body: JSON.stringify(spec) });
          })
          .then(function (created) {
            var newId = created.Id;
            return api("/api/endpoints/" + ENDPOINT + "/docker/containers/" + newId + "/start", { method: "POST" });
          });
      });
  }

  // ---- per-project action that fans out to all containers ----
  function runOnProject(project, op) {
    return projectContainers(project).then(function (ids) {
      if (!ids.length) throw new Error("no containers for " + project);
      return Promise.all(ids.map(op));
    });
  }

  // ======================= DOM INJECTION =======================
  var processed = new WeakSet();
  var cardRegistry = new WeakMap(); // card -> { project, dotEl }

  function ensureDot(card, project) {
    var rec = cardRegistry.get(card);
    if (!rec) {
      var nameEl = card.querySelector(".service-name");
      var dot = document.createElement("span");
      dot.style.cssText = "display:inline-block;width:10px;height:10px;border-radius:50%;" +
        "margin-right:8px;vertical-align:middle;background:#8b949e;box-shadow:0 0 6px rgba(0,0,0,.4);";
      if (nameEl) nameEl.insertBefore(dot, nameEl.firstChild);
      rec = { project: project, dotEl: dot };
      cardRegistry.set(card, rec);
    }
    rec.dotEl.style.background = dotColor(stateCache[project]);
    return rec;
  }

  function makeButton(project, serviceName, action, icon, title, confirmMsg) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hs-ctrl-btn hs-ctrl-" + action;
    btn.innerHTML = icon;
    btn.title = title + " " + serviceName;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (action === "logs") {
        // Logs just opens Portainer's container list in a new tab — no confirm.
        window.open("https://home.taile2cc7a.ts.net:9090/#!2/docker/containers", "_blank");
        return;
      }
      if (confirmMsg && !confirm(confirmMsg.replace("{name}", serviceName))) return;
      if (btn.disabled) return;
      var original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "⏳";
      var promise;
      if (action === "stop") promise = runOnProject(project, stopContainer);
      else if (action === "start") promise = runOnProject(project, startContainer);
      else if (action === "restart") promise = runOnProject(project, restartContainer);
      else if (action === "update") promise = runOnProject(project, updateContainer);

      promise.then(function () {
        btn.innerHTML = "✅";
        refreshStates();
      }).catch(function (err) {
        btn.innerHTML = "❌";
        alert("Failed to " + action + " " + serviceName + ": " + (err && err.message ? err.message : err));
      }).finally(function () {
        setTimeout(function () { btn.disabled = false; btn.innerHTML = original; }, 1500);
      });
    });

    btn.style.cssText = "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.15);" +
      "color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;" +
      "display:flex;align-items:center;justify-content:center;transition:all .15s ease;";
    btn.addEventListener("mouseenter", function () { btn.style.background = "rgba(255,255,255,0.25)"; btn.style.transform = "scale(1.08)"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "rgba(255,255,255,0.12)"; btn.style.transform = "scale(1)"; });
    return btn;
  }

  function injectControls(card) {
    if (processed.has(card)) return;
    var nameEl = card.querySelector(".service-name");
    if (!nameEl) return;
    var name = nameEl.childNodes[0] && nameEl.childNodes[0].nodeType === Node.TEXT_NODE
      ? nameEl.childNodes[0].textContent.trim()
      : nameEl.textContent.trim();
    var project = NAME_TO_PROJECT[name];
    if (!project) return; // not a managed backend service

    ensureDot(card, project);

    var group = document.createElement("div");
    group.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;";
    var actions = [
      { a: "start", i: "▶️", t: "Start", c: "Start {name}?" },
      { a: "stop", i: "⏹️", t: "Stop", c: "Stop {name}?" },
      { a: "restart", i: "🔄", t: "Restart", c: "Restart {name}?" },
      { a: "update", i: "📥", t: "Update", c: "Update (pull + recreate) {name}?" },
      { a: "logs", i: "📜", t: "Logs", c: null }
    ];
    actions.forEach(function (act) {
      group.appendChild(makeButton(project, name, act.a, act.i, act.t, act.c));
    });
    card.appendChild(group);
    processed.add(card);
  }

  function scan() {
    document.querySelectorAll(".service-card").forEach(injectControls);
  }

  // Initial + reactive scanning so buttons appear once Homepage renders cards.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(scan, 800); });
  } else { setTimeout(scan, 800); }

  var observer = new MutationObserver(function () { scan(); });
  var startObs = function () {
    var root = document.querySelector("#root") || document.body;
    observer.observe(root, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startObs);
  else startObs();

  setInterval(scan, 5000);
  refreshStates();
  setInterval(refreshStates, 15000);
})();
