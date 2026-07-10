"""ORION Golden Report renderer — R10 deterministic PPTX/PDF from ReportSpec + deck manifest."""

from __future__ import annotations

import base64
import io
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import fitz
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Pt

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore

FONT = "Arial"
FS_TITLE = 26
FS_SECTION = 22
FS_SUBTITLE = 13
FS_BODY = 12
FS_CAPTION = 9

MARGIN_X = 420000
CONTENT_W = 8300000
SLIDE_H = 6858000
FOOTER_Y = 6420000
CONTENT_BOTTOM = 6200000

# CEO demo 16:10 (12×7.5 in)
CEO_SLIDE_W = 10972800
CEO_SLIDE_H = 6858000
CEO_MARGIN_X = 500000
CEO_CONTENT_W = CEO_SLIDE_W - CEO_MARGIN_X * 2
CEO_FOOTER_Y = CEO_SLIDE_H - 450000
CEO_CONTENT_BOTTOM = CEO_SLIDE_H - 650000

NAVY = RGBColor(0x0B, 0x1A, 0x33)
TITLE_COLOR = RGBColor(0xF8, 0xFA, 0xFC)
BODY_COLOR = RGBColor(0x33, 0x41, 0x55)
MUTED_COLOR = RGBColor(0x64, 0x74, 0x8B)
ACCENT = RGBColor(0x3B, 0x82, 0xF6)
CARD_BG = RGBColor(0xF8, 0xFA, 0xFC)
CARD_BORDER = RGBColor(0xE2, 0xE8, 0xF0)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

FORBIDDEN = re.compile(
    r"(storage/|C:\\\\|openai[_-]?api[_-]?key|cmr[a-z0-9]{10,}|adverse_media|requires_review)",
    re.I,
)


def _safe(text: object) -> str:
    val = re.sub(r"\s+", " ", str(text or "")).strip()
    val = FORBIDDEN.sub("", val)
    # Humanize residual enum-like tokens that may appear in summaries
    val = re.sub(r"\bWRONG[_\s-]?SUBJECT\b", "другой субъект", val, flags=re.I)
    val = re.sub(r"\bPENDING\b", "требует проверки", val, flags=re.I)
    val = re.sub(r"\bGPT\b", "модельный анализ", val)
    return val.strip()


def _clip_words(text: str, max_chars: int) -> str:
    """Clip on sentence/word boundary without forcing an ellipsis mid-thought."""
    val = _safe(text)
    if len(val) <= max_chars:
        return val
    slice_ = val[:max_chars]
    punct = max(slice_.rfind(". "), slice_.rfind("! "), slice_.rfind("? "))
    if punct > max_chars * 0.55:
        return slice_[: punct + 1].rstrip()
    sp = max(slice_.rfind(" "), slice_.rfind("\u00a0"))
    if sp > max_chars * 0.45:
        return slice_[:sp].rstrip()
    soft = re.sub(r"[^\s]{1,12}$", "", slice_).rstrip()
    if len(soft) > max_chars * 0.4:
        return soft
    return slice_.rstrip()


