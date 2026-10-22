"""
LUMEN Product Studio AI Engine
Módulo central para estúdio de fotografia de produtos para e-commerce e marketplaces.
- Isolamento determinístico do produto (cutout de alta fidelidade sem deformação)
- Composição física de iluminação de estúdio (sombra de contato + reflexo de chão)
- Modelos de cenários comerciais de alta conversão (Mercado Livre, Mármore, Pódio, Rústico, Botânico)
- Exportação multiformato em 1 clique (1:1, 4:5, 9:16 e PNG sem fundo)
- Consumo estrito de memória (<512MB RAM para Render Free Tier)
"""

import base64
import gc
import io
import math
import time
import zipfile
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter
from pydantic import BaseModel, Field

# Dimensões padrão para Marketplaces & Redes Sociais
RATIO_SPECS: Dict[str, Tuple[int, int]] = {
    "1:1": (1200, 1200),     # Mercado Livre, Shopee, Amazon
    "4:5": (1080, 1350),     # Instagram Feed Vertical
    "9:16": (1080, 1920),    # Stories, Reels, TikTok
}

TEMPLATES_CATALOG = [
    {
        "id": "white_market",
        "name": "Branco Puro Oficial",
        "badge": "Padrão Mercado Livre & Amazon",
        "description": "Fundo 100% branco #FFFFFF exigido pelos algoritmos de indexação com sombra de contato e reflexo sutil.",
        "category": "Marketplace",
        "bg_color": "#FFFFFF",
        "recommended_for": "Qualquer produto para capa oficial de venda",
    },
    {
        "id": "marble_luxury",
        "name": "Mármore & Luxo",
        "badge": "Premium Editorial",
        "description": "Bancada de mármore Carrara claro com iluminação suave e reflexo espelhado elegante.",
        "category": "Luxo",
        "bg_color": "#F3F3F5",
        "recommended_for": "Cosméticos, perfumes, joias, relógios e skincare",
    },
    {
        "id": "minimalist_podium",
        "name": "Pódio Minimalista",
        "badge": "Estúdio 3D Clean",
        "description": "Pódio cilíndrico de estúdio em tom marfim com luz direcional suave e sombra de profundidade.",
        "category": "Design",
        "bg_color": "#ECE8E1",
        "recommended_for": "Tênis, calçados, eletrônicos e garrafas",
    },
    {
        "id": "rustic_wood",
        "name": "Madeira Rústica & Café",
        "badge": "Artesanal & Gourmet",
        "description": "Tampo de madeira nobre escura com luz ambiente dourada e bokeh de fundo acolhedor.",
        "category": "Gourmet",
        "bg_color": "#3E2B1E",
        "recommended_for": "Cafés, alimentos artesanais, bebidas, mel e couro",
    },
    {
        "id": "nature_botanical",
        "name": "Botânico & Skincare",
        "badge": "Orgânico & Bem-Estar",
        "description": "Cenário suave em tons pastel com projeção artística de sombras de folhas tropicais.",
        "category": "Natural",
        "bg_color": "#E5EBE3",
        "recommended_for": "Linha vegana, cosméticos naturais e suplementos",
    },
    {
        "id": "studio_grey",
        "name": "Cinza Neutro 18%",
        "badge": "Fotografia Técnica",
        "description": "Fundo infinito cinza estúdio com degradê radial e balanço de luz neutro.",
        "category": "Técnico",
        "bg_color": "#5A5D64",
        "recommended_for": "Roupas, ferramentas, peças técnicas e eletrônicos",
    },
    {
        "id": "studio_dark",
        "name": "Onyx Dark Tech",
        "badge": "High-End Dark",
        "description": "Cenário grafite escuro dramático com reflexo de chão brilhante e alto contraste.",
        "category": "Tech",
        "bg_color": "#151619",
        "recommended_for": "Hardware gamer, bebidas premium e relógios escuros",
    },
    {
        "id": "transparent",
        "name": "Recorte Transparente",
        "badge": "PNG Alpha Puro",
        "description": "Produto recortado com bordas suavizadas em canal alfa pronto para design e montagens.",
        "category": "Design",
        "bg_color": "transparent",
        "recommended_for": "Designers e criação de banners promocionais",
    },
]


