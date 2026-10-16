import base64
import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.orchestra import (
    LightSourceSpec,
    SpatialLightingRig,
    ProductionRequest,
    SocialPackRequest,
    ReferenceAnalysisRequest,
    map_softness_to_prompt_en,
    compute_key_fill_ratio,
    normalize_rig_dict,
    are_rigs_equal,
    crop_non_destructive_with_offset,
    compute_image_histogram_and_clipping,
    analyze_reference_heuristic_pillow,
    create_or_get_job,
    update_job_state,
    cancel_job,
    get_job,
)


@pytest.fixture
def sample_image_bytes() -> bytes:
    img = Image.new("RGB", (300, 200), color=(180, 140, 90))
    # Desenha um detalhe brilhante e um escuro para testar histograma e clipping
    px = img.load()
    for x in range(30):
        for y in range(30):
            px[x, y] = (255, 255, 255)
    for x in range(30):
        for y in range(170, 200):
            px[x, y] = (2, 2, 2)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture
def sample_image_b64(sample_image_bytes) -> str:
    return base64.b64encode(sample_image_bytes).decode("utf-8")


def test_map_softness_to_prompt():
    assert "hard direct light modifier" in map_softness_to_prompt_en(15)
    assert "medium softbox modifier" in map_softness_to_prompt_en(45)
    assert "large double-diffused octabox" in map_softness_to_prompt_en(85)


def test_key_fill_ratio():
    rig = SpatialLightingRig(
        key_light=LightSourceSpec(enabled=True, intensity=80),
        fill_light=LightSourceSpec(enabled=True, intensity=40),
    )
    ratio_str = compute_key_fill_ratio(rig)
    assert "3.0:1" in ratio_str
    assert "estimativa aproximada" in ratio_str

    rig_no_fill = SpatialLightingRig(
        key_light=LightSourceSpec(enabled=True, intensity=90),
        fill_light=LightSourceSpec(enabled=False, intensity=0),
    )
    assert "Sem preenchimento" in compute_key_fill_ratio(rig_no_fill)


def test_rig_equality_and_dirty_state():
    rig_a = SpatialLightingRig()
    rig_b = SpatialLightingRig()
    assert are_rigs_equal(rig_a, rig_b)

    rig_b.key_light.angle_deg = 180
    assert not are_rigs_equal(rig_a, rig_b)


def test_crop_non_destructive_with_offset(sample_image_bytes):
    with Image.open(io.BytesIO(sample_image_bytes)) as img:
        cropped_4_5 = crop_non_destructive_with_offset(img, "4:5")
        w, h = cropped_4_5.size
        # Em 4:5, a largura deve ser 0.8 da altura
        assert abs((w / float(h)) - 0.8) < 0.02


def test_histogram_and_clipping(sample_image_bytes):
    hist = compute_image_histogram_and_clipping(sample_image_bytes)
    assert "bins_64" in hist
    assert len(hist["bins_64"]["luminance"]) == 64
    assert hist["highlight_clip_pct"] > 0.0
    assert hist["shadow_crush_pct"] > 0.0
    assert "dimensions" in hist


def test_analyze_reference_heuristic(sample_image_bytes):
    analysis = analyze_reference_heuristic_pillow(sample_image_bytes)
    assert analysis.is_heuristic_fallback is True
    assert 0 <= analysis.estimated_angle_deg <= 359
    assert 0.0 < analysis.confidence <= 1.0
    assert "aproximada" in analysis.caveats


def test_job_lifecycle_and_idempotency():
    req = ProductionRequest(
        brief="Retrato em estúdio",
        idempotency_key="test_idem_key_123",
    )
    job1, is_dup1 = create_or_get_job(req)
    assert is_dup1 is False
    assert job1.status == "queued"

    update_job_state(job1.job_id, "running", "Processando teste")
    job2, is_dup2 = create_or_get_job(req)
    assert is_dup2 is True
    assert job2.job_id == job1.job_id

    canceled = cancel_job(job1.job_id)
    assert canceled.status == "canceled"
    assert get_job(job1.job_id).status == "canceled"


def test_fastapi_health_endpoints():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["version"] == "6.0.0"

    head_resp = client.head("/health")
    assert head_resp.status_code == 200


def test_fastapi_histogram_endpoint(sample_image_b64):
    client = TestClient(app)
    resp = client.post("/api/histogram", json={"image_base64": sample_image_b64})
    assert resp.status_code == 200
    data = resp.json()
    assert "bins_64" in data
    assert "highlight_clip_pct" in data


def test_fastapi_generate_pack_endpoint(sample_image_b64):
    client = TestClient(app)
    resp = client.post(
        "/api/generate-pack",
        json={
            "source_image_base64": sample_image_b64,
            "project_name": "teste-campanha",
            "version_tag": "v1",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "succeeded"
    assert data["succeeded_count"] == 4
    assert len(data["items"]) == 4


def test_fastapi_jobs_list_endpoint():
    client = TestClient(app)
    resp = client.get("/api/jobs")
    assert resp.status_code == 200
    assert "jobs" in resp.json()
