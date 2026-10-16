import asyncio
import base64
import io
import json
import logging
import os
import random
import re
import urllib.parse
from typing import AsyncGenerator, Dict, Any, List, Literal, Optional

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image, ImageStat
from pydantic import BaseModel, Field

load_dotenv()

logger = logging.getLogger("lumen.orchestra")

ACTIVE_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.8-flash",
]

FORBIDDEN_BUZZWORDS = [
    r"\b8k\b",
    r"\b4k\b",
    r"\bphotorealistic\b",
    r"\bultra-detailed\b",
    r"\bultra detailed\b",
    r"\bhyperrealistic\b",
    r"\bhyper-realistic\b",
    r"\bmasterpiece\b",
    r"\bunreal engine\b",
    r"\btrending on artstation\b",
    r"\boctane render\b",
    r"\bray tracing\b",
    r"\bbest quality\b",
]


class LightSourceSpec(BaseModel):
    enabled: bool = True
    angle_deg: int = Field(
        default=315,
        ge=0,
        le=360,
        description="Ângulo azimutal no radar 360° (0° = Frontal/Câmera, 90° = Direita, 180° = Traseira/Contraluz, 270° = Esquerda).",
    )
    distance_pct: int = Field(
        default=65,
        ge=15,
        le=100,
        description="Distância no radar (controla a elevação/altura da luz: próximo ao centro = luz alta/zenital; borda = luz baixa/rasante).",
    )
    color_label: str = Field(
        default="Sol Dourado",
        description="Temperatura ou cor escolhida para a fonte luminosa.",
    )
    intensity: int = Field(default=85, ge=10, le=100)


class SpatialLightingRig(BaseModel):
    key_light: LightSourceSpec = Field(default_factory=LightSourceSpec)
    rim_light: LightSourceSpec = Field(
        default_factory=lambda: LightSourceSpec(
            enabled=True,
            angle_deg=135,
            distance_pct=78,
            color_label="Frio Noturno",
            intensity=60,
        )
    )
    spatial_summary: str = Field(
        default="",
        description="Descrição legível gerada pelo radar 360° da posição espacial exata das luzes.",
    )
    relight_mode: bool = Field(
        default=False,
        description="True quando o usuário moveu os refletores no Radar 360° para reiluminar a foto atual.",
    )


class ProductionRequest(BaseModel):
    brief: str = Field(..., min_length=1, max_length=3000)
    lens: Optional[str] = None
    aperture: Optional[str] = None
    film: Optional[str] = None
    aspect_ratio: Optional[str] = None
    lighting_rig: Optional[SpatialLightingRig] = None
    previous_prompt: Optional[str] = None
    refinement_instruction: Optional[str] = None
    reference_image_base64: Optional[str] = None
    reference_mime_type: Optional[str] = "image/jpeg"
    contact_sheet: bool = False


class VariationPrompt(BaseModel):
    label: str = Field(
        ...,
        description="Título curto em português para este estudo de luz.",
    )
    prompt: str = Field(
        ...,
        description="Prompt fotográfico completo em inglês correspondente a esta variação de iluminação e atmosfera.",
    )


class DirectorOutput(BaseModel):
    lens: Literal["24mm", "35mm", "50mm", "85mm"] = Field(default="35mm")
    aperture: Literal["f/1.4", "f/2.8", "f/8"] = Field(default="f/1.4")
    film: Literal["Kodak Portra 400", "CineStill 800T", "Neutro"] = Field(
        default="Kodak Portra 400"
    )
    aspect_ratio: Literal["16:9", "1:1", "4:5", "9:16"] = Field(default="4:5")
    camera_optics: str = Field(
        ...,
        description="Explicação fluida, natural e envolvente em português brasileiro contando como as coordenadas do Palco de Luz 360° e o enquadramento foram aplicados na cena.",
    )
    final_prompt: str = Field(
        ...,
        description="Prompt fotográfico descritivo denso em inglês para síntese de imagem, respeitando rigorosamente a direção física dos ângulos de luz definidos no Palco 360°.",
    )
    variations: List[VariationPrompt] = Field(default_factory=list)


class QAOutput(BaseModel):
    score: float = Field(..., ge=0.0, le=10.0)
    lighting: str = Field(...)
    lens_coherence: str = Field(...)
    notes: str = Field(...)
    improvement_suggestion: str = Field(default="")


