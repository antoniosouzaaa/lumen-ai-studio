import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.orchestra import ProductionRequest, execute_production_stream

load_dotenv()

logger = logging.getLogger("lumen.main")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


async def keep_alive_loop():
    """
    Faz ping periódico na URL externa do Render a cada 10 minutos (600s)
    para evitar que a instância gratuita entre em hibernação por inatividade (15 min).
    """
    await asyncio.sleep(15)
    while True:
        target_base = (
            os.getenv("RENDER_EXTERNAL_URL")
            or os.getenv("PUBLIC_APP_URL")
            or "https://lumen-ai-studio.onrender.com"
        ).rstrip("/")
        health_url = f"{target_base}/health"
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                await client.get(health_url, headers={"User-Agent": "LumenKeepAlive/1.0"})
        except Exception as exc:
            logger.debug("Keep-alive ping ignorado (%s): %s", health_url, exc)
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(keep_alive_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="LUMEN: AI PHOTOGRAPHY STUDIO",
    description="Every image has a light.",
    version="1.0.0",
    lifespan=lifespan,
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
    return FileResponse(
        str(index_file),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
