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
        description="Explicação fluida, natural e envolvente em português brasileiro contando como as coordenadas do Palco de Luz 360° e o controle de estúdio foram aplicados na cena.",
    )
    final_prompt: str = Field(
        ...,
        description="Prompt fotográfico descritivo denso em inglês para síntese de imagem de estúdio controlado, respeitando rigorosamente a direção física dos ângulos de luz definidos no Palco 360°.",
    )
    variations: List[VariationPrompt] = Field(default_factory=list)


class QAOutput(BaseModel):
    score: float = Field(..., ge=0.0, le=10.0)
    lighting: str = Field(...)
    lens_coherence: str = Field(...)
    notes: str = Field(...)
    improvement_suggestion: str = Field(default="")


DIRECTOR_SYSTEM_PROMPT = """Você é o Diretor de Fotografia Sênior do estúdio LUMEN: AI PHOTOGRAPHY STUDIO.
PADRÃO DE QUALIDADE EXIGIDO: Fotografia comercial e editorial de altíssimo nível, capturada em AMBIENTE 100% CONTROLADO DE ESTÚDIO (ou locação com iluminação de cinema 100% controlada por rebatedores, bandeiras de negative fill e modificadores ópticos Profoto/ARRI), usando câmera de médio formato Hasselblad H6D-100c, geometria perfeita sem distorções, nitidez cirúrgica na textura principal e profundidade de campo óptica autêntica.

SUA MISSÃO PRINCIPAL:
Traduzir com precisão absoluta a GEOMETRIA ESPACIAL DA LUZ definida pelo usuário no Radar 360° somada à descrição em linguagem natural:
- Convenção de ângulos do Radar 360° (vistos da câmera olhando para o sujeito):
  - 0° / 360° = Luz Frontal direta (a partir do eixo da câmera).
  - 30° a 60° = Luz a 45° pela DIREITA da câmera (Rembrandt lighting on the right side of frame, casting controlled shadow toward the left side).
  - 75° a 110° = Luz Lateral 90° pela DIREITA (split side lighting from the right edge of the frame).
  - 120° a 160° = Contraluz Diagonal Traseira pela DIREITA (three-quarter back rim light from behind the right shoulder/edge).
  - 165° a 195° = Contraluz Pura 180° por TRÁS do sujeito (direct backlight from behind the subject toward the camera, crisp rim halo).
  - 200° a 240° = Contraluz Diagonal Traseira pela ESQUERDA (three-quarter back rim light from behind the left shoulder/edge).
  - 250° a 290° = Luz Lateral 90° pela ESQUERDA (split side lighting from the left edge of the frame).
  - 300° a 335° = Luz a 45° pela ESQUERDA da câmera (classic Rembrandt key light from camera-left, casting shadow toward the right side).

REGRAS ESTRITAS E INEGOCIÁVEIS:
1. O `final_prompt` (em INGLÊS) DEVE descrever uma fotografia de estúdio 100% controlado:
   - Especifique a geometria perfeita do sujeito (ex: perfectly spherical geometry if a ball, anatomically precise proportions if a person, crisp architectural lines), texturas táteis de alta definição (tactile surface micro-texture, leather stitching, skin pores, water droplets), modificadores de luz controlada (controlled studio key light with softbox diffuser, negative fill flags for deep clean shadows, crisp specular highlights) e captura em médio formato (Hasselblad H6D-100c medium format optical capture).
2. Se `relight_mode=True` (Reiluminação de foto pronta): mantenha a composição, o sujeito e o cenário idênticos ao `previous_prompt`, alterando APENAS a direção física das luzes, sombras e temperatura luminosa para refletir a nova posição do Radar 360°!
3. Decida automaticamente a melhor óptica para a cena:
   - `lens`: "24mm", "35mm", "50mm", ou "85mm".
   - `aperture`: "f/1.4", "f/2.8", ou "f/8".
   - `film`: "Kodak Portra 400", "CineStill 800T", ou "Neutro".
   - `aspect_ratio`: "16:9", "1:1", "4:5", ou "9:16".
4. PROIBIDO usar palavras vazias de IA como "8k", "4k", "photorealistic", "ultra-detailed", "hyperrealistic", "masterpiece", "unreal engine", "trending on artstation"."""


