import pytest
import io
from PIL import Image
from backend.orchestra import (
    _synthesize_studio_plate,
    _synthesize_bfl_flux_studio,
    run_imaging_agent_with_telemetry,
    get_genai_client,
    execute_production_stream,
    ProductionRequest,
)


@pytest.mark.asyncio
async def test_synthesize_studio_plate():
    meta = {"lens": "85mm", "aperture": "f/1.4", "film": "Kodak Portra 400"}
    img_bytes, provider = await _synthesize_studio_plate(
        "Studio fashion portrait with 45 degree key light", "4:5", meta
    )
    assert isinstance(img_bytes, bytes)
    assert len(img_bytes) > 2000
    assert provider == "Lumen Optical Studio Plate"

    with Image.open(io.BytesIO(img_bytes)) as img:
        assert img.format == "JPEG"
        # 4:5 aspect ratio check
        w, h = img.size
        assert abs((w / h) - 0.8) < 0.05


@pytest.mark.asyncio
async def test_synthesize_cascade_resilience():
    meta = {"lens": "50mm", "aperture": "f/2.8", "film": "Neutro"}
    img_bytes, provider = await _synthesize_bfl_flux_studio(
        "Product photo of luxury perfume on dark slate table", "1:1", meta
    )
    assert isinstance(img_bytes, bytes)
    assert len(img_bytes) > 1000
    assert provider in (
        "FLUX.1 Pollinations Studio",
        "AI Horde Neural Cluster",
        "Lumen Optical Studio Plate",
    )


@pytest.mark.asyncio
async def test_run_imaging_agent_with_telemetry_never_crashes():
    client = get_genai_client()
    meta = {"lens": "35mm", "aperture": "f/1.4", "film": "CineStill 800T"}
    img_bytes, provider, fallback = await run_imaging_agent_with_telemetry(
        client,
        "Commercial cinematic portrait, soft studio rim lighting",
        "16:9",
        meta,
    )
    assert isinstance(img_bytes, bytes)
    assert len(img_bytes) > 1000
    assert isinstance(provider, str)
    assert isinstance(fallback, bool)


@pytest.mark.asyncio
async def test_execute_production_stream_generates_image():
    req = ProductionRequest(
        brief="Studio lighting study for high end cosmetics brand",
        aspect_ratio="4:5",
        lens="85mm",
        aperture="f/1.4",
        film="Kodak Portra 400",
    )
    events = []
    async for line in execute_production_stream(req):
        if line.strip():
            events.append(line)

    assert len(events) >= 3
    # Verify the last event is a complete event
    import json
    last_event = json.loads(events[-1])
    assert last_event["event"] == "complete"
    assert "image_base64" in last_event["data"]
    assert len(last_event["data"]["image_base64"]) > 500
    assert "histogram" in last_event["data"]