class ProductStudioSettings(BaseModel):
    template_id: str = "white_market"
    aspect_ratio: str = "1:1"
    shadow_intensity: float = Field(default=0.55, ge=0.0, le=1.0)
    reflection_intensity: float = Field(default=0.25, ge=0.0, le=1.0)
    product_scale: float = Field(default=1.0, ge=0.5, le=1.4)
    lighting_temperature: Literal["neutral", "warm", "cool"] = "neutral"
    custom_prompt: Optional[str] = None


class ProductStudioRequest(BaseModel):
    image_base64: str
    settings: ProductStudioSettings = Field(default_factory=ProductStudioSettings)


class ProductStudioResponse(BaseModel):
    result_base64: str
    cutout_base64: str
    original_base64: str
    template_id: str
    aspect_ratio: str
    width: int
    height: int
    processing_time_ms: float


def ensure_memory_safe_image(img: Image.Image, max_dim: int = 1200) -> Image.Image:
    """Garante que a imagem respeite as restrições estritas de memória (Render 512MB RAM)."""
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / float(max(w, h))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def extract_subject_cutout(img_rgba: Image.Image) -> Tuple[Image.Image, Tuple[int, int, int, int]]:
    """
    Isola o produto da fotografia sem nunca deformá-lo.
    Analisa as bordas do fundo, calcula a distância cromática adaptativa e
    preserva os detalhes do interior do produto.
    Retorna (cutout_rgba, (min_x, min_y, max_x, max_y)).
    """
    w, h = img_rgba.size
    arr = np.array(img_rgba, dtype=np.float32)

    # 1. Se a imagem já tiver canal alfa com transparência real, usa direto
    if img_rgba.mode == "RGBA":
        alpha_channel = arr[:, :, 3]
        if np.min(alpha_channel) < 220 and np.mean(alpha_channel < 50) > 0.05:
            mask = alpha_channel > 30
            coords = np.argwhere(mask)
            if len(coords) > 0:
                y0, x0 = coords.min(axis=0)
                y1, x1 = coords.max(axis=0)
                bbox = (int(x0), int(y0), int(x1), int(y1))
                return img_rgba, bbox

    # 2. Amostragem adaptativa das 4 bordas da fotografia (mesa/fundo comum)
    border_d = max(3, int(min(w, h) * 0.04))
    borders = np.concatenate([
        arr[:border_d, :, :3].reshape(-1, 3),        # Topo
        arr[-border_d:, :, :3].reshape(-1, 3),       # Base
        arr[:, :border_d, :3].reshape(-1, 3),        # Esquerda
        arr[:, -border_d:, :3].reshape(-1, 3),       # Direita
    ], axis=0)

    bg_mean = np.mean(borders, axis=0)
    bg_std = np.std(borders, axis=0) + 10.0

    # Distância de cor padronizada
    rgb = arr[:, :, :3]
    diff = np.sqrt(np.sum(((rgb - bg_mean) / bg_std) ** 2, axis=2))

    # Gradientes luminosos para capturar arestas nítidas do produto
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    gy, gx = np.gradient(lum)
    edges = np.sqrt(gx**2 + gy**2)

    # Mapa de primeiro plano inicial
    is_fg = (diff > 1.9) | (edges > 14.0)

    # Criar máscara em escala de cinza
    raw_mask_img = Image.fromarray((is_fg.astype(np.uint8) * 255), mode="L")

    # Fechamento morfológico para preencher rótulos brancos e reflexos internos no produto
    fill_mask = raw_mask_img.filter(ImageFilter.MaxFilter(7))
    fill_mask = fill_mask.filter(ImageFilter.MinFilter(7))

    # Suavização de bordas (anti-aliasing)
    smooth_mask = fill_mask.filter(ImageFilter.GaussianBlur(1.8))
    mask_arr = np.array(smooth_mask, dtype=np.float32) / 255.0

    # Construir recorte RGBA preservando 100% das cores e detalhes do produto original
    result_arr = arr.copy()
    result_arr[:, :, 3] = np.clip(mask_arr * 255.0, 0, 255)
    cutout = Image.fromarray(result_arr.astype(np.uint8), mode="RGBA")

    # Localizar bounding box real do sujeito
    active_coords = np.argwhere(mask_arr > 0.15)
    if len(active_coords) > 10:
        y0, x0 = active_coords.min(axis=0)
        y1, x1 = active_coords.max(axis=0)
        bbox = (int(x0), int(y0), int(x1), int(y1))
    else:
        bbox = (0, 0, w, h)

    del arr, borders, diff, edges, mask_arr, result_arr
    gc.collect()

    return cutout, bbox