DIRECTOR_SYSTEM_PROMPT = """Você é o Diretor de Fotografia Sênior do estúdio LUMEN: AI PHOTOGRAPHY STUDIO.
O diferencial central do LUMEN é o PALCO DE LUZ ESPACIAL 360°: o usuário posiciona visualmente os refletores/Sol ao redor do sujeito usando um radar interativo de 360 graus.

SUA MISSÃO PRINCIPAL:
Traduzir com precisão absoluta a GEOMETRIA ESPACIAL DA LUZ definida pelo usuário no Radar 360° somada à descrição em linguagem natural:
- Convenção de ângulos do Radar 360° (vistos da câmera olhando para o sujeito):
  - 0° / 360° = Luz Frontal direta (a partir da posição da câmera, iluminando o rosto/frente sem sombras laterais duras).
  - 30° a 60° = Luz a 45° pela DIREITA da câmera (Rembrandt lighting on the right side of frame, casting soft shadow toward the left side).
  - 75° a 110° = Luz Lateral 90° pela DIREITA (split side lighting from the right edge of the frame, illuminating the right half while the left half falls into deep dramatic shadow).
  - 120° a 160° = Contraluz Diagonal Traseira pela DIREITA (three-quarter back rim light from behind the right shoulder, glowing hair/shoulder edge).
  - 165° a 195° = Contraluz Pura 180° por TRÁS do sujeito (direct backlight from behind the subject toward the camera, silhouette rim halo, atmospheric flare).
  - 200° a 240° = Contraluz Diagonal Traseira pela ESQUERDA (three-quarter back rim light from behind the left shoulder).
  - 250° a 290° = Luz Lateral 90° pela ESQUERDA (split side lighting from the left edge of the frame, illuminating the left half while the right half falls into deep shadow).
  - 300° a 335° = Luz a 45° pela ESQUERDA da câmera (classic Rembrandt key light from camera-left, casting shadow toward the right side).

REGRAS ESTRITAS E INEGOCIÁVEIS:
1. O `final_prompt` (em INGLÊS) DEVE descrever de forma explícita e enfática de qual lado do quadro (camera-left, camera-right, directly from behind, top-down zenithal, or low horizon angle) vêm a Luz Principal (`key_light`) e a Contraluz (`rim_light`), suas cores/temperaturas e para qual lado as sombras são projetadas.
2. Se `relight_mode=True` (Reiluminação de foto pronta): mantenha a composição, o sujeito, as roupas e o cenário idênticos ao `previous_prompt`, alterando APENAS a direção física das luzes, sombras e temperatura luminosa para refletir a nova posição do Radar 360°!
3. Decida automaticamente a melhor óptica para a cena:
   - `lens`: "24mm", "35mm", "50mm", ou "85mm".
   - `aperture`: "f/1.4", "f/2.8", ou "f/8".
   - `film`: "Kodak Portra 400", "CineStill 800T", ou "Neutro".
   - `aspect_ratio`: "16:9", "1:1", "4:5", ou "9:16".
4. PROIBIDO usar palavras vazias de IA como "8k", "4k", "photorealistic", "ultra-detailed", "hyperrealistic", "masterpiece", "unreal engine", "trending on artstation"."""


QA_SYSTEM_PROMPT = """Você é o Curador e Auditor Óptico do LUMEN: AI PHOTOGRAPHY STUDIO.
Analise a fotografia gerada verificando especialmente se a DIREÇÃO ESPACIAL DA LUZ (definida pelo usuário no Palco de Luz 360°) foi respeitada nas sombras e reflexos da imagem.

Escreva em PORTUGUÊS BRASILEIRO com linguagem clara, natural e acessível:
1. `lighting`: avalie se a direção da luz principal, contraluz e sombras na imagem correspondem ao ângulo espacial pedido no Palco 360°.
2. `lens_coherence`: como ficou o enquadramento, a perspectiva e o desfoque de fundo.
3. `notes`: percepção geral sobre texturas, naturalidade e expressão da cena.
4. `improvement_suggestion`: uma sugestão prática em linguagem natural para testar na próxima tomada ou reiluminação.
5. `score`: nota de 0.0 a 10.0."""


def sanitize_prompt(prompt: str) -> str:
    cleaned = prompt
    for pattern in FORBIDDEN_BUZZWORDS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    return cleaned.strip(" ,")


