# apps/ai-service — Python AI 服务

只产出草稿、建议、结构化提取与权限过滤后的 RAG 结果；不直接写业务数据。

## 目录说明

```text
app/
├── main.py            # FastAPI 入口
├── api/
│   ├── routes/        # 路由
│   └── schemas/       # 请求/响应 Schema
├── core/              # 配置与安全
├── repositories/      # 检索/存储访问
├── services/          # LLM、RAG 等业务能力
└── workflows/         # 有状态、多步骤流程
```

## 启动

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

依赖按需补充到 `pyproject.toml` / `requirements.txt`。文档：`http://localhost:8000/docs`。
