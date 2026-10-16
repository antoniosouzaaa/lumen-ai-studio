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


def test_generate_render_passes_and_psd(sample_image_bytes):
    from backend.orchestra import generate_render_passes, build_layered_psd
    passes = generate_render_passes(sample_image_bytes)
    assert "beauty" in passes
    assert "subject_alpha" in passes
    assert "shadow_pass" in passes
    assert "rim_specular" in passes
    assert "depth_map" in passes
    assert "clean_plate" in passes

    psd_bytes = build_layered_psd(passes, sample_image_bytes)
    assert len(psd_bytes) > 1000
    assert psd_bytes.startswith(b"8BPS")  # Magic header do Photoshop


def test_build_pro_raw_tiff(sample_image_bytes):
    from backend.orchestra import build_pro_raw_tiff
    tiff_bytes = build_pro_raw_tiff(sample_image_bytes, "Adobe RGB (1998)")
    assert len(tiff_bytes) > 500
    assert tiff_bytes.startswith(b"II*\x00") or tiff_bytes.startswith(b"MM\x00*")  # Magic header do TIFF


def test_white_balance_calibration(sample_image_bytes):
    from backend.orchestra import calibrate_white_balance_at_coords
    res = calibrate_white_balance_at_coords(sample_image_bytes, 0.5, 0.5)
    assert "corrected_image_base64" in res
    assert "gains" in res
    assert "red" in res["gains"]
    assert "green" in res["gains"]
    assert "blue" in res["gains"]


def test_review_sessions_lifecycle():
    from backend.orchestra import get_review_service
    service = get_review_service()
    sess = service.create_or_get_session("test_sess_001", "Campanha Outono", "Fotógrafo Teste")
    assert sess.session_id == "test_sess_001"

    item = service.add_item("test_sess_001", "data:image/jpeg;base64,1234", "Look 1")
    assert item.title == "Look 1"

    ok_rate = service.rate_item("test_sess_001", item.id, 5, "approved")
    assert ok_rate is True

    pin = service.add_pin("test_sess_001", item.id, 0.45, 0.32, "Clarear sombra de contato", "Cliente VIP")
    assert pin is not None
    assert pin.comment == "Clarear sombra de contato"

    ok_res = service.resolve_pin("test_sess_001", pin.id)
    assert ok_res is True


def test_fastapi_phase8_endpoints(sample_image_b64):
    client = TestClient(app)

    # 1. White balance
    wb_resp = client.post("/api/color-balance", json={
        "image_base64": sample_image_b64,
        "sample_x_pct": 0.5,
        "sample_y_pct": 0.5,
    })
    assert wb_resp.status_code == 200
    assert "corrected_image_base64" in wb_resp.json()

    # 2. Export PSD
    psd_resp = client.post("/api/export-psd", json={"image_base64": sample_image_b64})
    assert psd_resp.status_code == 200
    assert "psd_base64" in psd_resp.json()
    assert psd_resp.json()["filename"] == "lumen_studio_pro_layers.psd"

    # 3. Export TIFF
    tiff_resp = client.post("/api/export-tiff", json={"image_base64": sample_image_b64})
    assert tiff_resp.status_code == 200
    assert "tiff_base64" in tiff_resp.json()

    # 4. Lookbook Angles
    angles_resp = client.get("/api/lookbook/angles")
    assert angles_resp.status_code == 200
    assert len(angles_resp.json()["angles"]) >= 4

    # 5. Relight Endpoint
    relight_resp = client.post("/api/relight", json={
        "image_base64": sample_image_b64,
        "creative_prompt": "mood dramático",
    })
    assert relight_resp.status_code == 200
    assert "image_base64" in relight_resp.json()