class _Ctx:
    def __init__(
        self,
        prs: Presentation,
        page: int,
        total: int,
        *,
        ceo_mode: bool = False,
        slide_meta: dict[str, Any] | None = None,
    ):
        self.prs = prs
        self.page = page
        self.total = total
        self.ceo_mode = ceo_mode
        self.slide_meta = slide_meta or {}
        self.margin_x = CEO_MARGIN_X if ceo_mode else MARGIN_X
        self.content_w = CEO_CONTENT_W if ceo_mode else CONTENT_W
        self.footer_y = CEO_FOOTER_Y if ceo_mode else FOOTER_Y
        self.content_bottom = CEO_CONTENT_BOTTOM if ceo_mode else CONTENT_BOTTOM
        layout = prs.slide_layouts[6] if len(prs.slide_layouts) > 6 else prs.slide_layouts[0]
        self.slide = prs.slides.add_slide(layout)

    def footer(self) -> None:
        box = self.slide.shapes.add_textbox(
            Emu(self.margin_x), Emu(self.footer_y), Emu(self.content_w), Emu(250000)
        )
        tf = box.text_frame
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.RIGHT
        r = p.add_run()
        meta = self.slide_meta if isinstance(self.slide_meta, dict) else {}
        if self.ceo_mode:
            date_label = _safe(meta.get("reportDateLabel") or "")
            r.text = f"{date_label} · {self.page} / {self.total}" if date_label else f"{self.page} / {self.total}"
        else:
            r.text = f"{self.page} / {self.total}"
        r.font.name = FONT
        r.font.size = Pt(FS_CAPTION)
        r.font.color.rgb = MUTED_COLOR

    def dark_bg(self) -> None:
        fill = self.slide.background.fill
        fill.solid()
        fill.fore_color.rgb = NAVY

    def light_bg(self) -> None:
        fill = self.slide.background.fill
        fill.solid()
        fill.fore_color.rgb = WHITE

    def title(self, text: str, y: int = 280000, color: RGBColor = TITLE_COLOR, size: int = FS_TITLE) -> int:
        box = self.slide.shapes.add_textbox(Emu(self.margin_x), Emu(y), Emu(self.content_w), Emu(900000))
        tf = box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        r = p.add_run()
        r.text = _safe(text)
        r.font.name = FONT
        r.font.bold = True
        r.font.size = Pt(size)
        r.font.color.rgb = color
        return y + 950000

    def body(self, text: str, y: int, max_h: int = 900000, color: RGBColor = BODY_COLOR) -> int:
        # Cap height so body never collides with footer
        avail = max(200000, min(max_h, self.content_bottom - y))
        box = self.slide.shapes.add_textbox(Emu(self.margin_x), Emu(y), Emu(self.content_w), Emu(avail))
        tf = box.text_frame
        tf.word_wrap = True
        # Split long narrative into short paragraphs for readability
        chunks = [c.strip() for c in re.split(r"\n+", _safe(text)) if c.strip()]
        if not chunks:
            chunks = [""]
        first = True
        used_chars = 0
        for chunk in chunks[:6]:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.space_after = Pt(8)
            r = p.add_run()
            clipped = _clip_words(chunk, 900)
            r.text = clipped
            used_chars += len(clipped)
            r.font.name = FONT
            r.font.size = Pt(FS_BODY)
            r.font.color.rgb = color
        # Estimate consumed height (~18pt line) instead of returning full avail
        est_lines = max(2, min(14, used_chars // 90 + len(chunks)))
        used_h = min(avail, est_lines * 230000 + 120000)
        return y + used_h

    def bullets(self, items: list[str], y: int, color: RGBColor = BODY_COLOR, max_items: int = 8, max_chars: int = 280) -> int:
        avail = max(400000, self.content_bottom - y)
        box = self.slide.shapes.add_textbox(Emu(self.margin_x), Emu(y), Emu(self.content_w), Emu(avail))
        tf = box.text_frame
        tf.word_wrap = True
        first = True
        for bullet in items[:max_items]:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            # R10.9a — explicit spacing prevents overlapping bullet lines
            p.space_before = Pt(4)
            p.space_after = Pt(10)
            p.line_spacing = 1.15
            r = p.add_run()
            clipped = _clip_words(bullet, max_chars)
            r.text = f"• {clipped}"
            r.font.name = FONT
            r.font.size = Pt(FS_BODY)
            r.font.color.rgb = color
        return y + avail

    def card(self, y: int, h: int = 4200000) -> None:
        avail = max(300000, min(h, self.content_bottom - y))
        shape = self.slide.shapes.add_shape(
            1, Emu(self.margin_x), Emu(y), Emu(self.content_w), Emu(avail)
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = CARD_BG
        shape.line.color.rgb = CARD_BORDER


def _asset_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(a.get("assetRef")): a for a in payload.get("assets") or []}


def _image_bytes_as_pptx_png(raw: bytes, asset_ref: object) -> Path | None:
    """Write image bytes to a temp PNG path python-pptx can embed (WEBP → PNG via PIL)."""
    safe_ref = re.sub(r"[^\w.-]+", "_", str(asset_ref or "img"))[:80]
    out_path = Path(tempfile.gettempdir()) / f"orion-golden-{safe_ref}.png"
    if Image is not None:
        try:
            with Image.open(io.BytesIO(raw)) as im:
                # WEBP/GIF/etc → RGB PNG for python-pptx
                if im.mode in ("RGBA", "LA", "P"):
                    im = im.convert("RGBA")
                else:
                    im = im.convert("RGB")
                im.save(out_path, format="PNG")
                return out_path
        except Exception:  # noqa: BLE001
            pass
    # Fallback: assume already PNG/JPEG-compatible bytes
    try:
        out_path.write_bytes(raw)
        return out_path
    except OSError:
        return None


def _embed_image(ctx: _Ctx, asset: dict[str, Any] | None, y: int, h: int = 4800000) -> None:
    if not asset:
        ctx.body("Визуальный материал недоступен для данного раздела.", y)
        return
    img_data = asset.get("imageData")
    if img_data:
        raw = base64.b64decode(str(img_data))
        img_path = _image_bytes_as_pptx_png(raw, asset.get("assetRef"))
        if img_path is not None:
            try:
                ctx.slide.shapes.add_picture(
                    str(img_path), Emu(ctx.margin_x), Emu(y), width=Emu(ctx.content_w), height=Emu(h)
                )
                return
            except Exception:  # noqa: BLE001
                pass
            finally:
                try:
                    img_path.unlink(missing_ok=True)
                except OSError:
                    pass
        ctx.body("Изображение недоступно (неподдерживаемый формат).", y)
        return
    title = _safe(asset.get("title") or "Источник")
    domain = _safe(asset.get("caption") or "")
    ctx.card(y, h)
    ctx.body(f"{title}\n{domain}\nИзображение недоступно — показаны источник и описание.", y + 120000, max_h=h - 200000)


def _ceo_metric_cards(ctx: _Ctx, bullets: list[str], y: int, cols: int = 2) -> int:
    """Render KPI/dashboard rows as a card grid (CEO recovery — not bullet list)."""
    items = [b for b in bullets if b.strip()]
    if not items:
        return y
    gap = 140000
    card_w = (ctx.content_w - gap * (cols - 1)) // cols
    card_h = 1100000
    for idx, text in enumerate(items[:8]):
        row = idx // cols
        col = idx % cols
        cx = ctx.margin_x + col * (card_w + gap)
        cy = y + row * (card_h + gap)
        shape = ctx.slide.shapes.add_shape(1, Emu(cx), Emu(cy), Emu(card_w), Emu(card_h))
        shape.fill.solid()
        shape.fill.fore_color.rgb = CARD_BG
        shape.line.color.rgb = CARD_BORDER
        tf = shape.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = _clip_words(text, 120)
        r.font.name = FONT
        r.font.size = Pt(11)
        r.font.color.rgb = BODY_COLOR
    rows_used = (min(len(items), 8) + cols - 1) // cols
    return y + rows_used * (card_h + gap) + 80000


def _ceo_matrix_table(ctx: _Ctx, bullets: list[str], y: int) -> int:
    """Pipe-delimited matrix rows → monospace table layout."""
    rows = [b for b in bullets if "|" in b]
    if not rows:
        ctx.bullets(bullets, y, max_items=10, max_chars=160)
        return y + 2000000
    avail = max(500000, ctx.content_bottom - y)
    box = ctx.slide.shapes.add_textbox(Emu(ctx.margin_x), Emu(y), Emu(ctx.content_w), Emu(avail))
    tf = box.text_frame
    tf.word_wrap = False
    first = True
    for row in rows[:20]:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.space_before = Pt(1)
        p.space_after = Pt(2)
        p.line_spacing = 1.0
        r = p.add_run()
        clipped = _clip_words(row, 200)
        r.text = clipped
        r.font.name = "Courier New"
        r.font.size = Pt(9)
        if "Нежелательный" in clipped:
            r.font.color.rgb = RGBColor(0xB9, 0x1C, 0x1C)
        elif clipped.startswith("Запрос"):
            r.font.bold = True
            r.font.color.rgb = NAVY
        else:
            r.font.color.rgb = BODY_COLOR
    return y + avail


def _ceo_suggestion_list(ctx: _Ctx, bullets: list[str], y: int) -> int:
    """Autocomplete / related queries as numbered chips."""
    items = [b for b in bullets if b.strip()]
    if not items:
        return y
    avail = max(400000, ctx.content_bottom - y)
    box = ctx.slide.shapes.add_textbox(Emu(ctx.margin_x), Emu(y), Emu(ctx.content_w), Emu(avail))
    tf = box.text_frame
    tf.word_wrap = True
    first = True
    for idx, item in enumerate(items[:12], start=1):
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.space_before = Pt(3)
        p.space_after = Pt(6)
        r = p.add_run()
        r.text = f"{idx}. {_clip_words(item, 100)}"
        r.font.name = FONT
        r.font.size = Pt(12)
        r.font.color.rgb = BODY_COLOR
    return y + avail


def _render_slide(ctx: _Ctx, slide: dict[str, Any], assets: dict[str, dict[str, Any]]) -> None:
    template = str(slide.get("template") or "")
    title = _safe(slide.get("title") or "ORION")[:70]
    narrative = _safe(slide.get("narrative") or "")[:420]
    bullets = [_safe(b)[:130] for b in slide.get("bullets") or [] if _safe(b)]
    refs = slide.get("assetRefs") or []
    primary = assets.get(str(refs[0])) if refs else None

    if template == "ceo_executive_dashboard":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        y = _ceo_metric_cards(ctx, bullets, y, cols=2)
        return

    if template == "ceo_kpi_cards":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        y = _ceo_metric_cards(ctx, bullets, y, cols=2)
        return

    if template == "ceo_serp_matrix":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        if narrative:
            y = ctx.body(_clip_words(narrative, 200), y, max_h=400000, color=MUTED_COLOR)
            y = y + 40000
        _ceo_matrix_table(ctx, bullets, y)
        return

    if template == "ceo_autocomplete":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        _ceo_suggestion_list(ctx, bullets, y)
        return

    if template == "ceo_status_table":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        ctx.card(y, h=min(3200000, ctx.content_bottom - y - 80000))
        ctx.bullets(bullets[:5], y + 100000, max_items=5, max_chars=130)
        return

    if template == "ceo_compliance_profile":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY)
        if primary and primary.get("imageData"):
            _embed_image(ctx, primary, y + 60000, h=min(5000000, ctx.content_bottom - y - 120000))
        else:
            ctx.card(y + 60000, h=min(3600000, ctx.content_bottom - y - 120000))
            ctx.bullets(bullets[:5], y + 160000, max_items=5, max_chars=130)
        return

    ceo_aliases = {
        "ceo_cover": "orion_golden_cover",
        "ceo_toc": "orion_golden_toc",
        "ceo_executive": "orion_golden_executive_card",
        "ceo_region_divider": "orion_golden_region_divider",
        "ceo_serp_evidence": "orion_golden_serp_screenshot",
        "ceo_media_grid": "orion_golden_image_grid",
        "ceo_knowledge_panel": "orion_golden_lexis_visual_page",
    }
    if template in ceo_aliases:
        template = ceo_aliases[template]
        slide = {**slide, "template": template, "title": title, "narrative": narrative, "bullets": bullets}

    if template == "orion_golden_cover":
        ctx.dark_bg()
        y = ctx.title("ORION Digital Profile", 1800000, WHITE, 34)
        ctx.body(narrative or title, y, max_h=700000, color=RGBColor(0xBF, 0xDB, 0xFE))
        ctx.body("Клиентский аудит · предварительная оценка", y + 900000, max_h=400000, color=MUTED_COLOR)
        return

    if template == "orion_golden_toc":
        ctx.dark_bg()
        y = ctx.title("Содержание отчёта", 400000, WHITE, FS_SECTION)
        ctx.bullets(
            bullets or ["Резюме", "Россия", "ОАЭ", "Compliance", "LexisNexis", "Рекомендации"],
            y,
            color=WHITE,
            max_items=14,
        )
        return

    if template == "orion_golden_executive_card":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        # Narrative-only slide (part 1) vs themes slide: give narrative more vertical room.
        narr = narrative.strip()
        if narr and not bullets:
            card_h = min(5200000, max(1600000, ctx.content_bottom - y - 200000))
            ctx.card(y, h=card_h)
            # Do not hard-clip the full résumé; body splits paragraphs itself.
            ctx.body(narr, y + 100000, max_h=card_h - 160000)
            return
        if narr:
            narr_show = _clip_words(narr, 420 if ctx.ceo_mode else 2200)
            card_h = min(2800000, max(800000, len(narr_show) * 1600 + 200000))
            max_card = max(800000, ctx.content_bottom - y - (1100000 if bullets else 200000))
            card_h = min(card_h, max_card)
            ctx.card(y, h=card_h)
            y = ctx.body(narr_show, y + 100000, max_h=card_h - 160000)
            y = y + 140000
        if bullets:
            ctx.bullets(bullets, y, max_items=5 if ctx.ceo_mode else 7, max_chars=130 if ctx.ceo_mode else 280)
        return

    if template == "orion_golden_risk_matrix":
        ctx.light_bg()
        y = ctx.title(title or "Матрица рисков", 280000, NAVY, FS_SECTION)
        ctx.body(
            "Уровни риска показаны в клиентских формулировках. Материалы «Требует проверки» не являются подтверждённым риском.",
            y,
            max_h=520000,
            color=MUTED_COLOR,
        )
        y = y + 560000
        ctx.card(y, h=ctx.content_bottom - y - 80000)
        ctx.bullets(bullets or ["Существенных подтверждённых тем риска не выявлено."], y + 100000, max_items=10 if ctx.ceo_mode else 8)
        return

    if template == "orion_golden_region_divider":
        ctx.dark_bg()
        ctx.title(title, 2800000, WHITE, 34)
        return

    if template == "orion_golden_serp_screenshot":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY)
        _embed_image(ctx, primary, y + 60000, h=5000000)
        return

    if template == "orion_golden_image_grid":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY)
        cols = 3
        cell_w = 2600000
        cell_h = 1500000
        gap = 120000
        for idx, ref in enumerate(refs[:6]):
            row = idx // cols
            col = idx % cols
            cx = ctx.margin_x + col * (cell_w + gap)
            cy = y + row * (cell_h + gap)
            asset = assets.get(str(ref))
            if asset and asset.get("imageData"):
                img_path = _image_bytes_as_pptx_png(
                    base64.b64decode(str(asset.get("imageData"))), f"grid-{ref}"
                )
                if img_path is not None:
                    try:
                        ctx.slide.shapes.add_picture(
                            str(img_path), Emu(cx), Emu(cy), width=Emu(cell_w), height=Emu(cell_h)
                        )
                        continue
                    except Exception:  # noqa: BLE001
                        pass
                    finally:
                        try:
                            img_path.unlink(missing_ok=True)
                        except OSError:
                            pass
                shape = ctx.slide.shapes.add_shape(1, Emu(cx), Emu(cy), Emu(cell_w), Emu(cell_h))
                shape.fill.solid()
                shape.fill.fore_color.rgb = CARD_BG
                shape.line.color.rgb = CARD_BORDER
                tf = shape.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                r = p.add_run()
                r.text = "Недоступно"
                r.font.size = Pt(FS_CAPTION)
            else:
                shape = ctx.slide.shapes.add_shape(1, Emu(cx), Emu(cy), Emu(cell_w), Emu(cell_h))
                shape.fill.solid()
                shape.fill.fore_color.rgb = CARD_BG
                shape.line.color.rgb = CARD_BORDER
                tf = shape.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                r = p.add_run()
                r.text = _safe((asset or {}).get("title") or "Недоступно")
                r.font.size = Pt(FS_CAPTION)
        return

    if template == "orion_golden_video_cards":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY)
        ctx.bullets(bullets or [_safe((primary or {}).get("title"))], y)
        return

    if template == "orion_golden_lexis_visual_page":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY)
        _embed_image(ctx, primary, y + 60000, h=5000000)
        return

    if template == "orion_golden_search_table":
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        if narrative:
            y = ctx.body(_clip_words(narrative, 320), y, max_h=520000, color=MUTED_COLOR)
            y = y + 60000
        # Dense SERP / suggestion / heat-grid rows
        avail = max(400000, ctx.content_bottom - y)
        box = ctx.slide.shapes.add_textbox(Emu(ctx.margin_x), Emu(y), Emu(ctx.content_w), Emu(avail))
        tf = box.text_frame
        tf.word_wrap = True
        first = True
        for bullet in bullets[: (10 if ctx.ceo_mode else 18)]:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.space_before = Pt(2)
            p.space_after = Pt(5)
            p.line_spacing = 1.05
            r = p.add_run()
            clipped = _clip_words(bullet, 160)
            r.text = f"• {clipped}"
            r.font.name = FONT
            r.font.size = Pt(11)
            # Highlight adverse heat-grid rows
            if clipped.startswith("[Н]"):
                r.font.color.rgb = RGBColor(0xB9, 0x1C, 0x1C)
            else:
                r.font.color.rgb = BODY_COLOR
        return

    if template == "orion_golden_no_data_compact":
        ctx.light_bg()
        y = ctx.title(title, 320000, NAVY)
        ctx.body(narrative or "Для данного раздела недостаточно подтверждённых данных.", y)
        return

    if template == "orion_golden_audit_dashboard":
        # ORION regional résumé: themes left-ish via bullets top, KPI counters below.
        ctx.light_bg()
        y = ctx.title(title, 280000, NAVY, FS_SECTION)
        if narrative:
            y = ctx.body(_clip_words(narrative, 520), y, max_h=1000000)
            y = y + 80000
        if bullets:
            ctx.bullets(bullets, y, max_items=14, max_chars=220)
        return

    # default section summary / appendix
    ctx.light_bg()
    y = ctx.title(title, 280000, NAVY, FS_SECTION)
    # Prefer bullets for dense content; keep narrative short to avoid overlap
    short_narrative = _clip_words(narrative, 480) if narrative else ""
    if short_narrative and not bullets:
        ctx.body(short_narrative, y, max_h=ctx.content_bottom - y - 100000)
        return
    if short_narrative:
        y = ctx.body(short_narrative, y, max_h=900000)
        y = y + 80000
    if bullets:
        ctx.bullets(bullets, y, max_items=8)