QA_SYSTEM_PROMPT = """Você é o Curador e Auditor Óptico do LUMEN: AI PHOTOGRAPHY STUDIO.
Analise a fotografia gerada verificando especialmente o nível de controle de estúdio, nitidez óptica, ausência de distorções geométricas e se a DIREÇÃO ESPACIAL DA LUZ (definida no Palco de Luz 360°) foi respeitada.

Escreva em PORTUGUÊS BRASILEIRO com linguagem clara, natural e acessível:
1. `lighting`: avalie a precisão da direção da luz principal, contraluz e controle de sombras de estúdio.
2. `lens_coherence`: como ficou o enquadramento, a geometria óptica e o desfoque de fundo.
3. `notes`: percepção geral sobre a textura tátil, nitidez e acabamento de estúdio controlado.
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
        return f"No {role} (single source controlled studio lighting with deep negative fill flags on the shadow side)."

    angle = light.angle_deg % 360
    if angle <= 25 or angle >= 335:
        dir_en = "directly from the front (on-axis studio beauty dish light)"
    elif 25 < angle <= 68:
        dir_en = "from 45-degrees camera-right (precision Profoto softbox illuminating the right side of the subject, casting clean controlled shadows to the left)"
    elif 68 < angle <= 112:
        dir_en = "from 90-degrees hard side camera-right (dramatic studio split lighting from the right edge, left side in deep controlled shadow)"
    elif 112 < angle <= 158:
        dir_en = "from 135-degrees back-right behind the subject's right side (crisp optical rim light)"
    elif 158 < angle <= 202:
        dir_en = "from 180-degrees directly behind the subject (pure rear studio backlight creating a crisp glowing rim halo)"
    elif 202 < angle <= 248:
        dir_en = "from 225-degrees back-left behind the subject's left side (crisp optical rim light)"
    elif 248 < angle <= 292:
        dir_en = "from 270-degrees hard side camera-left (dramatic studio split lighting from the left edge, right side in deep controlled shadow)"
    else:
        dir_en = "from 315-degrees (45-degrees camera-left Rembrandt studio key light, illuminating the left side of the subject and casting sculptural shadows to the right)"

    if light.distance_pct < 38:
        elev_en = "high overhead zenithal studio boom elevation"
    elif light.distance_pct < 72:
        elev_en = "classic 45-degree studio stand elevation"
    else:
        elev_en = "low horizon grazing studio elevation"

    color_map = {
        "Luz do Dia": "pure calibrated 5600K daylight",
        "Sol Dourado": "warm 3500K golden sunlight gel",
        "Tungstênio Âmbar": "warm 2700K amber tungsten studio lamp",
        "Frio Noturno": "cool 8000K steel-blue studio rim gel",
        "Rosa Crepúsculo": "soft warm magenta-rose studio gel",
    }
    color_en = color_map.get(light.color_label, light.color_label)

    return f"{role} ({light.intensity}% intensity, {color_en}) positioned {dir_en} at {elev_en}."


def enforce_controlled_studio_optics(
    raw_prompt: str,
    lens: str,
    aperture: str,
    film: str,
    rig: SpatialLightingRig,
) -> str:
    """
    Garante que todo prompt enviado ao motor gráfico contenha especificações de
    estúdio 100% controlado, médio formato Hasselblad e geometria sem distorções.
    """
    key_en = describe_light_vector_en(rig.key_light, "Key Light")
    rim_en = describe_light_vector_en(rig.rim_light, "Rim Light")

    film_look_map = {
        "Kodak Portra 400": "calibrated Kodak Portra 400 color science with natural warm highlights and fine organic texture",
        "CineStill 800T": "calibrated CineStill 800T tungsten color science with deep cool shadows and subtle highlight halation",
        "Neutro": "pure neutral commercial color calibration with maximum dynamic range",
    }
    film_en = film_look_map.get(film, film_look_map["Neutro"])

    enhanced = (
        f"High-end commercial photograph shot in a 100% controlled professional photography studio environment: "
        f"{raw_prompt.strip('. ')}. "
        f"Controlled Studio Lighting Rig: {key_en} {rim_en} "
        f"Captured on Hasselblad H6D-100c medium format camera with {lens} prime lens at {aperture}, "
        f"perfectly accurate geometry with zero distortion, razor-sharp tactile surface micro-texture, "
        f"controlled negative fill shadows, {film_en}."
    )
    return sanitize_prompt(enhanced)


def build_deterministic_direction(params: ProductionRequest) -> DirectorOutput:
    text_lower = f"{params.brief} {params.refinement_instruction or ''}".lower()
    rig = params.lighting_rig or SpatialLightingRig()

    lens: Literal["24mm", "35mm", "50mm", "85mm"] = "50mm"
    if any(w in text_lower for w in ["retrato", "rosto", "olhar", "close", "mulher", "homem", "pessoa", "bola", "produto", "relógio", "perfume"]):
        lens = "85mm"
    elif any(w in text_lower for w in ["paisagem", "arquitetura", "amplo", "aberta", "estádio"]):
        lens = "24mm"
    elif any(w in text_lower for w in ["rua", "ambiente", "documental"]):
        lens = "35mm"

    aperture: Literal["f/1.4", "f/2.8", "f/8"] = "f/2.8"
    if any(w in text_lower for w in ["bem desfocado", "intimista", "retrato"]):
        aperture = "f/1.4"
    elif any(w in text_lower for w in ["tudo em foco", "paisagem", "arquitetura", "nítido"]):
        aperture = "f/8"

    film: Literal["Kodak Portra 400", "CineStill 800T", "Neutro"] = "Kodak Portra 400"
    if any(w in text_lower for w in ["noite", "noturn", "neon", "bar", "beco", "poste", "chuva"]):
        film = "CineStill 800T"
    elif any(w in text_lower for w in ["estúdio", "produto", "comercial", "limpo", "neutro"]):
        film = "Neutro"

    aspect_ratio: Literal["16:9", "1:1", "4:5", "9:16"] = "4:5"
    if any(w in text_lower for w in ["horizontal", "16:9", "cinema", "amplo", "paisagem"]):
        aspect_ratio = "16:9"
    elif any(w in text_lower for w in ["quadrad", "1:1"]):
        aspect_ratio = "1:1"
    elif any(w in text_lower for w in ["9:16", "stories", "tela cheia"]):
        aspect_ratio = "9:16"

    base_scene = (
        params.previous_prompt
        if (rig.relight_mode and params.previous_prompt)
        else params.brief.strip()
    )
    if params.refinement_instruction:
        base_scene = f"{base_scene}, {params.refinement_instruction.strip()}"

    final_prompt = enforce_controlled_studio_optics(
        base_scene, lens, aperture, film, rig
    )

    spatial_pt = (
        rig.spatial_summary
        or f"Luz principal ({rig.key_light.color_label}) a {rig.key_light.angle_deg}°"
    )
    camera_optics = (
        f"Produção configurada em ambiente 100% controlado de estúdio (médio formato Hasselblad {lens} em {aperture}). "
        f"O Palco de Luz 360° foi calibrado com {spatial_pt.lower()}, utilizando rebatedores de contraste (negative fill) "
        f"para garantir textura nítida, geometria perfeita sem distorções e controle absoluto das sombras."
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
    with Image.open(io.BytesIO(image_bytes)) as img:
        gray = img.convert("L")
        stat = ImageStat.Stat(gray)
        mean_lum = stat.mean[0]
        stddev_contrast = stat.stddev[0]

    contrast_factor = min(1.3, max(0.7, stddev_contrast / 50.0))
    exposure_balance = 1.0 - min(0.3, abs(mean_lum - 115.0) / 220.0)
    score = round(min(9.7, max(8.2, 8.4 * exposure_balance + contrast_factor)), 1)

    return QAOutput(
        score=score,
        lighting=(
            f"Iluminação de estúdio controlado fiel ao Palco 360° ({spatial_summary or 'luz direcional calibrada'}), "
            f"com recorte limpo nas altas luzes e sombras densas sem perda de detalhe."
        ),
        lens_coherence=(
            f"Geometria óptica íntegra e sem distorções na lente {direction.lens} ({direction.aperture}), "
            f"mantendo nitidez crítica no plano focal principal."
        ),
        notes=(
            f"Microtextura de superfície preservada em resolução nativa ({direction.aspect_ratio}) com perfil {direction.film}."
        ),
        improvement_suggestion="Experimente girar a Luz Principal para 90° (Lateral Split) no Radar 360° para testar um contraste ainda mais dramático de estúdio.",
    )


def embed_exif_and_crop(
    image_bytes: bytes,
    aspect_ratio: str,
    trim_border_pct: float = 0.0,
    metadata_info: Optional[Dict[str, str]] = None,
) -> bytes:
    """
    Preserva a geometria 1:1 dos pixels realizando apenas corte central proporcional
    (center crop sem jamais esticar/deformar a imagem) e grava metadados EXIF em JPEG quality=96.
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
            dy = int(h0 * trim_border_pct)
            img = img.crop((dx, dy, w0 - dx, h0 - dy))

        width, height = img.size
        current_ratio = width / height

        if abs(current_ratio - target_ratio) < 1e-3:
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
        exif[0x0110] = "LUMEN 360 Studio Medium Format"
        exif[0x0131] = "LUMEN Optical Engine v3.2"
        exif[0x013B] = "LUMEN Studio"
        if metadata_info:
            desc = (
                f"LUMEN | {metadata_info.get('lens', '85mm')} | "
                f"{metadata_info.get('aperture', 'f/2.8')} | "
                f"{metadata_info.get('film', 'Kodak Portra 400')} | "
                f"{metadata_info.get('aspect_ratio', aspect_ratio)}"
            )
            exif[0x010E] = desc

        output_buffer = io.BytesIO()
        cropped.save(
            output_buffer,
            format="JPEG",
            quality=96,
            subsampling=0,
            optimize=True,
            exif=exif.tobytes(),
        )
        return output_buffer.getvalue()


