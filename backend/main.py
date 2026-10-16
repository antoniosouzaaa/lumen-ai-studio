import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.orchestra import ProductionRequest, execute_production_stream

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="LUMEN: AI PHOTOGRAPHY STUDIO",
    description="Every image has a light.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def is_api_key_configured() -> bool:
    load_dotenv(override=True)
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    return bool(key and key != "sua_chave_aqui")


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "api_key_configured": is_api_key_configured(),
    }


@app.post("/api/generate")
async def generate_production(payload: ProductionRequest):
    if not payload.brief or not payload.brief.strip():
        raise HTTPException(
            status_code=422,
            detail="O briefing criativo é obrigatório para iniciar a produção.",
        )

    return StreamingResponse(
        execute_production_stream(payload),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_spa():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Interface não encontrada.")
    return FileResponse(str(index_file))