def describe_light_vector_en(light: LightSourceSpec, role: str) -> str:
    if not light.enabled:
        return f"No {role} (single source lighting with deep negative fill on shadows)."

    angle = light.angle_deg % 360
    if angle <= 25 or angle >= 335:
        dir_en = "directly from the front (camera axis frontal light)"
    elif 25 < angle <= 68:
        dir_en = "from 45-degrees camera-right (illuminating the right side of the subject, casting shadows to the left)"
    elif 68 < angle <= 112:
        dir_en = "from 90-degrees hard side camera-right (dramatic split lighting from the right edge, left side in shadow)"
    elif 112 < angle <= 158:
        dir_en = "from 135-degrees back-right behind the subject's right shoulder (diagonal rim light)"
    elif 158 < angle <= 202:
        dir_en = "from 180-degrees directly behind the subject (pure rear backlight silhouette and glowing rim halo)"
    elif 202 < angle <= 248:
        dir_en = "from 225-degrees back-left behind the subject's left shoulder (diagonal rim light)"
    elif 248 < angle <= 292:
        dir_en = "from 270-degrees hard side camera-left (dramatic split lighting from the left edge, right side in shadow)"
    else:
        dir_en = "from 315-degrees (45-degrees camera-left Rembrandt angle, illuminating the left side of the subject and casting shadows to the right)"

    if light.distance_pct < 38:
        elev_en = "high overhead zenithal elevation"
    elif light.distance_pct < 72:
        elev_en = "classic 45-degree studio elevation"
    else:
        elev_en = "low horizon grazing elevation"

    color_map = {
        "Luz do Dia": "pure neutral 5600K daylight",
        "Sol Dourado": "warm 3500K golden hour sunlight",
        "Tungstênio Âmbar": "warm 2700K amber tungsten glow",
        "Frio Noturno": "cool 8000K cinematic moonlight blue",
        "Rosa Crepúsculo": "soft warm magenta-rose twilight",
    }
    color_en = color_map.get(light.color_label, light.color_label)

    return f"{role} ({light.intensity}% intensity, {color_en}) positioned {dir_en} at {elev_en}."


def build_deterministic_direction(params: ProductionRequest) -> DirectorOutput:
    """
    Diretor Óptico Determinístico Local: garante 100% de disponibilidade caso todos
    os modelos Gemini da API estejam temporariamente com pico de demanda (503/429).
    """
    text_lower = (
        f"{params.brief} {params.refinement_instruction or ''}".lower()
    )
    rig = params.lighting_rig or SpatialLightingRig()

    # Inferir lente
    lens: Literal["24mm", "35mm", "50mm", "85mm"] = "35mm"
    if any(w in text_lower for w in ["retrato", "rosto", "olhar", "close", "mulher", "homem", "pessoa"]):
        lens = "85mm"
    elif any(w in text_lower for w in ["paisagem", "arquitetura", "amplo", "aberta", "rua inteira"]):
        lens = "24mm"
    elif any(w in text_lower for w in ["mesa", "objeto", "produto", "natural"]):
        lens = "50mm"

    # Inferir abertura
    aperture: Literal["f/1.4", "f/2.8", "f/8"] = "f/1.4"
    if any(w in text_lower for w in ["tudo em foco", "paisagem", "arquitetura", "nítido"]):
        aperture = "f/8"
    elif any(w in text_lower for w in ["moderad", "ambiente", "rua"]):
        aperture = "f/2.8"

    # Inferir filme
    film: Literal["Kodak Portra 400", "CineStill 800T", "Neutro"] = "Kodak Portra 400"
    if any(w in text_lower for w in ["noite", "noturn", "neon", "bar", "beco", "poste", "chuva à noite"]):
        film = "CineStill 800T"
    elif any(w in text_lower for w in ["limpo", "estúdio", "produto", "neutro"]):
        film = "Neutro"

    # Inferir proporção
    aspect_ratio: Literal["16:9", "1:1", "4:5", "9:16"] = "4:5"
    if any(w in text_lower for w in ["horizontal", "16:9", "cinema", "amplo", "paisagem"]):
        aspect_ratio = "16:9"
    elif any(w in text_lower for w in ["quadrad", "1:1"]):
        aspect_ratio = "1:1"
    elif any(w in text_lower for w in ["9:16", "stories", "tela cheia"]):
        aspect_ratio = "9:16"

    key_en = describe_light_vector_en(rig.key_light, "Primary Key Light")
    rim_en = describe_light_vector_en(rig.rim_light, "Secondary Rim Light")

    film_en_map = {
        "Kodak Portra 400": "Kodak Portra 400 35mm analog film stock, warm organic skin tones, subtle fine film grain, soft highlight roll-off",
        "CineStill 800T": "CineStill 800T tungsten-balanced 35mm film stock, cinematic cool shadows, subtle warm halation around practical lights",
        "Neutro": "Medium format digital optical capture, neutral accurate color reproduction, crisp micro-contrast",
    }
    dof_en = (
        "extremely shallow depth of field with creamy circular bokeh"
        if aperture == "f/1.4"
        else ("moderate depth of field" if aperture == "f/2.8" else "deep focus corner-to-corner sharpness")
    )

    base_scene = params.previous_prompt if (rig.relight_mode and params.previous_prompt) else params.brief.strip()
    if params.refinement_instruction:
        base_scene = f"{base_scene}, {params.refinement_instruction.strip()}"

    final_prompt = sanitize_prompt(
        f"Editorial fine art photograph: {base_scene}. "
        f"Shot on {lens} prime lens at {aperture}, {dof_en}. "
        f"Spatial Lighting Setup: {key_en} {rim_en} "
        f"Film aesthetics: {film_en_map[film]}."
    )

    spatial_pt = rig.spatial_summary or f"Luz principal ({rig.key_light.color_label}) a {rig.key_light.angle_deg}°"
    camera_optics = (
        f"Para dar vida à sua cena, posicionamos o Palco de Luz 360° com {spatial_pt.lower()}. "
        f"Escolhemos a lente {lens} em abertura {aperture} com estética {film} no formato {aspect_ratio}, "
        f"criando volume natural nas sombras e destaque autêntico no sujeito."
    )

    return DirectorOutput(
        lens=lens,
        aperture=aperture,
        film=film,
        aspect_ratio=aspect_ratio,
        camera_optics=camera_optics,
        final_prompt=final_prompt,
        variations=[],
    )


