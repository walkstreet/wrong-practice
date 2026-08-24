from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 固定指向仓库根目录的 .env，避免从其他 cwd 启动时读不到配置
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


def _resolve_sqlite_url(url: str, sqlite_data_dir: Path | None = None) -> str:
    if not url.startswith("sqlite:///"):
        return url
    rest = url[len("sqlite:///") :]
    if rest.startswith("/"):
        return f"sqlite:///{Path(rest).resolve()}"
    base_dir = sqlite_data_dir or _PROJECT_ROOT
    return f"sqlite:///{(base_dir / rest).resolve()}"


class Settings(BaseSettings):
    """应用配置（.env）。文本用 DeepSeek，看图用独立视觉模型。"""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 可选：把 SQLite 文件放到仓库外目录（如 ../db），避免 git pull / 重新部署覆盖数据。
    sqlite_data_dir: str = ""
    database_url: str = "sqlite:///./wrong_questions.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 120
    admin_username: str = "admin"
    admin_password: str = "admin123"

    # 文本分析：DeepSeek（保持原配置名）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"

    # 图片识别：千问等视觉模型（OpenAI 兼容）
    vision_api_key: str = ""
    vision_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    vision_model: str = "qwen3.7-flash"

    @model_validator(mode="after")
    def resolve_sqlite_path(self):
        sqlite_dir_raw = (self.sqlite_data_dir or "").strip()
        sqlite_dir = None
        if sqlite_dir_raw:
            sqlite_dir = Path(sqlite_dir_raw)
            if not sqlite_dir.is_absolute():
                sqlite_dir = (_PROJECT_ROOT / sqlite_dir).resolve()
            sqlite_dir.mkdir(parents=True, exist_ok=True)
            object.__setattr__(self, "sqlite_data_dir", str(sqlite_dir))
        url = self.database_url
        if url.startswith("sqlite:///"):
            object.__setattr__(
                self,
                "database_url",
                _resolve_sqlite_url(url, sqlite_data_dir=sqlite_dir),
            )
        return self


settings = Settings()
