import asyncio
import base64
import logging
import os
import uuid
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
    AddPinRequest,
    ExportPsdRequest,
    ExportTiffRequest,
    LOOKBOOK_ANGLES,
    LookbookRequest,
    ProductionRequest,
    RateItemRequest,
    ReferenceAnalysisRequest,
    RelightRequest,
    SocialPackRequest,
    SpatialLightingRig,
    WhiteBalanceRequest,
    build_layered_psd,
    build_pro_raw_tiff,
    calibrate_white_balance_at_coords,
    cancel_job,
    compute_image_histogram_and_clipping,
    execute_production_stream,
    execute_social_pack,
    generate_render_passes,
    get_genai_client,
    get_job,
    get_review_service,
    list_jobs,
    run_imaging_agent_with_telemetry,
    run_neural_relight,
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


# ==============================================================================
# ENDPOINTS PROFISSIONAIS LUMEN STUDIO PRO (FASE 8)
# ==============================================================================

@app.post("/api/relight")
async def api_neural_relight(payload: RelightRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(status_code=422, detail="Imagem para reiluminação é obrigatória.")
    try:
        raw = payload.image_base64
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        rig = payload.lighting_rig or SpatialLightingRig()
        relit_bytes, provider, fallback = await run_neural_relight(
            img_bytes, rig, payload.creative_prompt, payload.preserve_identity
        )
        relit_b64 = base64.b64encode(relit_bytes).decode("utf-8")
        return {
            "image_base64": f"data:image/jpeg;base64,{relit_b64}",
            "provider_used": provider,
            "fallback_occurred": fallback,
            "lighting_rig": rig.model_dump(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao reiluminar imagem: {exc}") from exc


@app.post("/api/export-psd")
async def api_export_psd(payload: ExportPsdRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(status_code=422, detail="Imagem é obrigatória para exportação em PSD.")
    try:
        raw = payload.image_base64
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        passes = await asyncio.to_thread(generate_render_passes, img_bytes)
        psd_bytes = await asyncio.to_thread(build_layered_psd, passes, img_bytes)
        psd_b64 = base64.b64encode(psd_bytes).decode("utf-8")
        return {
            "psd_base64": f"data:image/vnd.adobe.photoshop;base64,{psd_b64}",
            "filename": "lumen_studio_pro_layers.psd",
            "size_bytes": len(psd_bytes),
            "passes_count": len(passes),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao gerar PSD com camadas: {exc}") from exc


@app.post("/api/export-tiff")
async def api_export_tiff(payload: ExportTiffRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(status_code=422, detail="Imagem é obrigatória para exportação em TIFF.")
    try:
        raw = payload.image_base64
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        tiff_bytes = await asyncio.to_thread(build_pro_raw_tiff, img_bytes, payload.color_space)
        tiff_b64 = base64.b64encode(tiff_bytes).decode("utf-8")
        return {
            "tiff_base64": f"data:image/tiff;base64,{tiff_b64}",
            "filename": "lumen_studio_hasselblad_raw.tiff",
            "size_bytes": len(tiff_bytes),
            "color_space": payload.color_space,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao gerar TIFF 16-bit: {exc}") from exc


@app.get("/api/lookbook/angles")
async def api_get_lookbook_angles():
    return {"angles": LOOKBOOK_ANGLES}


@app.post("/api/lookbook/generate")
async def api_generate_lookbook(payload: LookbookRequest):
    prompt_base = payload.prompt.strip()
    if not prompt_base:
        raise HTTPException(status_code=422, detail="Prompt base é obrigatório para gerar o Lookbook.")

    selected_ids = set(payload.selected_angle_ids or [a["id"] for a in LOOKBOOK_ANGLES[:4]])
    active_angles = [a for a in LOOKBOOK_ANGLES if a["id"] in selected_ids]
    if not active_angles:
        active_angles = LOOKBOOK_ANGLES[:3]

    rig = payload.lighting_rig or SpatialLightingRig()
    plates = []

    client = None
    try:
        client = get_genai_client()
    except Exception:
        pass

    for angle in active_angles:
        angle_prompt = (
            f"RAW commercial fashion catalog lookbook photograph ({angle['framing']}) shot on Phase One IQ4 150MP with {angle['lens']} lens at {angle['aperture']}: "
            f"{prompt_base}. "
            f"Controlled 3-Point Lighting Rig: Key Light at {rig.key_light.angle_deg}° ({rig.key_light.color_label}), Rim Light at {rig.rim_light.angle_deg}°, Fill Light at {rig.fill_light.angle_deg}°. "
            f"Strict consistency with the character's facial features, wardrobe color, and subject textures. Zero distortion."
        )
        try:
            img_bytes, provider, fallback = await run_imaging_agent_with_telemetry(
                client, angle_prompt, "4:5", None, seed_offset=payload.seed or 101
            )
        except Exception as exc:
            logger.warning("Falha ao gerar prancha do lookbook (%s): %s", angle["id"], exc)
            continue

        b64 = base64.b64encode(img_bytes).decode("utf-8")
        plates.append({
            "angle_id": angle["id"],
            "angle_name": angle["name"],
            "lens": angle["lens"],
            "aperture": angle["aperture"],
            "framing": angle["framing"],
            "image_base64": f"data:image/jpeg;base64,{b64}",
            "provider_used": provider,
        })

    return {
        "lookbook_id": f"lb_{uuid.uuid4().hex[:8]}",
        "prompt": prompt_base,
        "plates_count": len(plates),
        "plates": plates,
    }


@app.get("/api/review/sessions")
async def api_list_review_sessions():
    service = get_review_service()
    return {"sessions": service.list_sessions()}


class CreateSessionRequest(BaseModel):
    session_id: str | None = None
    title: str = "Sessão de Aprovação"
    photographer: str = "LUMEN Studio"


@app.post("/api/review/sessions")
async def api_create_review_session(payload: CreateSessionRequest):
    service = get_review_service()
    sess = service.create_or_get_session(payload.session_id, payload.title, payload.photographer)
    return sess.model_dump()


@app.get("/api/review/sessions/{session_id}")
async def api_get_review_session(session_id: str):
    service = get_review_service()
    sess = service.get_session(session_id)
    if not sess:
        sess = service.create_or_get_session(session_id)
    return sess.model_dump()


class AddItemToSessionRequest(BaseModel):
    image_base64: str
    title: str = "Produção"


@app.post("/api/review/sessions/{session_id}/items")
async def api_add_session_item(session_id: str, payload: AddItemToSessionRequest):
    service = get_review_service()
    item = service.add_item(session_id, payload.image_base64, payload.title)
    return item.model_dump()


@app.post("/api/review/sessions/{session_id}/rate")
async def api_rate_session_item(session_id: str, payload: RateItemRequest):
    service = get_review_service()
    ok = service.rate_item(session_id, payload.item_id, payload.stars, payload.status_tag)
    if not ok:
        raise HTTPException(status_code=404, detail="Item ou sessão não encontrado.")
    return {"status": "ok", "item_id": payload.item_id, "stars": payload.stars, "status_tag": payload.status_tag}


@app.post("/api/review/sessions/{session_id}/pins")
async def api_add_review_pin(session_id: str, payload: AddPinRequest):
    service = get_review_service()
    pin = service.add_pin(session_id, payload.item_id, payload.x_pct, payload.y_pct, payload.comment, payload.author)
    if not pin:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    return pin.model_dump()


@app.post("/api/review/sessions/{session_id}/pins/{pin_id}/resolve")
async def api_resolve_review_pin(session_id: str, pin_id: str):
    service = get_review_service()
    ok = service.resolve_pin(session_id, pin_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Pin ou sessão não encontrado.")
    return {"status": "ok", "pin_id": pin_id, "resolved": True}


@app.post("/api/color-balance")
async def api_color_balance(payload: WhiteBalanceRequest):
    if not payload.image_base64 or len(payload.image_base64) < 32:
        raise HTTPException(status_code=422, detail="Imagem é obrigatória para calibração de balanço de branco.")
    try:
        raw = payload.image_base64
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        return await asyncio.to_thread(
            calibrate_white_balance_at_coords,
            img_bytes,
            payload.sample_x_pct,
            payload.sample_y_pct,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao calibrar balanço de branco: {exc}") from exc


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
