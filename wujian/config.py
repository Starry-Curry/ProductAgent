import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    data_dir: Path = ROOT / "var"
    database_url: str = ""
    api_key: str = field(default="", repr=False)
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "qwen3.6-plus"
    # Kept for the parallel teaching/3D integration; ordinary PDF observation
    # now uses the main model's native image input without a second RPC.
    vision_model: str = "qwen3-vl-plus"
    thinking_enabled: bool = True
    thinking_budget: int | None = None
    provider_stream: bool = False
    embedding_model: str = "text-embedding-v4"
    rea_enabled: bool = True
    rea_entry: str = ""
    rea_artifact_roots: tuple[Path, ...] = ()
    session_secret: str = field(default="", repr=False)
    demo_mode: bool = True
    host: str = "127.0.0.1"
    port: int = 8000

    @classmethod
    def load(cls):
        load_dotenv(ROOT / ".env")
        return cls(
            data_dir=Path(os.getenv("WUJIAN_DATA_DIR", str(ROOT / "var"))),
            database_url=os.getenv("DATABASE_URL", ""),
            api_key=os.getenv("DASHSCOPE_API_KEY", ""),
            base_url=os.getenv("DASHSCOPE_BASE_URL") or cls.base_url,
            model=os.getenv("QWEN_MODEL") or cls.model,
            vision_model=os.getenv("QWEN_VISION_MODEL") or cls.vision_model,
            thinking_enabled=os.getenv("QWEN_THINKING", "true").lower() == "true",
            thinking_budget=int(os.environ["QWEN_THINKING_BUDGET"]) if os.getenv("QWEN_THINKING_BUDGET") else None,
            provider_stream=os.getenv("QWEN_STREAM", "false").lower() == "true",
            embedding_model=os.getenv("QWEN_EMBEDDING_MODEL") or cls.embedding_model,
            rea_enabled=os.getenv("WUJIAN_REA_ENABLED", "true").lower() == "true",
            rea_entry=os.getenv("WUJIAN_REA_ENTRY", ""),
            rea_artifact_roots=tuple(Path(path).resolve() for path in json.loads(os.getenv('WUJIAN_REA_ARTIFACT_ROOTS','[]'))),
            session_secret=os.getenv("WUJIAN_SESSION_SECRET", ""),
            demo_mode=os.getenv("WUJIAN_DEMO_MODE", "true").lower() == "true",
            host=os.getenv("WUJIAN_HOST", "127.0.0.1"),
            port=int(os.getenv("WUJIAN_PORT", "8000")),
        )

    def prepare(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "assets").mkdir(exist_ok=True)
        (self.data_dir / "device-artifacts").mkdir(exist_ok=True)
        if not self.database_url:
            self.database_url = "sqlite:///" + (self.data_dir / "wujian.sqlite3").as_posix()
        if not self.session_secret:
            path = self.data_dir / "session.key"
            if not path.exists():
                path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
            self.session_secret = path.read_text(encoding="utf-8").strip()

