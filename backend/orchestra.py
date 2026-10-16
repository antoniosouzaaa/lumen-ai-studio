import asyncio
import base64
import io
import json
import logging
import os
import random
import re
import urllib.parse
from typing import AsyncGenerator, Dict, Any, Literal, Optional

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel, Field

load_dotenv()

logger = logging.getLogger("lumen.orchestra")

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


class ProductionRequest(BaseModel):
    brief: str = Field(..., min_length=1, max_length=3000)
    lens: Optional[str] = None
    aperture: Optional[str] = None
    film: Optional[str] = None
    aspect_ratio: Optional[str] = None


class DirectorOutput(BaseModel):
    lens: Literal["24mm", "35mm", "50mm", "85mm"] = Field(
        default="35mm",
        description="Lente escolhida automaticamente pelo diretor a partir da descrição em linguagem natural: 24mm (ampla/ambiente), 35mm (natural/documental), 50mm (clássica/humana) ou 85mm (retrato/close-up).",
    )
    aperture: Literal["f/1.4", "f/2.8", "f/8"] = Field(
        default="f/1.4",
        description="Abertura escolhida automaticamente: f/1.4 (fundo bem desfocado/intimista), f/2.8 (equilíbrio sujeito e ambiente) ou f/8 (tudo em foco/paisagem).",
    )
    film: Literal["Kodak Portra 400", "CineStill 800T", "Neutro"] = Field(
        default="Kodak Portra 400",
        description="Estética cromática escolhida: Kodak Portra 400 (tons quentes e orgânicos), CineStill 800T (clima noturno/cinema/luzes urbanas) ou Neutro (limpo e fiel).",
    )
    aspect_ratio: Literal["16:9", "1:1", "4:5", "9:16"] = Field(
        default="4:5",
        description="Proporção escolhida conforme o pedido do usuário: 16:9 (horizontal/cinema/paisagem), 1:1 (quadrado), 4:5 (vertical clássico/retrato) ou 9:16 (vertical tela cheia/stories).",
    )
    camera_optics: str = Field(
        ...,
        description="Explicação fluida, natural e envolvente em português brasileiro contando como a luz, o enquadramento e o clima foram pensados para dar vida à ideia do usuário.",
    )
    final_prompt: str = Field(
        ...,
        description="Prompt fotográfico descritivo denso em inglês para síntese de imagem, focado em física da luz, óptica real, composição e textura, sem jargões artificiais de IA.",
    )


class QAOutput(BaseModel):
    score: float = Field(
        ...,
        ge=0.0,
        le=10.0,
        description="Nota de 0.0 a 10.0 avaliando a qualidade fotográfica da imagem.",
    )
    lighting: str = Field(
        ...,
        description="Avaliação em linguagem natural (português brasileiro) sobre a iluminação, atmosfera e sombras da foto gerada.",
    )
    lens_coherence: str = Field(
        ...,
        description="Avaliação em linguagem natural (português brasileiro) sobre o enquadramento, foco e sensação de profundidade.",
    )
    notes: str = Field(
        ...,
        description="Observações claras em português brasileiro sobre a naturalidade, texturas e acabamento da fotografia.",
    )


DIRECTOR_SYSTEM_PROMPT = """Você é o Diretor de Fotografia do estúdio LUMEN: AI PHOTOGRAPHY STUDIO.
O usuário descreve a imagem desejada em LINGUAGEM NATURAL, sem precisar saber termos técnicos de câmera.
Sua missão é interpretar o desejo humano do usuário, decidir automaticamente o melhor conjunto óptico e transformar a ideia em uma fotografia memorável.

REGRAS ESTRITAS E INEGOCIÁVEIS:
1. Interprete a descrição em linguagem natural e decida automaticamente:
   - `lens`: "24mm" (cenas amplas, arquitetura, paisagens), "35mm" (cenas cotidianas, narrativas, meio-corpo), "50mm" (perspectiva humana natural), ou "85mm" (retratos próximos, rostos, detalhes intimistas).
   - `aperture`: "f/1.4" (quando o usuário pede fundo desfocado, retrato intimista ou destaque no sujeito), "f/2.8" (profundidade moderada), ou "f/8" (quando todo o cenário precisa estar nítido).
   - `film`: "Kodak Portra 400" (luz natural, pele humana, tons quentes, nostalgia, sol), "CineStill 800T" (noite, chuva, neon, bares, luzes artificiais de cinema), ou "Neutro" (estúdio moderno, produto, cores puras).
   - `aspect_ratio`: "16:9" (se pedir horizontal, paisagem, tela larga ou cinema), "1:1" (se pedir quadrado), "9:16" (se pedir tela vertical inteira/celular), ou "4:5" (padrão ideal para retratos e fotografia editorial).
2. No campo `camera_optics`, escreva em PORTUGUÊS BRASILEIRO de forma natural, clara e elegante (sem excesso de jargão frio), explicando como você traduziu a ideia do usuário em luz, atmosfera e enquadramento.
3. No campo `final_prompt` (em INGLÊS), descreva a física da luz real (ex: soft diffused window light, golden hour rim light, warm tungsten practical lamps), comportamento óptico da lente e textura orgânica.
4. PROIBIDO usar palavras vazias de IA no `final_prompt`, tais como: "8k", "4k", "photorealistic", "ultra-detailed", "hyperrealistic", "masterpiece", "unreal engine", "trending on artstation", "octane render", "best quality"."""