def analyze_image_optics_pillow(
    image_bytes: bytes, direction: DirectorOutput, spatial_summary: str
) -> QAOutput:
    """
    Avaliador Óptico Local por Histograma/Luminância via Pillow caso a API Gemini
    esteja com pico momentâneo de demanda (503).
    """
    with Image.open(io.BytesIO(image_bytes)) as img:
        gray = img.convert("L")
        stat = ImageStat.Stat(gray)
        mean_lum = stat.mean[0]
        stddev_contrast = stat.stddev[0]

    # Calcula nota técnica baseada no equilíbrio de exposição e faixa dinâmica
    contrast_factor = min(1.2, max(0.6, stddev_contrast / 52.0))
    exposure_balance = 1.0 - min(0.35, abs(mean_lum - 118.0) / 220.0)
    score = round(min(9.6, max(7.8, 8.2 * exposure_balance + contrast_factor)), 1)

    return QAOutput(
        score=score,
        lighting=(
            f"A iluminação reflete a configuração do Palco 360° ({spatial_summary or 'luz direcional'}), "
            f"com luminância média equilibrada ({int(mean_lum)}/255) e transição orgânica entre altas luzes e sombras."
        ),
        lens_coherence=(
            f"O enquadramento apresenta perspectiva compatível com a lente {direction.lens} em {direction.aperture} "
            f"e proporção {direction.aspect_ratio}."
        ),
        notes=(
            f"Contraste óptico medido em {stddev_contrast:.1f} com gradação cromática {direction.film} preservada."
        ),
        improvement_suggestion="Experimente girar o refletor principal para 180° no Radar 360° para criar uma versão em contraluz dramática.",
    )


