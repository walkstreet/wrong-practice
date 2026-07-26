.PHONY: setup dev prod prod-daemon prod-stop run run-alt check

setup:
	bash scripts/install-deps.sh

dev:
	bash scripts/start-dev.sh

prod:
	bash scripts/start-prod.sh --daemon

prod-daemon:
	bash scripts/start-prod.sh --daemon

prod-stop:
	bash scripts/stop-prod.sh

run:
	bash scripts/run.sh

run-alt:
	BACKEND_PORT=8000 bash scripts/run.sh

check:
	. .venv/bin/activate && python -c "import app.main; print('APP_IMPORT_OK')"