def create_commercial_backdrop(
    template_id: str,
    width: int,
    height: int,
    lighting_temperature: str = "neutral",
) -> Image.Image:
    """Gera o cenário de fundo comercial de alta fidelidade com iluminação procedural calibrada."""
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    if template_id == "white_market":
        # 100% Branco Puro #FFFFFF para e-commerce oficial
        return canvas

    elif template_id == "marble_luxury":
        # Parede de estúdio suave em cima + bancada de mármore branco Carrara na base
        horizon_y = int(height * 0.72)
        # Gradiente da parede
        for y in range(horizon_y):
            factor = y / float(horizon_y)
            c = int(246 - factor * 14)
            draw.line([(0, y), (width, y)], fill=(c, c, c + 3))

        # Bancada de mármore com textura procedural elegante
        marble_arr = np.full((height - horizon_y, width, 3), 242, dtype=np.uint8)
        # Linha de divisão sutil do horizonte
        for y in range(height - horizon_y):
            for x in range(0, width, 24):
                streak = int(8 * math.sin((x + y * 2.5) * 0.04) * math.cos(y * 0.08))
                val = max(225, min(248, 240 - streak))
                marble_arr[y, min(width - 1, x):min(width, x + 16)] = [val, val - 2, val]
        marble_img = Image.fromarray(marble_arr)
        marble_img = marble_img.filter(ImageFilter.GaussianBlur(1.2))
        canvas.paste(marble_img, (0, horizon_y))
        # Linha de horizonte nítida de bancada
        draw.line([(0, horizon_y), (width, horizon_y)], fill=(218, 218, 222), width=2)

    elif template_id == "minimalist_podium":
        # Fundo de estúdio em tom marfim/champagne quente
        bg_top = (244, 241, 236)
        bg_bot = (226, 222, 215)
        for y in range(height):
            f = y / float(height)
            r = int(bg_top[0] * (1 - f) + bg_bot[0] * f)
            g = int(bg_top[1] * (1 - f) + bg_bot[1] * f)
            b = int(bg_top[2] * (1 - f) + bg_bot[2] * f)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # Renderizar Pódio Cilíndrico 3D
        pod_cx = width // 2
        pod_w = int(width * 0.58)
        pod_top_y = int(height * 0.76)
        pod_h = int(height * 0.12)
        pod_rx = pod_w // 2
        pod_ry = int(pod_rx * 0.28)

        # Base do pódio (corpo cilíndrico)
        body_box = [pod_cx - pod_rx, pod_top_y, pod_cx + pod_rx, pod_top_y + pod_h]
        draw.rectangle(body_box, fill=(212, 206, 198))

        # Face elíptica superior do pódio
        top_ellipse = [pod_cx - pod_rx, pod_top_y - pod_ry, pod_cx + pod_rx, pod_top_y + pod_ry]
        draw.ellipse(top_ellipse, fill=(234, 230, 223), outline=(218, 213, 204), width=1)

        # Base elíptica inferior do pódio
        bot_ellipse = [pod_cx - pod_rx, pod_top_y + pod_h - pod_ry, pod_cx + pod_rx, pod_top_y + pod_h + pod_ry]
        draw.ellipse(bot_ellipse, fill=(198, 192, 184))

    elif template_id == "rustic_wood":
        # Fundo quente aconchegante com iluminação de janela
        for y in range(int(height * 0.65)):
            f = y / float(height * 0.65)
            r = int(72 + f * 45)
            g = int(48 + f * 32)
            b = int(32 + f * 18)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # Tampo de madeira escura nobre
        horizon_y = int(height * 0.65)
        wood_arr = np.zeros((height - horizon_y, width, 3), dtype=np.uint8)
        for y in range(height - horizon_y):
            for x in range(width):
                grain = int(12 * math.sin((x + y * 4) * 0.05) + 6 * math.sin(x * 0.15))
                wood_arr[y, x] = [max(45, min(95, 68 + grain)), max(30, min(70, 46 + grain)), max(18, min(48, 30 + grain))]
        wood_img = Image.fromarray(wood_arr).filter(ImageFilter.GaussianBlur(0.8))
        canvas.paste(wood_img, (0, horizon_y))
        draw.line([(0, horizon_y), (width, horizon_y)], fill=(32, 20, 12), width=2)

    elif template_id == "nature_botanical":
        # Tom suave pedra/sálvia orgânico
        for y in range(height):
            f = y / float(height)
            r = int(232 + f * 6)
            g = int(238 + f * 4)
            b = int(230 + f * 5)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # Projeção artística suave de sombras de folhas tropicais
        leaf_overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ldraw = ImageDraw.Draw(leaf_overlay)
        # Projeções orgânicas no canto superior direito e esquerdo
        for offset_x, offset_y in [(int(width * 0.15), int(height * 0.2)), (int(width * 0.82), int(height * 0.28))]:
            for r in range(4):
                angle = r * 0.5
                lx = offset_x + int(120 * math.cos(angle))
                ly = offset_y + int(140 * math.sin(angle))
                ldraw.ellipse([lx - 70, ly - 35, lx + 70, ly + 35], fill=(35, 55, 30, 28))

        leaf_overlay = leaf_overlay.filter(ImageFilter.GaussianBlur(18))
        canvas.paste(leaf_overlay, (0, 0), leaf_overlay)

    elif template_id == "studio_grey":
        # Cinza neutro 18% com foco de luz central de estúdio
        cx, cy = width // 2, int(height * 0.5)
        max_d = math.sqrt(cx**2 + cy**2)
        grey_arr = np.zeros((height, width, 3), dtype=np.uint8)
        y_idx, x_idx = np.ogrid[:height, :width]
        dist = np.sqrt((x_idx - cx)**2 + (y_idx - cy)**2)
        factors = np.clip(1.0 - (dist / max_d) * 0.45, 0.45, 1.0)
        base_c = np.array([125, 128, 134], dtype=np.float32)
        for c in range(3):
            grey_arr[:, :, c] = np.clip(base_c[c] * factors, 30, 255).astype(np.uint8)
        canvas = Image.fromarray(grey_arr)

    elif template_id == "studio_dark":
        # Grafite / Preto Ônix tecnológico com reflexo suave
        canvas = Image.new("RGB", (width, height), (18, 19, 22))
        cx, cy = width // 2, int(height * 0.6)
        glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow)
        gdraw.ellipse([cx - int(width * 0.45), cy - int(height * 0.25), cx + int(width * 0.45), cy + int(height * 0.25)], fill=(38, 42, 54, 80))
        glow = glow.filter(ImageFilter.GaussianBlur(40))
        canvas.paste(glow, (0, 0), glow)

    # Aplicação de temperatura de luz na cena
    if lighting_temperature == "warm":
        enhancer = ImageEnhance.Color(canvas)
        canvas = enhancer.enhance(1.08)
        warm_tint = Image.new("RGB", (width, height), (255, 240, 215))
        canvas = Image.blend(canvas, warm_tint, 0.06)
    elif lighting_temperature == "cool":
        cool_tint = Image.new("RGB", (width, height), (215, 235, 255))
        canvas = Image.blend(canvas, cool_tint, 0.05)

    return canvas