def _write_pdf_fallback(slides: list[dict[str, Any]], pdf_path: Path, subject: str) -> None:
    doc = fitz.open()
    all_slides = [{"title": "ORION Digital Profile", "body": subject}] + slides
    total = len(all_slides)

    def esc(t: str) -> str:
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    for idx, slide in enumerate(all_slides, start=1):
        page = doc.new_page(width=1280, height=720)
        body = esc(_safe(slide.get("body") or slide.get("narrative") or ""))
        bullets = slide.get("bullets") or []
        bullet_html = "".join(f"<li>{esc(_safe(b))}</li>" for b in bullets[:8])
        html = (
            "<div style='font-family:Arial,sans-serif;color:#0b1a33;padding:8px;'>"
            f"<h1 style='font-size:22px;margin:0;'>{esc(_safe(slide.get('title')))}</h1>"
            f"<p style='margin-top:12px;font-size:12px;color:#334155;'>{body}</p>"
            f"<ul style='margin-top:12px;font-size:11px;color:#334155;'>{bullet_html}</ul>"
            f"<p style='position:absolute;bottom:16px;right:24px;color:#94a3b8;font-size:10px;'>{idx}/{total}</p>"
            "</div>"
        )
        page.insert_htmlbox(fitz.Rect(48, 40, 1232, 680), html)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(pdf_path))
    doc.close()


