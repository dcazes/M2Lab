# Programs/Makefile — v2
S := $(or $(SERVICE),$(service))
PY := python3

define SERVICES
$(shell $(PY) ctl/registry.py ids)
endef

.PHONY: help $(SERVICES) $(addprefix stop-,$(SERVICES)) $(addprefix logs-,$(SERVICES)) \
        $(addprefix pull-,$(SERVICES)) start-all stop-all status update \
        up stop restart logs pull

help:
	@echo "Usage: make <target> [SERVICE=<id>]"
	@echo "Generic verbs: make up|stop|restart|logs|pull SERVICE=<service-id>"
	@echo "Services:"; for s in $(SERVICES); do echo "  $$s"; done
	@echo "Start:   make <service-id>  or  make up SERVICE=<service-id>"
	@echo "Stop:    make stop-<service-id> SERVICE=<service-id>"
	@echo "Logs:    make logs-<service-id> SERVICE=<service-id>"
	@echo "Pull:    make pull-<service-id> SERVICE=<service-id>"
	@echo "Backup:  ./scripts/backup.sh [service-id|all]"
	@echo "Global:  start-all stop-all status update"

# ---- registry-driven per-service verbs (stop/logs/pull) -------------------
ifneq ($(S),)
stop-$(S):
	@$(PY) ctl/registry.py stop $(S)
logs-$(S):
	@$(PY) ctl/registry.py logs $(S)
pull-$(S):
	@$(PY) ctl/registry.py pull $(S)
endif

# ---- generic verbs for ANY registry service (no Makefile edit needed) ------
ifneq ($(S),)
up:
	@$(PY) ctl/registry.py up $(S)
stop:
	@$(PY) ctl/registry.py stop $(S)
restart:
	@$(PY) ctl/registry.py stop $(S); $(PY) ctl/registry.py up $(S)
logs:
	@$(PY) ctl/registry.py logs $(S)
pull:
	@$(PY) ctl/registry.py pull $(S)
endif

# ---- explicit start targets (muscle memory) --------------------------------
surfsense:
	@$(PY) ctl/registry.py up surfsense
immich:
	@$(PY) ctl/registry.py up immich
freellmapi:
	@$(PY) ctl/registry.py up freellmapi
vaultwarden:
	@$(PY) ctl/registry.py up vaultwarden
puppygraph:
	@$(PY) ctl/registry.py up puppygraph
homepage:
	@$(PY) ctl/registry.py up homepage
mealie:
	@$(PY) ctl/registry.py up mealie
actual-budget:
	@$(PY) ctl/registry.py up actual-budget
beszel:
	@$(PY) ctl/registry.py up beszel
paperless-ngx:
	@$(PY) ctl/registry.py up paperless-ngx
adventurelog:
	@$(PY) ctl/registry.py up adventurelog
nextcloud:
	@$(PY) ctl/registry.py up nextcloud
ollama:
	@$(PY) ctl/registry.py up ollama
open-webui:
	@$(PY) ctl/registry.py up open-webui
firecrawl:
	@$(PY) ctl/registry.py up firecrawl
portainer:
	@$(PY) ctl/registry.py up portainer

start-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory $$s || exit 1; done
stop-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory stop-$$s || exit 1; done
status:
	@$(PY) ctl/registry.py status
update:
	@if [ -n "$(S)" ]; then $(PY) ctl/registry.py update $(S); \
	else for s in $(SERVICES); do $(PY) ctl/registry.py update $$s || exit 1; done; fi

# ---- Dashboard (ctl-web-next) -----------------------------------------------
dashboard-install:
	@cd ctl-web-next && npm ci

dashboard-build:
	@cd ctl-web-next && npm run build

dashboard-dev:
	@cd ctl-web-next && npm run dev