import asyncio
import base64
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
from pydantic import BaseModel

from backend.orchestra import (
    ProductionRequest,
    ReferenceAnalysisRequest,
    SocialPackRequest,
    cancel_job,
    compute_image_histogram_and_clipping,
    execute_production_stream,
    execute_social_pack,
    get_job,
    list_jobs,
    run_reference_analysis,
)

load_dotenv()

logger = logging.getLogger("lumen.main")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


class HistogramRequest(BaseModel):
    image_base64: str
    source_type: str = "original"


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
                await client.get(health_url, headers={"User-Agent": "LumenKeepAlive/6.0"})
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
    title="LUMEN Studio 6.0 — AI Photography Studio",
    description="Every image has a light. Direção de luz 360°, edição iterativa não destrutiva e entrega multiformato.",
    version="6.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "HEAD"],
    allow_headers=["*"],
)


def is_api_key_configured() -> bool:
    load_dotenv(override=True)
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    return bool(key and key != "sua_chave_aqui")


@app.get("/health")
@app.head("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "6.0.0",
        "api_key_configured": is_api_key_configured(),
        "keep_alive_active": True,
    }


@app.post("/api/generate")
@app.post("/api/generate-stream")
async def generate_production(payload: ProductionRequest):
    effective_brief = (payload.brief or payload.prompt or "").strip()
    if not effective_brief:
        raise HTTPException(
            status_code=422,
            detail="O briefing criativo é obrigatório para iniciar a produção.",
        )
    payload.brief = effective_brief

    return StreamingResponse(
        execute_production_stream(payload),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/jobs")
async def api_list_jobs(limit: int = 30):
    jobs = list_jobs(limit=max(1, min(100, limit)))
    return {"jobs": [j.model_dump() for j in jobs]}


@app.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    return job.model_dump()


@app.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str):
    job = cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    return job.model_dump()


@app.post("/api/analyze-reference")
async def api_analyze_reference(payload: ReferenceAnalysisRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(
            status_code=422,
            detail="Imagem de referência inválida ou vazia.",
        )
    try:
        result = await run_reference_analysis(payload)
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível analisar a imagem de referência: {exc}",
        ) from exc


@app.post("/api/generate-pack")
async def api_generate_social_pack(payload: SocialPackRequest):
    if not payload.source_image_base64 or len(payload.source_image_base64) < 32:
        raise HTTPException(
            status_code=422,
            detail="Imagem mestre é obrigatória para gerar o pacote multiformato.",
        )
    try:
        return await execute_social_pack(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao gerar pacote multiformato: {exc}",
        ) from exc


@app.post("/api/histogram")
async def api_compute_histogram(payload: HistogramRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(status_code=422, detail="Imagem inválida para análise de histograma.")
    try:
        raw = payload.image_base64
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        return await asyncio.to_thread(
            compute_image_histogram_and_clipping, img_bytes, payload.source_type
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Falha ao calcular histograma: {exc}",
        ) from exc


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