def _export_png_pages(pdf_path: Path) -> list[dict[str, Any]]:
    doc = fitz.open(str(pdf_path))
    pages: list[dict[str, Any]] = []
    try:
        for i in range(len(doc)):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(2, 2))
            pages.append(
                {
                    "pageNumber": i + 1,
                    "width": pix.width,
                    "height": pix.height,
                    "contentBase64": base64.b64encode(pix.tobytes("png")).decode("ascii"),
                }
            )
    finally:
        doc.close()
    return pages


def _is_ceo_demo_mode(payload: dict[str, Any]) -> bool:
    report_spec = payload.get("reportSpec") or {}
    qa = report_spec.get("qaMetadata") or {}
    if qa.get("ceoDemoMode"):
        return True
    deck = payload.get("deckManifest") or {}
    slides = deck.get("finalSlides") or []
    return bool(slides) and str(slides[0].get("template") or "").startswith("ceo_")


def render_orion_golden(payload: dict[str, Any]) -> dict[str, Any]:
    deck = payload.get("deckManifest") or {}
    report_spec = payload.get("reportSpec") or {}
    slides = list(deck.get("finalSlides") or [])
    if not slides:
        raise ValueError("deckManifest.finalSlides is empty")

    ceo_mode = _is_ceo_demo_mode(payload)
    assets = _asset_map(payload)
    subject = (report_spec.get("subject") or {}).get("displayName") or "Цифровой профиль"
    total = len(slides)
    prs = Presentation()
    if ceo_mode:
        prs.slide_width = Emu(CEO_SLIDE_W)
        prs.slide_height = Emu(CEO_SLIDE_H)
    else:
        prs.slide_width = Emu(9144000)
        prs.slide_height = Emu(SLIDE_H)

    for idx, slide in enumerate(slides, start=1):
        ceo_meta = slide.get("ceoMeta") if isinstance(slide.get("ceoMeta"), dict) else {}
        ctx = _Ctx(prs, idx, total, ceo_mode=ceo_mode, slide_meta=ceo_meta)
        _render_slide(ctx, slide, assets)
        ctx.footer()

    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix="orion-golden-") as tmp:
        tmp_path = Path(tmp)
        pptx_path = tmp_path / "report.pptx"
        prs.save(str(pptx_path))
        pdf_path = tmp_path / "report.pdf"
        pdf_ok = False
        pdf_mode = "fitz-fallback"
        try:
            from convert_pdf import convert_to_pdf

            convert_to_pdf(str(pptx_path), str(pdf_path))
            pdf_ok = pdf_path.exists() and pdf_path.stat().st_size > 0
            if pdf_ok:
                pdf_mode = "libreoffice"
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"libreoffice-failed:{exc}")

        if not pdf_ok:
            _write_pdf_fallback(slides, pdf_path, str(subject))
            pdf_mode = "fitz-fallback"

        pages = _export_png_pages(pdf_path)
        return {
            "slideCount": len(prs.slides),
            "pptxBase64": base64.b64encode(pptx_path.read_bytes()).decode("ascii"),
            "pdfBase64": base64.b64encode(pdf_path.read_bytes()).decode("ascii") if pdf_path.exists() else "",
            "pages": pages,
            "pdfExportMode": pdf_mode,
            "warnings": warnings,
        }


if __name__ == "__main__":
    import sys

    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = render_orion_golden(data)
    Path(sys.argv[2]).write_bytes(base64.b64decode(out["pptxBase64"]))
    if out.get("pdfBase64"):
        Path(sys.argv[3]).write_bytes(base64.b64decode(out["pdfBase64"]))
    pages_dir = Path(sys.argv[4])
    pages_dir.mkdir(parents=True, exist_ok=True)
    for page in out.get("pages") or []:
        Path(pages_dir / f"page-{page['pageNumber']:02d}.png").write_bytes(
            base64.b64decode(page["contentBase64"])
        )
    meta = {"slideCount": out["slideCount"], "pages": len(out.get("pages") or []), "pdfExportMode": out.get("pdfExportMode")}
    Path(pages_dir.parent / "golden-render-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(json.dumps(meta))
