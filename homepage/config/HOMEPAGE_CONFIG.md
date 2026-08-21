======================================================================
This guide explains every file that controls your dashboard at http://localhost:8083
(or https://home.taile2cc7a.ts.net over your Tailscale tailnet).
(Homepage). You can edit these by hand — save the file and Homepage hot-reloads
automatically (no restart needed for services.yaml / settings.yaml / custom.css /
custom.js). After editing custom.js you may need to refresh the browser tab.

All files live in:  HomeServer/homepage/config/

----------------------------------------------------------------------
1) services.yaml  —  WHAT CARDS APPEAR
----------------------------------------------------------------------
Each top-level "- GroupName:" is a column/tab section. Under it you list services.

Minimal example:
    - Productivity:
        - Mealie:
            icon: mealie
            href: http://localhost:9000
            description: Recipes

Fields you can use on a service:
    icon:          Icon slug. Browse at https://gethomepage.dev/configs/icons/
                    (e.g. "immich", "salvwarden", "si-github", "si-openai").
                    NOTE: custom icons in config/icons/ do NOT work — use a
                    built-in slug only.
    href:          URL opened when the card is clicked.
    description:   Small grey text under the title.
    siteMonitor:   (OPTIONAL) a URL Homepage pings to show a ping badge.
                    We removed these from real services because they ping FROM
                    INSIDE the Homepage container; unreachable URLs show a red
                    "500". Live status is handled by the colored dots in custom.js.

IMPORTANT for the control buttons:
    The service name (e.g. "Mealie", "SurfSense") must match an entry in
    custom.js's NAME_TO_PROJECT map, and that maps to the Docker compose
    "project" name. The 12 managed services use these exact ids (also in
    HomeServer/services.yaml):
        SurfSense->surfsense, Immich->immich, FreeLLMAPI->freellmapi,
        Vaultwarden->vaultwarden, PuppyGraph->puppygraph, Homepage->homepage,
        Mealie->mealie, Actual Budget->actual-budget, Beszel->beszel,
        Paperless-ngx->paperless-ngx, AdventureLog->adventurelog, Nextcloud->nextcloud

To add a brand-new service:
    1) Add it under a group in services.yaml with a valid icon slug + href.
    2) If you want Start/Stop/Restart/Update/Logs buttons on it, add a line to
       NAME_TO_PROJECT in custom.js mapping its display name -> its docker
       compose project name.

----------------------------------------------------------------------
2) settings.yaml  —  LAYOUT, TABS, BACKGROUND
----------------------------------------------------------------------
Key things you might tweak:

  title / theme / color / style
      Self-explanatory dashboard cosmetics.

  layout:
      Defines the tabs (Services / System / Explore) and which groups appear in
      each, with "columns:" per group. Add/remove a group here to change tabs.

  background:
      image:   A full URL to a wallpaper (we use an Unsplash mountains photo).
      blur:    Pixels of blur. We set 0 = crisp. Raise (e.g. 3-8) to soften.
      opacity: 0-100, how dark the image overlay is (higher = darker).
      Other keys (attachment/position/repeat/size) keep the image full-bleed.

  cardBlur:   Blur behind cards. We set 0. Raise to blur the wallpaper behind cards.
  statusStyle: none   (set to "none" so our custom colored dots show instead of
                       Homepage's built-in status badges — leave it as none).

----------------------------------------------------------------------
3) custom.css  —  VISUAL TWEAKS
----------------------------------------------------------------------
Plain CSS applied on top of Homepage's theme. Currently it:
    * rounds + shades cards,
    * makes the header semi-transparent,
    * styles tabs and widgets,
    * gives .service-card a solid dark fill (rgba(0,0,0,0.55)) so text stays
      readable on the un-blurred background. Raise the 0.55 alpha for more opaque
      cards, lower it for more see-through.

----------------------------------------------------------------------
4) custom.js  —  THE CONTROL BUTTONS + STATUS DOTS  (advanced)
----------------------------------------------------------------------
This is the magic that adds, under each managed service card:
    > Start   [] Stop   <> Restart   [down] Update   [page] Logs
plus a colored status dot (green=running, red=stopped, yellow=partial).

How it talks to Docker safely:
    * It calls a tiny LOCAL proxy at http://localhost:8788 (NOT the old 8787).
    * That proxy (HomeServer/portainer-proxy/proxy.py) forwards the request to
      Portainer (http://localhost:9090), ADDS your Portainer API key, and adds
      CORS headers. The API key is NEVER in this file — it lives in
      /home/dak/.config/homelab/portainer.env (chmod 600, not in git).

What you could change here:
    * NAME_TO_PROJECT  — add/edit service name -> compose project mappings.
    * ENDPOINT (currently 1) — Portainer's local Docker environment id. Only
      changes if you add more Docker environments inside Portainer.
    * The button row / icons / titles are built in injectControls().
    * runOnProject / updateContainer — the actual Docker calls. Usually you
      won't need to touch these.

Update (the download button) does: pull the latest image, then recreate the
container from its current spec. This is the same as
`docker compose pull && up -d` per container. If a service ever fails to
recreate, open Portainer UI (https://home.taile2cc7a.ts.net:9090) and manage it there;
the UI is the safest tool.

----------------------------------------------------------------------
5) Portainer (the control plane)  —  https://home.taile2cc7a.ts.net:9090
----------------------------------------------------------------------
Portainer is what actually stops/starts/restarts your containers. Homepage's
buttons talk to it through the proxy. To log in:
    * Open https://home.taile2cc7a.ts.net:9090
    * User: admin   Password: in /home/dak/.config/homelab/portainer.env
      (PORTAINER_ADMIN_PW)
    * The local Docker environment must be connected (see FIRST-RUN below).

portainer-proxy (the :8788 shim):
    * Code: HomeServer/portainer-proxy/proxy.py
    * Runs as a systemd USER service "portainer-proxy.service".
    * Restart it:  systemctl --user restart portainer-proxy.service
    * Its API key comes from /home/dak/.config/homelab/portainer.env.

----------------------------------------------------------------------
FIRST-RUN / RECOVERY CHECKLIST
----------------------------------------------------------------------
If the buttons show X or dots stay grey, the usual cause is that Portainer's
local Docker environment isn't connected yet. Fix:
     1) Open https://home.taile2cc7a.ts.net:9090  (log in as admin).
    2) If a setup wizard appears, choose "Add Environment" -> Docker -> Local
       -> Connect. (If no wizard, go to Environments -> Add Environment ->
       Docker -> Local -> Connect.)
    3) Refresh the Homepage tab. Dots should turn green and buttons work.

Restart Homepage after editing its config files:
    docker restart homepage        # (or: cd HomeServer && make homepage)

Everything you need to edit day-to-day is in HomeServer/homepage/config/.
The control backend is Portainer (:9090) fronted by the :8788 proxy.
The old :8787 dashboard has been fully retired.
