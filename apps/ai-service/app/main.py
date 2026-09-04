from fastapi import FastAPI

from app.api.routes.ai import router as ai_router

app = FastAPI(title="AI Enterprise Workbench AI Service", version="0.1.0")
app.include_router(ai_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service", "provider": "mock"}