def render_product_studio_scene(
    image_bytes: bytes,
    settings: ProductStudioSettings,
) -> Tuple[bytes, bytes, bytes, int, int]:
    """
    Executa a montagem completa da foto de produto em estúdio.
    Retorna (result_bytes, cutout_bytes, original_bytes, out_width, out_height).
    """
    with Image.open(io.BytesIO(image_bytes)) as raw_img:
        # Garante imagem segura de memória
        safe_original = ensure_memory_safe_image(raw_img, max_dim=1200)
        rgba_img = safe_original.convert("RGBA")

        # 1. Extração do produto isolado
        cutout_full, bbox = extract_subject_cutout(rgba_img)

        # 2. Recorta o produto conforme o bounding box com margem mínima
        x0, y0, x1, y1 = bbox
        sub_w = max(10, x1 - x0)
        sub_h = max(10, y1 - y0)
        # Padding suave de 2%
        pad_x = int(sub_w * 0.02)
        pad_y = int(sub_h * 0.02)
        crop_x0 = max(0, x0 - pad_x)
        crop_y0 = max(0, y0 - pad_y)
        crop_x1 = min(rgba_img.width, x1 + pad_x)
        crop_y1 = min(rgba_img.height, y1 + pad_y)
        product_crop = cutout_full.crop((crop_x0, crop_y0, crop_x1, crop_y1))

        # Determinar dimensões do canvas de saída
        target_w, target_h = RATIO_SPECS.get(settings.aspect_ratio, (1200, 1200))

        # 3. Se for apenas recorte transparente
        if settings.template_id == "transparent":
            # Centraliza o produto no canvas transparente
            transparent_canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
            # Escala produto para caber em 82% do canvas
            max_prod_w = int(target_w * 0.82 * settings.product_scale)
            max_prod_h = int(target_h * 0.82 * settings.product_scale)
            scale = min(max_prod_w / float(product_crop.width), max_prod_h / float(product_crop.height))
            fit_w = max(1, int(round(product_crop.width * scale)))
            fit_h = max(1, int(round(product_crop.height * scale)))
            scaled_prod = product_crop.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
            pos_x = (target_w - fit_w) // 2
            pos_y = (target_h - fit_h) // 2
            transparent_canvas.paste(scaled_prod, (pos_x, pos_y), scaled_prod)

            # Salva buffers
            res_buf = io.BytesIO()
            transparent_canvas.save(res_buf, format="PNG")

            cutout_buf = io.BytesIO()
            product_crop.save(cutout_buf, format="PNG")

            orig_buf = io.BytesIO()
            if safe_original.mode in ("RGBA", "P"):
                safe_original.convert("RGB").save(orig_buf, format="JPEG", quality=90)
            else:
                safe_original.save(orig_buf, format="JPEG", quality=90)

            return res_buf.getvalue(), cutout_buf.getvalue(), orig_buf.getvalue(), target_w, target_h

        # 4. Criar cenário comercial de fundo
        backdrop = create_commercial_backdrop(
            settings.template_id,
            target_w,
            target_h,
            lighting_temperature=settings.lighting_temperature,
        )

        # 5. Escalonamento e posicionamento do produto na cena
        # Produtos de e-commerce ficam perfeitamente centralizados horizontalmente e apoiados na linha de base
        if settings.template_id == "minimalist_podium":
            ground_y = int(target_h * 0.76)
            max_box_h = int(target_h * 0.62 * settings.product_scale)
            max_box_w = int(target_w * 0.52 * settings.product_scale)
        elif settings.template_id == "marble_luxury":
            ground_y = int(target_h * 0.74)
            max_box_h = int(target_h * 0.68 * settings.product_scale)
            max_box_w = int(target_w * 0.72 * settings.product_scale)
        elif settings.template_id == "rustic_wood":
            ground_y = int(target_h * 0.72)
            max_box_h = int(target_h * 0.66 * settings.product_scale)
            max_box_w = int(target_w * 0.72 * settings.product_scale)
        else: # white_market, studio_grey, studio_dark, nature_botanical
            ground_y = int(target_h * 0.80)
            max_box_h = int(target_h * 0.74 * settings.product_scale)
            max_box_w = int(target_w * 0.78 * settings.product_scale)

        scale = min(max_box_w / float(product_crop.width), max_box_h / float(product_crop.height))
        placed_w = max(10, int(round(product_crop.width * scale)))
        placed_h = max(10, int(round(product_crop.height * scale)))
        placed_prod = product_crop.resize((placed_w, placed_h), Image.Resampling.LANCZOS)

        pos_x = (target_w - placed_w) // 2
        pos_y = ground_y - placed_h

        # 6. Renderizar Reflexo de Chão / Espelho (se habilitado)
        if settings.reflection_intensity > 0.05 and settings.template_id in ("white_market", "marble_luxury", "studio_dark", "minimalist_podium", "studio_grey"):
            refl_portion_h = int(placed_h * 0.35)
            if refl_portion_h > 10:
                bottom_strip = placed_prod.crop((0, placed_h - refl_portion_h, placed_w, placed_h))
                refl_flipped = bottom_strip.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                # Foreshortening de perspectiva vertical
                comp_h = max(5, int(refl_portion_h * 0.7))
                refl_flipped = refl_flipped.resize((placed_w, comp_h), Image.Resampling.LANCZOS)

                # Gradiente de decaimento de opacidade
                refl_arr = np.array(refl_flipped, dtype=np.float32)
                alpha_grad = np.linspace(settings.reflection_intensity * 0.45, 0.0, comp_h).reshape(comp_h, 1)
                refl_arr[:, :, 3] = np.clip(refl_arr[:, :, 3] * alpha_grad, 0, 255)
                refl_img = Image.fromarray(refl_arr.astype(np.uint8), mode="RGBA")
                refl_img = refl_img.filter(ImageFilter.GaussianBlur(1.0))

                backdrop.paste(refl_img, (pos_x, ground_y), refl_img)

        # 7. Renderizar Sombra de Contato Física (Ambient Occlusion + Cast Shadow)
        if settings.shadow_intensity > 0.05:
            shadow_layer = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
            sdraw = ImageDraw.Draw(shadow_layer)

            # Sombra 1: Oclusão de contato rente à base do produto (escura e compacta)
            base_w = int(placed_w * 0.92)
            base_h = max(6, int(placed_h * 0.04))
            occl_x0 = pos_x + (placed_w - base_w) // 2
            occl_y0 = ground_y - int(base_h * 0.5)
            occl_opacity = int(170 * settings.shadow_intensity)
            sdraw.ellipse([occl_x0, occl_y0, occl_x0 + base_w, occl_y0 + base_h], fill=(0, 0, 0, occl_opacity))

            # Sombra 2: Difusão suave direcional
            diff_w = int(placed_w * 1.15)
            diff_h = max(12, int(placed_h * 0.10))
            diff_x0 = pos_x + (placed_w - diff_w) // 2
            diff_y0 = ground_y - int(diff_h * 0.3)
            diff_opacity = int(75 * settings.shadow_intensity)
            sdraw.ellipse([diff_x0, diff_y0, diff_x0 + diff_w, diff_y0 + diff_h], fill=(0, 0, 0, diff_opacity))

            # Filtro gaussiano para suavizar a sombra como em luz difusa de softbox
            shadow_blur_r = max(3, int(placed_w * 0.045))
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(shadow_blur_r))
            backdrop.paste(shadow_layer, (0, 0), shadow_layer)

        # 8. Composição do Produto Nítido e Intacto sobre o Cenário
        backdrop.paste(placed_prod, (pos_x, pos_y), placed_prod)

        # 9. Serialização de saída
        res_buf = io.BytesIO()
        backdrop.save(res_buf, format="JPEG", quality=95)

        cutout_buf = io.BytesIO()
        product_crop.save(cutout_buf, format="PNG")

        orig_buf = io.BytesIO()
        if safe_original.mode in ("RGBA", "P"):
            safe_original.convert("RGB").save(orig_buf, format="JPEG", quality=90)
        else:
            safe_original.save(orig_buf, format="JPEG", quality=90)

        del safe_original, rgba_img, cutout_full, product_crop, backdrop
        gc.collect()

        return res_buf.getvalue(), cutout_buf.getvalue(), orig_buf.getvalue(), target_w, target_h