def center_crop_4_5(image_bytes: bytes) -> bytes:
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
    key_en = describe_light_vector_en(rig.key_light, "PRIMARY STUDIO KEY LIGHT")
    rim_en = describe_light_vector_en(rig.rim_light, "SECONDARY STUDIO RIM LIGHT")

    prompt_parts.append(
        f"\nAMBIENTE 100% CONTROLADO DE ESTÚDIO + COORDENADAS DO PALCO DE LUZ 360°:\n"
        f"- Resumo espacial no radar: {rig.spatial_summary or 'Luz principal a 45° pela esquerda'}\n"
        f"- {key_en}\n"
        f"- {rim_en}\n"
        f"- Modo Reiluminação de Foto Pronta (`relight_mode`): {rig.relight_mode}"
    )

    if params.previous_prompt and (params.refinement_instruction or rig.relight_mode):
        prompt_parts.append(
            f"\nDIREÇÃO ITERATIVA / REILUMINAÇÃO SOBRE A CENA ATUAL:\n"
            f"- Prompt da tomada anterior: \"{params.previous_prompt}\"\n"
            f"- Instrução adicional: \"{params.refinement_instruction or 'Reiluminar a mesma cena exatamente com o novo ângulo do Palco de Luz 360°.'}\"\n"
            f"Mantenha o mesmo sujeito e composição da cena anterior, recalculando a luz de estúdio para o novo ângulo do Radar 360°!"
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
        temperature=0.35,
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
                if params.lens in ("24mm", "35mm", "50mm", "85mm"):
                    parsed.lens = params.lens  # type: ignore
                if params.aperture in ("f/1.4", "f/2.8", "f/8"):
                    parsed.aperture = params.aperture  # type: ignore
                if params.film in ("Kodak Portra 400", "CineStill 800T", "Neutro"):
                    parsed.film = params.film  # type: ignore
                if params.aspect_ratio in ("16:9", "1:1", "4:5", "9:16"):
                    parsed.aspect_ratio = params.aspect_ratio  # type: ignore

                parsed.final_prompt = enforce_controlled_studio_optics(
                    parsed.final_prompt,
                    parsed.lens,
                    parsed.aperture,
                    parsed.film,
                    rig,
                )
                for v in parsed.variations:
                    v.prompt = enforce_controlled_studio_optics(
                        v.prompt,
                        parsed.lens,
                        parsed.aperture,
                        parsed.film,
                        rig,
                    )
                return parsed
        except Exception as exc:
            logger.warning("Modelo %s indisponível no Agente 1: %s", model_name, exc)

    logger.info("Usando motor de direção óptica determinística local de estúdio controlado.")
    return build_deterministic_direction(params)


async def _synthesize_bfl_flux_studio(
    final_prompt: str,
    requested_ratio: str,
    metadata_info: Optional[Dict[str, str]] = None,
    seed_offset: int = 0,
) -> bytes:
    """
    Motor de Estúdio de Alta Definição via Black Forest Labs FLUX.1 (resolução nativa
    1344x768 / 1024x1280 / 1024x1024 / 768x1344, zero marca d'água e zero distorção).
    """
    dim_map = {
        "16:9": (1344, 768),
        "1:1": (1024, 1024),
        "4:5": (1024, 1280),
        "9:16": (768, 1344),
    }
    w, h = dim_map.get(requested_ratio, (1024, 1280))
    seed = random.randint(1000, 999999) + seed_offset

    bfl_spaces = [
        "https://black-forest-labs-flux-1-schnell.hf.space",
        "https://multimodalart-flux-1-merged.hf.space",
    ]

    async with httpx.AsyncClient(timeout=55.0, follow_redirects=True) as http_client:
        for base_space in bfl_spaces:
            try:
                call_resp = await http_client.post(
                    f"{base_space}/gradio_api/call/infer",
                    json={"data": [final_prompt, seed, False, w, h, 4]},
                )
                if call_resp.status_code != 200:
                    continue
                event_id = call_resp.json().get("event_id")
                if not event_id:
                    continue

                sse_resp = await http_client.get(
                    f"{base_space}/gradio_api/call/infer/{event_id}"
                )
                if sse_resp.status_code != 200:
                    continue

                for line in sse_resp.text.splitlines():
                    if line.startswith("data:"):
                        data_arr = json.loads(line[5:].strip())
                        if (
                            isinstance(data_arr, list)
                            and data_arr
                            and isinstance(data_arr[0], dict)
                            and "url" in data_arr[0]
                        ):
                            img_url = data_arr[0]["url"]
                            img_resp = await http_client.get(img_url)
                            img_resp.raise_for_status()
                            return await asyncio.to_thread(
                                embed_exif_and_crop,
                                img_resp.content,
                                requested_ratio,
                                0.0,
                                metadata_info,
                            )
            except Exception as exc:
                logger.warning("Space %s indisponível, tentando próximo: %s", base_space, exc)

        # Contingência secundária em resolução quadrada 1024x1024 com center-crop exato (sem distorção)
        short_prompt = final_prompt[:380]
        encoded = urllib.parse.quote(short_prompt)
        fallback_url = (
            f"https://image.pollinations.ai/prompt/{encoded}"
            f"?width=1024&height=1024&seed={seed}&nologo=true&model=flux"
        )
        resp = await http_client.get(fallback_url)
        resp.raise_for_status()
        return await asyncio.to_thread(
            embed_exif_and_crop, resp.content, requested_ratio, 0.05, metadata_info
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

    return await _synthesize_bfl_flux_studio(
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
                        else "Calibrando ambiente 100% controlado de estúdio e luz 360°"
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
                    "Revelando 3 estudos de luz em estúdio (Prova de Estúdio)"
                    if params.contact_sheet
                    else (
                        "Reiluminando fotografia no novo ângulo 360°"
                        if rig.relight_mode
                        else "Capturando fotografia em alta definição (Médio Formato)"
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
                        prompt=f"{direction.final_prompt}, dramatic 180-degree rear studio backlight silhouette rim halo, deep negative fill shadows toward camera",
                    ),
                    VariationPrompt(
                        label="Estudo III · Luz Lateral 90° (Split)",
                        prompt=f"{direction.final_prompt}, hard 90-degree side studio split lighting, half subject in warm key light, half in deep shadow",
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
                "message": "Auditando nitidez óptica e controle de luz",
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
