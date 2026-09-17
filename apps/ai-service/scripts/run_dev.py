"""本机启动 ai-service：先加载仓库根 .env 到进程环境，再启动 uvicorn。

容器/Compose 环境由编排注入变量；本机直接运行时 os.getenv 读不到
pydantic-settings 的 env_file（Settings 只消费声明字段），因此这里显式加载。
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = REPO_ROOT / "apps" / "ai-service"
ENV_PATH = REPO_ROOT / ".env"


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


if __name__ == "__main__":
    sys.path.insert(0, str(SERVICE_ROOT))
    load_env(ENV_PATH)
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
    sys.exit(0)
