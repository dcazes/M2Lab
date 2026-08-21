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
	@echo "Start targets:  surfsense  immich  freellmapi  vaultwarden  puppygraph"
	@echo "Stop targets:   stop-surfsense  stop-immich  stop-freellmapi  stop-vaultwarden  stop-puppygraph"
	@echo "Logs targets:   logs-surfsense  logs-immich  logs-freellmapi  logs-vaultwarden  logs-puppygraph"
	@echo "Pull targets:   pull-surfsense  pull-immich  pull-freellmapi  pull-vaultwarden  pull-puppygraph"
	@echo "Global: start-all stop-all status update"

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

start-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory $$s || exit 1; done
stop-all:
	@for s in $(SERVICES); do $(MAKE) --no-print-directory stop-$$s || exit 1; done
status:
	@$(PY) ctl/registry.py status
update:
	@if [ -n "$(S)" ]; then $(PY) ctl/registry.py update $(S); \
	else for s in $(SERVICES); do $(PY) ctl/registry.py update $$s || exit 1; done; fi