QA_SYSTEM_PROMPT = """Você é o Curador e Auditor Visual do LUMEN: AI PHOTOGRAPHY STUDIO.
Analise a fotografia gerada em relação ao que o usuário pediu em linguagem natural.

Escreva em PORTUGUÊS BRASILEIRO com linguagem clara, natural e acessível:
1. `lighting`: como a luz e o clima se comportam na imagem (sombras, brilho, atmosfera).
2. `lens_coherence`: como ficou o enquadramento, a perspectiva e o desfoque de fundo.
3. `notes`: percepção geral sobre texturas, naturalidade e expressão da cena.
4. `score`: nota de 0.0 a 10.0."""


def sanitize_prompt(prompt: str) -> str:
    cleaned = prompt
    for pattern in FORBIDDEN_BUZZWORDS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    return cleaned.strip(" ,")


def crop_to_aspect_ratio(
    image_bytes: bytes, aspect_ratio: str, trim_border_pct: float = 0.0
) -> bytes:
    """Realiza corte central exato (center crop) para a proporção solicitada e salva em JPEG quality=95."""
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
        output_buffer = io.BytesIO()
        cropped.save(output_buffer, format="JPEG", quality=95, optimize=True)
        return output_buffer.getvalue()


def center_crop_4_5(image_bytes: bytes) -> bytes:
    """Mantido por compatibilidade estrita com o contrato de corte 4:5 em Pillow."""
    return crop_to_aspect_ratio(image_bytes, "4:5", trim_border_pct=0.0)


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
    extra_hints = []
    if params.lens:
        extra_hints.append(f"Lente preferida: {params.lens}")
    if params.aperture:
        extra_hints.append(f"Abertura preferida: {params.aperture}")
    if params.film:
        extra_hints.append(f"Filme preferido: {params.film}")
    if params.aspect_ratio:
        extra_hints.append(f"Proporção preferida: {params.aspect_ratio}")

    hints_str = "\n".join(extra_hints)
    user_content = f"Pedido do usuário em linguagem natural:\n\"{params.brief.strip()}\""
    if hints_str:
        user_content += f"\n\nPreferências opcionais informadas:\n{hints_str}"

    config = types.GenerateContentConfig(
        system_instruction=DIRECTOR_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=DirectorOutput,
        temperature=0.45,
    )

    models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash"]
    last_error = None

    for model_name in models_to_try:
        try:
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=user_content,
                config=config,
            )
            if response and response.text:
                parsed = DirectorOutput.model_validate_json(response.text)
                parsed.final_prompt = sanitize_prompt(parsed.final_prompt)
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
            logger.warning("Falha no Agente 1 com modelo %s: %s", model_name, exc)
            last_error = exc

    raise RuntimeError(
        f"Não foi possível elaborar a direção fotográfica no momento ({last_error})."
    )


async def _synthesize_fallback_photograph(
    final_prompt: str, requested_ratio: str
) -> bytes:
    """
    Motor de contingência fotográfica de alta definição caso a chave Google AI
    esteja no plano gratuito sem faturamento habilitado para o endpoint Imagen 3.
    """
    dim_map = {
        "16:9": (1280, 768),
        "1:1": (1024, 1024),
        "4:5": (1024, 1280),
        "9:16": (768, 1280),
    }
    w, h = dim_map.get(requested_ratio, (1024, 1280))
    seed = random.randint(1000, 999999)
    encoded_prompt = urllib.parse.quote(
        f"Fine art editorial photography, {final_prompt}, authentic optical lens, natural lighting, no text, no watermark"
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
        crop_to_aspect_ratio, raw_bytes, requested_ratio, 0.06
    )