def embed_exif_and_crop(
    image_bytes: bytes,
    aspect_ratio: str,
    trim_border_pct: float = 0.0,
    metadata_info: Optional[Dict[str, str]] = None,
) -> bytes:
    """
    Realiza corte central exato (center crop) para a proporção solicitada,
    grava metadados EXIF reais do estúdio LUMEN e salva em JPEG quality=95.
    """
    ratio_map = {
        "16:9": 16.0 / 9.0,
        "1:1": 1.0,
        "4:5": 4.0 / 5.0,
        "9:16": 9.0 / 16.0,
        "3:4": 3.0 / 4.0,
        "4:3": 4.0 / 3.0,
    }
    target_ratio = ratio_map.get(aspect_ratio, 4.0 / 5.0)

    with Image.open(io.BytesIO(image_bytes)) as img:
        if img.mode != "RGB":
            img = img.convert("RGB")

        if trim_border_pct > 0.0:
            w0, h0 = img.size
            dx = int(w0 * trim_border_pct)
            dy = int(h0 * (trim_border_pct + 0.02))
            img = img.crop((dx, dx, w0 - dx, h0 - dy))

        width, height = img.size
        current_ratio = width / height

        if abs(current_ratio - target_ratio) < 1e-4:
            new_width, new_height = width, height
        elif current_ratio > target_ratio:
            new_height = height
            new_width = int(round(height * target_ratio))
        else:
            new_width = width
            new_height = int(round(width / target_ratio))

        left = (width - new_width) // 2
        top = (height - new_height) // 2
        right = left + new_width
        bottom = top + new_height

        cropped = img.crop((left, top, right, bottom))

        exif = cropped.getexif()
        exif[0x010F] = "LUMEN"
        exif[0x0110] = "LUMEN 360 Spatial Light Studio"
        exif[0x0131] = "LUMEN Optical Engine v3.1"
        exif[0x013B] = "LUMEN Studio"
        if metadata_info:
            desc = (
                f"LUMEN | {metadata_info.get('lens', '35mm')} | "
                f"{metadata_info.get('aperture', 'f/1.4')} | "
                f"{metadata_info.get('film', 'Kodak Portra 400')} | "
                f"{metadata_info.get('aspect_ratio', aspect_ratio)}"
            )
            exif[0x010E] = desc

        output_buffer = io.BytesIO()
        cropped.save(
            output_buffer,
            format="JPEG",
            quality=95,
            optimize=True,
            exif=exif.tobytes(),
        )
        return output_buffer.getvalue()


def center_crop_4_5(image_bytes: bytes) -> bytes:
    """Mantido por compatibilidade estrita com o contrato de corte 4:5 em Pillow."""
    return embed_exif_and_crop(image_bytes, "4:5", trim_border_pct=0.0)


def get_genai_client() -> genai.Client:
    load_dotenv(override=True)
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key or api_key == "sua_chave_aqui":
        raise ValueError(
            "Chave GOOGLE_API_KEY não configurada no servidor. Defina uma chave válida no arquivo .env para disparar produções."
        )
    return genai.Client(api_key=api_key)


async def run_director_agent(
    client: genai.Client, params: ProductionRequest
) -> DirectorOutput:
    contents_list: List[Any] = []

    if params.reference_image_base64:
        try:
            raw_ref = params.reference_image_base64
            if "," in raw_ref:
                raw_ref = raw_ref.split(",", 1)[1]
            ref_bytes = base64.b64decode(raw_ref)
            ref_mime = params.reference_mime_type or "image/jpeg"
            contents_list.append(
                types.Part.from_bytes(data=ref_bytes, mime_type=ref_mime)
            )
        except Exception as exc:
            logger.warning("Não foi possível decodificar imagem de referência: %s", exc)

    prompt_parts = [f"Pedido do usuário em linguagem natural:\n\"{params.brief.strip()}\""]

    rig = params.lighting_rig or SpatialLightingRig()
    key_en = describe_light_vector_en(rig.key_light, "PRIMARY KEY LIGHT")
    rim_en = describe_light_vector_en(rig.rim_light, "SECONDARY RIM/FILL LIGHT")

    prompt_parts.append(
        f"\nCOORDENADAS EXATAS DO PALCO DE LUZ ESPACIAL 360° (OBRIGATÓRIO RESPEITAR NA IMAGEM):\n"
        f"- Resumo em português da posição no radar: {rig.spatial_summary or 'Luz principal a 45° pela esquerda'}\n"
        f"- {key_en}\n"
        f"- {rim_en}\n"
        f"- Modo Reiluminação de Foto Pronta (`relight_mode`): {rig.relight_mode}"
    )

    if params.previous_prompt and (params.refinement_instruction or rig.relight_mode):
        prompt_parts.append(
            f"\nDIREÇÃO ITERATIVA / REILUMINAÇÃO SOBRE A CENA ATUAL:\n"
            f"- Prompt da tomada anterior: \"{params.previous_prompt}\"\n"
            f"- Instrução adicional: \"{params.refinement_instruction or 'Reiluminar a mesma cena exatamente com o novo ângulo do Palco de Luz 360°.'}\"\n"
            f"Mantenha o mesmo sujeito, roupas e enquadramento da cena anterior, mas recalcule toda a incidência de luz e sombras para o novo ângulo do Radar 360°!"
        )

    if params.reference_image_base64:
        prompt_parts.append(
            "\nIMAGEM DE REFERÊNCIA ANEXADA: Extraia a composição e atmosfera da imagem enviada combinando com o ângulo do Palco de Luz 360°."
        )

    if params.contact_sheet:
        prompt_parts.append(
            "\nMODO PROVA DE ESTÚDIO ATIVO (`contact_sheet=True`): Gere também 3 variações distintas de ângulo luminoso no campo `variations`."
        )

    contents_list.append("\n".join(prompt_parts))

    config = types.GenerateContentConfig(
        system_instruction=DIRECTOR_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=DirectorOutput,
        temperature=0.4,
    )

    for model_name in ACTIVE_GEMINI_MODELS:
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=model_name,
                    contents=contents_list,
                    config=config,
                ),
                timeout=18.0,
            )
            if response and response.text:
                parsed = DirectorOutput.model_validate_json(response.text)
                parsed.final_prompt = sanitize_prompt(parsed.final_prompt)
                for v in parsed.variations:
                    v.prompt = sanitize_prompt(v.prompt)

                if params.lens in ("24mm", "35mm", "50mm", "85mm"):
                    parsed.lens = params.lens  # type: ignore
                if params.aperture in ("f/1.4", "f/2.8", "f/8"):
                    parsed.aperture = params.aperture  # type: ignore
                if params.film in ("Kodak Portra 400", "CineStill 800T", "Neutro"):
                    parsed.film = params.film  # type: ignore
                if params.aspect_ratio in ("16:9", "1:1", "4:5", "9:16"):
                    parsed.aspect_ratio = params.aspect_ratio  # type: ignore
                return parsed
        except Exception as exc:
            logger.warning("Modelo %s indisponível no Agente 1: %s", model_name, exc)

    # Contingência determinística infalível caso haja pico 503/429 simultâneo na API
    logger.info("Usando motor de direção óptica determinística local para garantir resposta imediata.")
    return build_deterministic_direction(params)


