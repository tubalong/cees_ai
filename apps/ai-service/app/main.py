from fastapi import FastAPI

app = FastAPI(title="CEES AI Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
