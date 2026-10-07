#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/build_reviews.py — генератор статичного блока отзывов из static/data/reviews.json.

Задача 045 (Этап 5 SEO).
Единый источник данных — static/data/reviews.json.
Скрипт генерирует:
1. Статичные HTML-карточки отзывов между маркерами reviews:begin / reviews:end в index.html.
2. Блоки aggregateRating и review в микроразметке JSON-LD Schema.org в <head> index.html.

Режимы:
  python tools/build_reviews.py          — обновить index.html
  python tools/build_reviews.py --check  — проверить синхронность (код 0 если всё совпадает, 1 при расхождении)
"""

import sys
import os
import json
import re
import html
from pathlib import Path

# Принудительный UTF-8 вывод на Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
REVIEWS_PATH = ROOT_DIR / "static" / "data" / "reviews.json"
INDEX_PATH = ROOT_DIR / "index.html"

BEGIN_MARKER = "<!-- reviews:begin (генерируется tools/build_reviews.py из static/data/reviews.json) -->"
END_MARKER = "<!-- reviews:end -->"

RE_GRID = re.compile(
    rf"({re.escape(BEGIN_MARKER)})(.*?)({re.escape(END_MARKER)})",
    re.DOTALL
)

RE_SCHEMA = re.compile(
    r'([ \t]*"aggregateRating":\s*\{\s*\n'
    r'[ \t]*"@type":\s*"AggregateRating",\s*\n'
    r'.*?'
    r'\n[ \t]*\]\s*\n'
    r')(?=[ \t]*\},?\s*\n[ \t]*\{[ \t]*\n[ \t]*"@type":\s*"FAQPage")',
    re.DOTALL
)


def load_reviews():
    if not REVIEWS_PATH.exists():
        print(f"[ОШИБКА] Файл с отзывами не найден: {REVIEWS_PATH}", file=sys.stderr)
        sys.exit(1)
    try:
        data = json.loads(REVIEWS_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ОШИБКА] Не удалось прочитать reviews.json: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, list) or len(data) == 0:
        print("[ОШИБКА] reviews.json пуст или не является списком", file=sys.stderr)
        sys.exit(1)

    return data


def clean_schema_text(text: str) -> str:
    """Удаляет эмодзи и замыкающие точки для чистого тела отзыва в schema.org reviewBody."""
    t = re.sub(r"[\U00010000-\U0010ffff\u2600-\u27bf\ufe0f]", "", text)
    return t.strip().rstrip(". ")


def build_cards_html(reviews):
    cards = []
    for idx, item in enumerate(reviews, 1):
        author_raw = str(item.get("author") or "Заказчик VoltGroup").strip()
        author_esc = html.escape(author_raw)
        
        avatar_raw = str(item.get("avatar") or (author_raw[:1] if author_raw else "В")).strip()
        avatar_esc = html.escape(avatar_raw)
        
        service_raw = str(item.get("service") or "Электромонтажные работы").strip()
        service_esc = html.escape(service_raw)
        
        is_ya = item.get("source") in ("yandex", "ya")
        badge_cls = "review-badge ya" if is_ya else "review-badge vk"
        source_label_default = "Яндекс.Карты" if is_ya else "ВКонтакте"
        badge_label = html.escape(str(item.get("sourceLabel") or source_label_default).strip())
        
        try:
            rating_val = int(item.get("rating", 5))
        except (ValueError, TypeError):
            rating_val = 5
        rating_val = max(1, min(5, rating_val))
        stars_str = "★" * rating_val
        
        text_raw = str(item.get("text") or "").strip()
        text_esc = html.escape(text_raw)
        
        status_raw = str(item.get("status") or "Проверенный заказчик").strip()
        status_esc = html.escape(status_raw)
        
        card_html = (
            f"                    <!-- Отзыв {idx}: {author_esc} -->\n"
            f"                    <article class=\"review-card fade-in\">\n"
            f"                        <div>\n"
            f"                            <div class=\"review-card-header\">\n"
            f"                                <div class=\"review-author-wrap\">\n"
            f"                                    <div class=\"review-avatar-char\" aria-hidden=\"true\">{avatar_esc}</div>\n"
            f"                                    <div>\n"
            f"                                        <div class=\"review-author-name\">{author_esc}</div>\n"
            f"                                        <div class=\"review-object-type\">{service_esc}</div>\n"
            f"                                    </div>\n"
            f"                                </div>\n"
            f"                                <span class=\"{badge_cls}\">{badge_label}</span>\n"
            f"                            </div>\n"
            f"                            <div class=\"review-stars\" aria-label=\"Оценка: {rating_val} из 5\">{stars_str}</div>\n"
            f"                            <p class=\"review-text\">\n"
            f"                                {text_esc}\n"
            f"                            </p>\n"
            f"                        </div>\n"
            f"                        <div class=\"review-footer\">\n"
            f"                            <span>{status_esc}</span>\n"
            f"                            <span>Оценка {float(rating_val):.1f}</span>\n"
            f"                        </div>\n"
            f"                    </article>"
        )
        cards.append(card_html)
        
    return "\n\n".join(cards)


def build_schema_block(reviews):
    count = len(reviews)
    ratings = []
    for r in reviews:
        try:
            ratings.append(float(r.get("rating", 5)))
        except (ValueError, TypeError):
            ratings.append(5.0)
    avg = sum(ratings) / len(ratings) if ratings else 5.0
    avg_str = f"{avg:.1f}"
    
    lines = [
        '          "aggregateRating": {',
        '            "@type": "AggregateRating",',
        f'            "ratingValue": "{avg_str}",',
        f'            "reviewCount": "{count}",',
        '            "bestRating": "5",',
        '            "worstRating": "1"',
        '          },',
        '          "review": ['
    ]
    
    review_entries = []
    for r in reviews:
        author_name = json.dumps(str(r.get("author") or "Заказчик VoltGroup").strip(), ensure_ascii=False)
        try:
            r_val = str(int(r.get("rating", 5)))
        except (ValueError, TypeError):
            r_val = "5"
        rating_json = json.dumps(r_val, ensure_ascii=False)
        body_text = clean_schema_text(str(r.get("text") or ""))
        body_json = json.dumps(body_text, ensure_ascii=False)
        
        entry = (
            '            {\n'
            '              "@type": "Review",\n'
            '              "author": {\n'
            '                "@type": "Person",\n'
            f'                "name": {author_name}\n'
            '              },\n'
            '              "reviewRating": {\n'
            '                "@type": "Rating",\n'
            f'                "ratingValue": {rating_json},\n'
            '                "bestRating": "5"\n'
            '              },\n'
            f'              "reviewBody": {body_json}\n'
            '            }'
        )
        review_entries.append(entry)
        
    lines.append(",\n".join(review_entries))
    lines.append('          ]')
    return "\n".join(lines) + "\n"


def generate_index_content(reviews, current_content: str) -> str:
    # 1. Проверка маркеров сетки отзывов
    if BEGIN_MARKER not in current_content or END_MARKER not in current_content:
        raise ValueError(
            f"Маркеры '{BEGIN_MARKER}' и/или '{END_MARKER}' не найдены в {INDEX_PATH}"
        )
    
    cards_html = build_cards_html(reviews)
    replacement_grid = f"{BEGIN_MARKER}\n{cards_html}\n                    {END_MARKER}"
    new_content = RE_GRID.sub(replacement_grid, current_content)
    
    # 2. Проверка и замена Schema.org
    schema_block = build_schema_block(reviews)
    if not RE_SCHEMA.search(new_content):
        raise ValueError(f"Блок aggregateRating/review Schema.org не найден в {INDEX_PATH}")
    
    new_content = RE_SCHEMA.sub(schema_block, new_content)
    return new_content


def main():
    check_mode = "--check" in sys.argv
    reviews = load_reviews()
    
    if not INDEX_PATH.exists():
        print(f"[ОШИБКА] index.html не найден: {INDEX_PATH}", file=sys.stderr)
        sys.exit(1)
        
    current_content = INDEX_PATH.read_text(encoding="utf-8")
    
    try:
        new_content = generate_index_content(reviews, current_content)
    except Exception as e:
        print(f"[ОШИБКА] Сбой генерации: {e}", file=sys.stderr)
        sys.exit(1)
        
    if current_content == new_content:
        if check_mode:
            print("[OK] Отзывы в index.html и разметка Schema.org полностью синхронны с reviews.json")
            sys.exit(0)
        else:
            print(f"[OK] index.html уже актуален ({len(reviews)} отзывов), изменений нет")
            sys.exit(0)
    else:
        if check_mode:
            print("[FAIL] Обнаружено расхождение между static/data/reviews.json и index.html!", file=sys.stderr)
            print("       Запустите 'python tools/build_reviews.py', чтобы обновить страницу и разметку.", file=sys.stderr)
            sys.exit(1)
        else:
            INDEX_PATH.write_text(new_content, encoding="utf-8")
            print(f"[OK] index.html успешно обновлён: сгенерировано {len(reviews)} карточек и обновлена разметка Schema.org")
            sys.exit(0)


if __name__ == "__main__":
    main()