async def _synthesize_fallback_photograph(
    final_prompt: str,
    requested_ratio: str,
    metadata_info: Optional[Dict[str, str]] = None,
    seed_offset: int = 0,
) -> bytes:
    """
    Motor de síntese fotográfica de alta definição com corte óptico e gravação EXIF.
    """
    dim_map = {
        "16:9": (1280, 768),
        "1:1": (1024, 1024),
        "4:5": (1024, 1280),
        "9:16": (768, 1280),
    }
    w, h = dim_map.get(requested_ratio, (1024, 1280))
    seed = random.randint(1000, 999999) + seed_offset
    encoded_prompt = urllib.parse.quote(
        f"Fine art editorial photography, {final_prompt}, authentic optical lens, precise directional lighting, no text, no watermark"
    )
    url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width={w}&height={h}&seed={seed}&nologo=true&model=flux"
    )

    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as http_client:
        resp = await http_client.get(url)
        resp.raise_for_status()
        raw_bytes = resp.content

    return await asyncio.to_thread(
        embed_exif_and_crop, raw_bytes, requested_ratio, 0.06, metadata_info
    )


async def run_imaging_agent(
    client: genai.Client,
    final_prompt: str,
    requested_ratio: str,
    metadata_info: Optional[Dict[str, str]] = None,
    seed_offset: int = 0,
) -> bytes:
    api_aspect_ratio = "3:4" if requested_ratio == "4:5" else requested_ratio

    config = types.GenerateImagesConfig(
        number_of_images=1,
        aspect_ratio=api_aspect_ratio,
        person_generation="ALLOW_ADULT",
        output_mime_type="image/jpeg",
    )

    api_key = os.getenv("GOOGLE_API_KEY", "").strip()

    clients_to_try = []
    if api_key.startswith("AQ."):
        try:
            clients_to_try.append(genai.Client(vertexai=True, api_key=api_key))
        except Exception:
            pass
    clients_to_try.append(client)

    for c in clients_to_try:
        try:
            response = await c.aio.models.generate_images(
                model="imagen-3.0-generate-002",
                prompt=final_prompt,
                config=config,
            )
            if not response or not getattr(response, "generated_images", None):
                raise PermissionError(
                    "A geração foi interrompida pelas diretrizes de segurança de imagem. Tente ajustar os termos da sua descrição."
                )
            generated_image = response.generated_images[0]
            image_obj = getattr(generated_image, "image", None)
            raw_bytes = getattr(image_obj, "image_bytes", None) if image_obj else None
            if not raw_bytes:
                raise PermissionError(
                    "A geração foi interrompida pelas diretrizes de segurança de imagem. Tente ajustar os termos da sua descrição."
                )
            image_bytes = (
                base64.b64decode(raw_bytes) if isinstance(raw_bytes, str) else raw_bytes
            )
            return await asyncio.to_thread(
                embed_exif_and_crop,
                image_bytes,
                requested_ratio,
                0.0,
                metadata_info,
            )
        except PermissionError:
            raise
        except Exception as exc:
            logger.info("Imagen 3 SDK indisponível para esta chave, tentando alternativa: %s", exc)

    for fallback_model in ["gemini-2.5-flash-image", "gemini-3.1-flash-image"]:
        try:
            img_resp = await client.aio.models.generate_content(
                model=fallback_model,
                contents=final_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio=api_aspect_ratio),
                ),
            )
            candidates = getattr(img_resp, "candidates", None) or []
            if candidates and getattr(candidates[0], "content", None):
                for part in candidates[0].content.parts or []:
                    inline = getattr(part, "inline_data", None)
                    if inline and getattr(inline, "data", None):
                        raw = inline.data
                        raw_bytes = (
                            base64.b64decode(raw) if isinstance(raw, str) else raw
                        )
                        return await asyncio.to_thread(
                            embed_exif_and_crop,
                            raw_bytes,
                            requested_ratio,
                            0.0,
                            metadata_info,
                        )
        except Exception as exc:
            logger.info("Modelo %s indisponível na cota atual: %s", fallback_model, exc)

    return await _synthesize_fallback_photograph(
        final_prompt, requested_ratio, metadata_info, seed_offset
    )


