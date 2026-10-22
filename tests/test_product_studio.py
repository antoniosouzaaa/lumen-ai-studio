import base64
import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.product_studio import (
    TEMPLATES_CATALOG,
    ProductStudioSettings,
    generate_sample_product_bytes,
    render_product_studio_scene,
    generate_export_pack_zip,
)

client = TestClient(app)


def test_get_product_studio_templates():
    response = client.get("/api/product-studio/templates")
    assert response.status_code == 200
    data = response.json()
    assert "templates" in data
    assert len(data["templates"]) == len(TEMPLATES_CATALOG)
    ids = [t["id"] for t in data["templates"]]
    assert "white_market" in ids
    assert "marble_luxury" in ids
    assert "minimalist_podium" in ids
    assert "transparent" in ids


def test_get_product_studio_samples():
    response = client.get("/api/product-studio/samples")
    assert response.status_code == 200
    data = response.json()
    assert "samples" in data
    assert len(data["samples"]) == 4
    for sample in data["samples"]:
        assert "id" in sample
        assert "name" in sample
        assert sample["image_base64"].startswith("data:image/png;base64,")


def test_process_product_studio_api():
    sample_bytes = generate_sample_product_bytes("perfume")
    b64 = "data:image/png;base64," + base64.b64encode(sample_bytes).decode("utf-8")

    payload = {
        "image_base64": b64,
        "settings": {
            "template_id": "white_market",
            "aspect_ratio": "1:1",
            "shadow_intensity": 0.6,
            "reflection_intensity": 0.3,
            "product_scale": 1.0,
            "lighting_temperature": "neutral",
        },
    }

    response = client.post("/api/product-studio/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["template_id"] == "white_market"
    assert data["aspect_ratio"] == "1:1"
    assert data["width"] == 1200
    assert data["height"] == 1200
    assert data["result_base64"].startswith("data:image/jpeg;base64,")
    assert data["cutout_base64"].startswith("data:image/png;base64,")
    assert data["original_base64"].startswith("data:image/jpeg;base64,")
    assert data["processing_time_ms"] > 0


def test_export_pack_zip_api():
    sample_bytes = generate_sample_product_bytes("sneaker")
    b64 = "data:image/png;base64," + base64.b64encode(sample_bytes).decode("utf-8")

    payload = {
        "image_base64": b64,
        "settings": {
            "template_id": "marble_luxury",
            "aspect_ratio": "1:1",
            "shadow_intensity": 0.5,
            "reflection_intensity": 0.25,
            "product_scale": 1.0,
            "lighting_temperature": "warm",
        },
    }

    response = client.post("/api/product-studio/export-pack", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert len(response.content) > 5000

    # Test zip contents
    import zipfile
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        namelist = zf.namelist()
        assert any("mercadolivre_amazon_1x1.jpg" in name for name in namelist)
        assert any("instagram_feed_4x5.jpg" in name for name in namelist)
        assert any("stories_tiktok_9x16.jpg" in name for name in namelist)
        assert any("recorte_transparente.png" in name for name in namelist)
