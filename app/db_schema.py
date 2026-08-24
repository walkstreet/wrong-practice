from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade_schema_to_head() -> None:
    """把当前 DATABASE_URL 对应的库升到最新 Alembic 版本。"""
    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")