async def run_imaging_agent(
    client: genai.Client, final_prompt: str, requested_ratio: str
) -> bytes:
    api_aspect_ratio = "3:4" if requested_ratio == "4:5" else requested_ratio

    config = types.GenerateImagesConfig(
        number_of_images=1,
        aspect_ratio=api_aspect_ratio,
        person_generation="ALLOW_ADULT",
        output_mime_type="image/jpeg",
    )

    image_bytes = None
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()

    # 1. Tentativa via SDK google-genai (Vertex AI Express ou padrão)
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
            if requested_ratio == "4:5":
                image_bytes = await asyncio.to_thread(center_crop_4_5, image_bytes)
            return image_bytes
        except PermissionError:
            raise
        except Exception as exc:
            logger.info("Imagen 3 SDK indisponível para esta chave, tentando alternativa: %s", exc)

    # 2. Tentativa via Gemini Image Generation (generate_content multimodal)
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
                            crop_to_aspect_ratio, raw_bytes, requested_ratio, 0.0
                        )
        except Exception as exc:
            logger.info("Modelo %s indisponível na cota atual: %s", fallback_model, exc)

    # 3. Fallback fotográfico contínuo (garante funcionamento mesmo em chaves Free Tier sem billing)
    logger.info("Acionando motor fotográfico contínuo para garantir entrega da imagem.")
    return await _synthesize_fallback_photograph(final_prompt, requested_ratio)


async def run_qa_agent(
    client: genai.Client,
    image_bytes: bytes,
    brief: str,
    direction: DirectorOutput,
) -> QAOutput:
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
    prompt_text = (
        f"Pedido original do usuário: {brief.strip()}\n"
        f"Configuração óptica decidida pela direção: {direction.lens} · {direction.aperture} · {direction.film} · {direction.aspect_ratio}\n"
        f"Intenção da direção: {direction.camera_optics}\n\n"
        "Realize a avaliação visual da fotografia gerada em linguagem clara e natural."
    )

    config = types.GenerateContentConfig(
        system_instruction=QA_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=QAOutput,
        temperature=0.25,
    )

    models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash"]
    last_error = None

    for model_name in models_to_try:
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=model_name,
                    contents=[image_part, prompt_text],
                    config=config,
                ),
                timeout=25.0,
            )
            if response and response.text:
                qa_result = QAOutput.model_validate_json(response.text)
                qa_result.score = round(float(qa_result.score), 1)
                return qa_result
        except Exception as exc:
            logger.warning("Falha no Agente 3 (QA) com modelo %s: %s", model_name, exc)
            last_error = exc

    raise RuntimeError(f"Auditoria indisponível ({last_error})")


def format_ndjson(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def execute_production_stream(
    params: ProductionRequest,
) -> AsyncGenerator[str, None]:
    try:
        client = get_genai_client()

        # Etapa 1: Diretor de Fotografia & Prompt Crafter
        yield format_ndjson(
            {
                "event": "step",
                "step": "direction",
                "message": "Preparando direção fotográfica",
            }
        )

        direction = await run_director_agent(client, params)

        # Etapa 2: Motor Gráfico
        yield format_ndjson(
            {
                "event": "step",
                "step": "imaging",
                "message": "Gerando imagem",
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

        image_bytes = await run_imaging_agent(
            client, direction.final_prompt, direction.aspect_ratio
        )

        # Etapa 3: Auditor de QA Visual Multimodal (Resiliente e Independente)
        yield format_ndjson(
            {
                "event": "step",
                "step": "qa",
                "message": "Analisando resultado",
            }
        )

        qa_available = True
        try:
            qa_result = await run_qa_agent(
                client, image_bytes, params.brief, direction
            )
            qa_payload = {
                "score": qa_result.score,
                "lighting": qa_result.lighting,
                "lens_coherence": qa_result.lens_coherence,
                "notes": qa_result.notes,
            }
        except Exception as qa_exc:
            logger.warning("Auditoria visual indisponível, mantendo imagem: %s", qa_exc)
            qa_available = False
            qa_payload = {
                "score": None,
                "lighting": "Auditoria indisponível",
                "lens_coherence": "Auditoria indisponível",
                "notes": "Auditoria indisponível",
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