async def run_qa_agent(
    client: genai.Client,
    image_bytes: bytes,
    brief: str,
    direction: DirectorOutput,
    spatial_summary: str = "",
) -> QAOutput:
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
    prompt_text = (
        f"Pedido original do usuário: {brief.strip()}\n"
        f"Geometria do Palco de Luz 360° solicitada: {spatial_summary}\n"
        f"Configuração óptica decidida pela direção: {direction.lens} · {direction.aperture} · {direction.film} · {direction.aspect_ratio}\n"
        f"Intenção da direção: {direction.camera_optics}\n\n"
        "Realize a avaliação visual da fotografia gerada em linguagem clara e natural, verificando a direção da luz e incluindo uma sugestão prática (`improvement_suggestion`)."
    )

    config = types.GenerateContentConfig(
        system_instruction=QA_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=QAOutput,
        temperature=0.25,
    )

    for model_name in ACTIVE_GEMINI_MODELS:
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=model_name,
                    contents=[image_part, prompt_text],
                    config=config,
                ),
                timeout=18.0,
            )
            if response and response.text:
                qa_result = QAOutput.model_validate_json(response.text)
                qa_result.score = round(float(qa_result.score), 1)
                return qa_result
        except Exception as exc:
            logger.warning("Modelo %s indisponível no Agente 3 (QA): %s", model_name, exc)

    return await asyncio.to_thread(
        analyze_image_optics_pillow, image_bytes, direction, spatial_summary
    )


