# Programs/Makefile — v2
S := $(or $(SERVICE),$(service))
PY := python3

define SERVICES
$(shell $(PY) ctl/registry.py ids)
endef

.PHONY: help $(SERVICES) $(addprefix stop-,$(SERVICES)) $(addprefix logs-,$(SERVICES)) \
        $(addprefix pull-,$(SERVICES)) start-all stop-all status update

help:
	@echo "Usage: make <target> [SERVICE=<id>]"
	@echo "Services:"; for s in $(SERVICES); do echo "  $$s"; done
	@echo "Start:   make <service-id>"
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

start-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory $$s || exit 1; done
stop-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory stop-$$s || exit 1; done
status:
	@$(PY) ctl/registry.py status
update:
	@if [ -n "$(S)" ]; then $(PY) ctl/registry.py update $(S); \
	else for s in $(SERVICES); do $(PY) ctl/registry.py update $$s || exit 1; done; fi