def generate_export_pack_zip(
    image_bytes: bytes,
    settings: ProductStudioSettings,
    pack_title: str = "lumen_product_photos",
) -> bytes:
    """
    Gera um arquivo ZIP com as 4 variações essenciais para e-commerce:
    - 1:1 Quadrado (1200x1200) para Mercado Livre, Amazon e Shopee
    - 4:5 Retrato (1080x1350) para Instagram Feed
    - 9:16 Vertical (1080x1920) para Stories / Reels / TikTok
    - PNG Recortado com Fundo Transparente
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # 1. Mercado Livre / Amazon (1:1)
        s_1x1 = settings.model_copy(update={"aspect_ratio": "1:1"})
        res_1x1, cutout_bytes, _, _, _ = render_product_studio_scene(image_bytes, s_1x1)
        zip_file.writestr(f"{pack_title}_mercadolivre_amazon_1x1.jpg", res_1x1)

        # 2. Instagram Feed (4:5)
        s_4x5 = settings.model_copy(update={"aspect_ratio": "4:5"})
        res_4x5, _, _, _, _ = render_product_studio_scene(image_bytes, s_4x5)
        zip_file.writestr(f"{pack_title}_instagram_feed_4x5.jpg", res_4x5)

        # 3. Stories / TikTok (9:16)
        s_9x16 = settings.model_copy(update={"aspect_ratio": "9:16"})
        res_9x16, _, _, _, _ = render_product_studio_scene(image_bytes, s_9x16)
        zip_file.writestr(f"{pack_title}_stories_tiktok_9x16.jpg", res_9x16)

        # 4. PNG Transparente
        zip_file.writestr(f"{pack_title}_recorte_transparente.png", cutout_bytes)

    return zip_buffer.getvalue()


# Criar 4 amostras de produtos comerciais reais geradas proceduralmente em alta fidelidade
# para permitir teste instantâneo em 1 clique mesmo sem upload do usuário
def generate_sample_product_bytes(sample_type: str = "perfume") -> bytes:
    """Gera fotografia de amostra de produto realista para teste imediato."""
    img = Image.new("RGBA", (800, 800), (245, 245, 247, 255))
    draw = ImageDraw.Draw(img)

    if sample_type == "perfume":
        # Frasco de Perfume de Luxo com tampa dourada e líquido âmbar
        # Corpo de vidro
        draw.rounded_rectangle([270, 280, 530, 640], radius=18, fill=(235, 185, 110, 240), outline=(210, 160, 80, 255), width=4)
        # Reflexo de luz no vidro
        draw.line([(300, 300), (300, 620)], fill=(255, 255, 255, 180), width=6)
        # Rótulo frontal
        draw.rectangle([320, 390, 480, 510], fill=(255, 255, 255, 250), outline=(180, 150, 90, 255), width=2)
        # Válvula dourada
        draw.rectangle([375, 230, 425, 280], fill=(215, 175, 80, 255))
        # Tampa quadrada preta de luxo
        draw.rounded_rectangle([345, 140, 455, 230], radius=6, fill=(25, 25, 28, 255))

    elif sample_type == "sneaker":
        # Tênis esportivo moderno
        draw.polygon([(200, 500), (280, 360), (450, 360), (620, 470), (620, 550), (200, 550)], fill=(32, 85, 175, 255))
        # Sola de borracha branca
        draw.rounded_rectangle([190, 520, 630, 565], radius=10, fill=(250, 250, 252, 255), outline=(210, 215, 220, 255), width=2)
        # Listra esportiva
        draw.line([(310, 480), (470, 420)], fill=(255, 215, 0, 255), width=14)

    elif sample_type == "serum":
        # Conta-gotas de Sérum Facial Skincare
        # Frasco de vidro verde esmeralda / âmbar
        draw.rounded_rectangle([310, 280, 490, 630], radius=24, fill=(45, 95, 75, 245), outline=(30, 70, 55, 255), width=3)
        # Rótulo clean
        draw.rounded_rectangle([340, 370, 460, 510], radius=4, fill=(252, 250, 248, 255))
        # Tampa branca e bulbo de borracha
        draw.rectangle([375, 220, 425, 280], fill=(245, 245, 248, 255))
        draw.ellipse([375, 145, 425, 225], fill=(235, 235, 238, 255))

    else: # coffee
        # Pacote de Café Gourmet Artesanal Especial
        draw.polygon([(280, 200), (520, 200), (540, 620), (260, 620)], fill=(45, 30, 22, 255))
        # Dobra superior
        draw.rectangle([270, 175, 530, 205], fill=(195, 150, 90, 255))
        # Rótulo de papel kraft
        draw.rectangle([310, 310, 490, 490], fill=(225, 200, 160, 255), outline=(130, 85, 45, 255), width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