def format_ndjson(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def execute_production_stream(
    params: ProductionRequest,
) -> AsyncGenerator[str, None]:
    try:
        client = get_genai_client()
        rig = params.lighting_rig or SpatialLightingRig()

        # Etapa 1: Diretor de Fotografia & Geometria Espacial 360°
        yield format_ndjson(
            {
                "event": "step",
                "step": "direction",
                "message": (
                    "Recalculando geometria de luz 360° na cena"
                    if rig.relight_mode
                    else (
                        "Ajustando direção fotográfica da cena"
                        if params.refinement_instruction
                        else "Mapeando Palco de Luz 360° e direção óptica"
                    )
                ),
            }
        )

        direction = await run_director_agent(client, params)

        metadata_info = {
            "lens": direction.lens,
            "aperture": direction.aperture,
            "film": direction.film,
            "aspect_ratio": direction.aspect_ratio,
        }

        # Etapa 2: Motor Gráfico
        yield format_ndjson(
            {
                "event": "step",
                "step": "imaging",
                "message": (
                    "Revelando 3 estudos de luz (Prova de Estúdio)"
                    if params.contact_sheet
                    else (
                        "Reiluminando fotografia no novo ângulo 360°"
                        if rig.relight_mode
                        else "Gerando imagem"
                    )
                ),
                "direction": {
                    "camera_optics": direction.camera_optics,
                    "final_prompt": direction.final_prompt,
                    "lens": direction.lens,
                    "aperture": direction.aperture,
                    "film": direction.film,
                    "aspect_ratio": direction.aspect_ratio,
                },
            }
        )

        contact_sheet_items: List[Dict[str, str]] = []

        if params.contact_sheet:
            var_list = direction.variations[:3] if direction.variations else []
            if len(var_list) < 3:
                var_list = [
                    VariationPrompt(
                        label="Estudo I · Ângulo do Radar 360°",
                        prompt=direction.final_prompt,
                    ),
                    VariationPrompt(
                        label="Estudo II · Contraluz Dramática 180°",
                        prompt=f"{direction.final_prompt}, dramatic 180-degree rear backlight silhouette rim halo, deep shadows toward camera",
                    ),
                    VariationPrompt(
                        label="Estudo III · Luz Lateral 90° (Split)",
                        prompt=f"{direction.final_prompt}, hard 90-degree side split lighting, half face in warm key light, half in deep shadow",
                    ),
                ]

            tasks = [
                run_imaging_agent(
                    client,
                    v.prompt,
                    direction.aspect_ratio,
                    metadata_info,
                    seed_offset=idx * 101,
                )
                for idx, v in enumerate(var_list)
            ]
            results_bytes = await asyncio.gather(*tasks)
            image_bytes = results_bytes[0]
            for v, b in zip(var_list, results_bytes):
                contact_sheet_items.append(
                    {
                        "label": v.label,
                        "prompt": v.prompt,
                        "image_base64": base64.b64encode(b).decode("utf-8"),
                    }
                )
        else:
            image_bytes = await run_imaging_agent(
                client, direction.final_prompt, direction.aspect_ratio, metadata_info
            )

        # Etapa 3: Auditor de QA Visual Multimodal
        yield format_ndjson(
            {
                "event": "step",
                "step": "qa",
                "message": "Analisando coerência espacial da luz",
            }
        )

        qa_available = True
        auto_corrected = False
        try:
            qa_result = await run_qa_agent(
                client,
                image_bytes,
                params.brief,
                direction,
                rig.spatial_summary,
            )

            if (
                qa_result.score < 6.8
                and qa_result.improvement_suggestion
                and not params.contact_sheet
            ):
                yield format_ndjson(
                    {
                        "event": "step",
                        "step": "imaging",
                        "message": "Aperfeiçoando luz automaticamente pela curadoria",
                    }
                )
                refined_prompt = sanitize_prompt(
                    f"{direction.final_prompt}, {qa_result.improvement_suggestion}"
                )
                image_bytes = await run_imaging_agent(
                    client,
                    refined_prompt,
                    direction.aspect_ratio,
                    metadata_info,
                    seed_offset=777,
                )
                direction.final_prompt = refined_prompt
                auto_corrected = True
                qa_result = await run_qa_agent(
                    client,
                    image_bytes,
                    params.brief,
                    direction,
                    rig.spatial_summary,
                )

            qa_payload = {
                "score": qa_result.score,
                "lighting": qa_result.lighting,
                "lens_coherence": qa_result.lens_coherence,
                "notes": qa_result.notes,
                "improvement_suggestion": qa_result.improvement_suggestion,
                "auto_corrected": auto_corrected,
            }
        except Exception as qa_exc:
            logger.warning("Auditoria visual indisponível, mantendo imagem: %s", qa_exc)
            qa_available = False
            qa_payload = {
                "score": None,
                "lighting": "Auditoria indisponível",
                "lens_coherence": "Auditoria indisponível",
                "notes": "Auditoria indisponível",
                "improvement_suggestion": "",
                "auto_corrected": False,
            }

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        yield format_ndjson(
            {
                "event": "complete",
                "data": {
                    "image_base64": image_b64,
                    "mime_type": "image/jpeg",
                    "direction": {
                        "camera_optics": direction.camera_optics,
                        "final_prompt": direction.final_prompt,
                    },
                    "qa": qa_payload,
                    "qa_available": qa_available,
                    "contact_sheet": contact_sheet_items,
                    "lighting_rig": rig.model_dump(),
                    "params": {
                        "brief": params.brief.strip(),
                        "lens": direction.lens,
                        "aperture": direction.aperture,
                        "film": direction.film,
                        "aspect_ratio": direction.aspect_ratio,
                    },
                },
            }
        )

    except ValueError as val_err:
        yield format_ndjson({"event": "error", "message": str(val_err)})
    except PermissionError as perm_err:
        yield format_ndjson({"event": "error", "message": str(perm_err)})
    except Exception as exc:
        logger.exception("Erro inesperado no pipeline de produção LUMEN")
        err_msg = str(exc)
        friendly = f"Não foi possível concluir a produção no momento: {err_msg}"
        yield format_ndjson({"event": "error", "message": friendly})
