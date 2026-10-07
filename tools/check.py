#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/check.py — Единая команда комплексной проверки проекта VoltGroup.

Проверяет:
1. Синтаксис Python-скриптов (ast.parse для server.py и вспомогательных файлов)
2. Валидность всех JSON-конфигураций (prices.json, gallery-config.json, манифесты)
3. Целостность файлов галереи (существование WebP, отсутствие устаревших ссылок .jpg)
4. Модульные тесты JavaScript (Node.js):
   - tools/test_money.js (сумма прописью)
   - tools/test_doc_totals.js (единая база цен и шаблоны)
   - tools/test_estimate_calc.js (математика калькулятора, скидки, материалы)
   - tools/test_doc_smoke.js (генерация всех 4 документов)
   - tools/test_cookies.js (баннер согласия и Метрика)
5. Базовые проверки безопасности и целостности репозитория
6. Синхронность версий кэш-бэстинга style.css (?v=) и относительных путей

Использование:
    python tools/check.py
"""

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

# Поддержка UTF-8 вывода в консоли Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Корень репозитория
ROOT_DIR = Path(__file__).resolve().parent.parent

passed_count = 0
failed_count = 0
errors = []

def report_pass(msg: str):
    global passed_count
    passed_count += 1
    print(f"  [OK] {msg}")

def report_fail(msg: str, err: str = ""):
    global failed_count
    failed_count += 1
    full_msg = f"  [FAIL] {msg}" + (f" -> {err}" if err else "")
    errors.append(full_msg)
    print(full_msg)

def check_python_syntax():
    print("\n[1/6] Проверка синтаксиса Python-файлов...")
    py_files = [ROOT_DIR / "server.py", Path(__file__).resolve()]
    for py_file in py_files:
        if not py_file.exists():
            report_fail(f"Файл не найден: {py_file.name}")
            continue
        try:
            with open(py_file, "r", encoding="utf-8") as f:
                code = f.read()
            ast.parse(code, filename=str(py_file))
            report_pass(f"{py_file.name}: корректный AST-синтаксис")
        except Exception as e:
            report_fail(f"{py_file.name}: синтаксическая ошибка", str(e))

def check_json_configs():
    print("\n[2/6] Проверка JSON-конфигураций и структуры данных...")
    json_targets = [
        ROOT_DIR / "static" / "data" / "prices.json",
        ROOT_DIR / "gallery" / "gallery-config.json",
        ROOT_DIR / "manifest.json",
        ROOT_DIR / "yandex-manifest.json",
    ]

    for jpath in json_targets:
        rel_path = jpath.relative_to(ROOT_DIR)
        if not jpath.exists():
            report_fail(f"Файл {rel_path} не существует")
            continue
        try:
            with open(jpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            report_pass(f"{rel_path}: валидный JSON")

            # Дополнительные проверки структуры для ключевых файлов
            if jpath.name == "prices.json":
                if "install" in data and "engineering" in data:
                    report_pass(f"{rel_path}: присутствуют секции install и engineering")
                else:
                    report_fail(f"{rel_path}: отсутствуют обязательные секции install/engineering")
            elif jpath.name == "gallery-config.json":
                if isinstance(data, list) and len(data) >= 10:
                    report_pass(f"{rel_path}: содержит {len(data)} элементов галереи")
                else:
                    report_fail(f"{rel_path}: ожидался непустой массив элементов галереи")
        except Exception as e:
            report_fail(f"{rel_path}: ошибка парсинга JSON", str(e))

def check_gallery_assets():
    print("\n[3/6] Проверка файлов медиа и галереи...")
    cfg_path = ROOT_DIR / "gallery" / "gallery-config.json"
    if not cfg_path.exists():
        report_fail("Конфиг галереи не найден для проверки медиа")
        return

    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            items = json.load(f)

        jpg_count = 0
        missing_count = 0
        valid_webp_count = 0

        for item in items:
            img_rel = item.get("image", "")
            if ".jpg" in img_rel.lower() or ".jpeg" in img_rel.lower():
                jpg_count += 1

            # Относительный путь от корня
            clean_rel = img_rel.lstrip("./").replace("/", os.sep)
            full_path = ROOT_DIR / clean_rel

            if not full_path.exists():
                missing_count += 1
                report_fail(f"Файл галереи отсутствует на диске: {clean_rel}")
            else:
                valid_webp_count += 1

        if jpg_count == 0:
            report_pass("В конфиге галереи отсутствуют устаревшие ссылки .jpg/.jpeg")
        else:
            report_fail(f"В конфиге галереи найдено {jpg_count} ссылок на .jpg файлы")

        if missing_count == 0:
            report_pass(f"Все {valid_webp_count} файлов галереи физически существуют на диске")
    except Exception as e:
        report_fail("Ошибка проверки медиа галереи", str(e))

def run_node_tests():
    print("\n[4/6] Запуск тестовых наборов JavaScript (Node.js)...")
    js_tests = [
        ROOT_DIR / "tools" / "test_money.js",
        ROOT_DIR / "tools" / "test_doc_totals.js",
        ROOT_DIR / "tools" / "test_estimate_calc.js",
        ROOT_DIR / "tools" / "test_doc_smoke.js",
        ROOT_DIR / "tools" / "test_cookies.js"
    ]

    for test_file in js_tests:
        rel_test = test_file.relative_to(ROOT_DIR)
        if not test_file.exists():
            report_fail(f"Тестовый файл не найден: {rel_test}")
            continue

        try:
            res = subprocess.run(
                ["node", str(test_file)],
                cwd=str(ROOT_DIR),
                capture_output=True,
                text=True,
                encoding="utf-8"
            )
            if res.returncode == 0:
                report_pass(f"{rel_test}: все тесты успешно пройдены")
            else:
                report_fail(
                    f"{rel_test}: завершился с ошибкой (код {res.returncode})",
                    (res.stderr or res.stdout).strip().splitlines()[-1] if (res.stderr or res.stdout) else ""
                )
        except Exception as e:
            report_fail(f"{rel_test}: не удалось запустить через Node.js", str(e))

def check_security_sanity():
    print("\n[5/6] Базовые проверки безопасности...")
    # Проверка: файлы .env не должны отслеживаться в git
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            encoding="utf-8"
        )
        lines = res.stdout.splitlines()
        env_leaks = [l for l in lines if ".env" in l and not ".env.example" in l]
        if not env_leaks:
            report_pass("Файлы секретов .env отсутствуют в git status")
        else:
            report_fail("Обнаружены секретные .env файлы в рабочей копии git:", "; ".join(env_leaks))
    except Exception:
        # Если git недоступен в окружении
        pass

    # Проверка: наличие .env.example
    env_ex = ROOT_DIR / ".env.example"
    if env_ex.exists():
        report_pass(".env.example присутствует")
    else:
        report_fail(".env.example отсутствует")

    # Проверка: отсутствие устаревшего X-XSS-Protection и наличие CSP в server.py
    server_py = ROOT_DIR / "server.py"
    if server_py.exists():
        server_code = server_py.read_text(encoding="utf-8")
        if "X-XSS-Protection" not in server_code:
            report_pass("Устаревший заголовок X-XSS-Protection отсутствует в server.py")
        else:
            report_fail("В server.py обнаружен устаревший заголовок X-XSS-Protection")

        if "Content-Security-Policy" in server_code:
            report_pass("Заголовок Content-Security-Policy настроен в server.py")
        else:
            report_fail("В server.py отсутствует заголовок Content-Security-Policy")

    # Проверка: наличие .htaccess с CSP для веб-сервера
    htaccess = ROOT_DIR / ".htaccess"
    if htaccess.exists():
        htaccess_code = htaccess.read_text(encoding="utf-8")
        if "Content-Security-Policy" in htaccess_code:
            report_pass(".htaccess присутствует и содержит Content-Security-Policy")
        else:
            report_fail(".htaccess не содержит директивы Content-Security-Policy")
    else:
        report_fail("Файл .htaccess отсутствует в корне проекта")

def check_css_version_consistency():
    print("\n[6/6] Проверка синхронности версий CSS (?v=) и относительных путей...")
    import re
    html_targets = [
        ROOT_DIR / "index.html",
        ROOT_DIR / "estimate.html",
        ROOT_DIR / "works.html",
        ROOT_DIR / "cookies.html",
        ROOT_DIR / "offer.html",
        ROOT_DIR / "privacy.html",
        ROOT_DIR / "404.html",
        ROOT_DIR / "install" / "index.html",
        ROOT_DIR / "engineering" / "index.html",
        ROOT_DIR / "contacts" / "index.html",
    ]
    css_pattern = re.compile(r'href=[\'"]([^\'"]*style\.css(?:\?v=([^\'"]+))?)[\'"]')
    versions = {}
    path_errors = []

    for hpath in html_targets:
        rel_name = str(hpath.relative_to(ROOT_DIR))
        if not hpath.exists():
            report_fail(f"Файл {rel_name} не существует")
            continue
        try:
            with open(hpath, "r", encoding="utf-8") as f:
                content = f.read()
            m = css_pattern.search(content)
            if not m:
                report_fail(f"{rel_name}: не содержит ссылки на style.css")
                continue
            full_href, v = m.group(1), m.group(2)
            if not v:
                report_fail(f"{rel_name}: отсутствует параметр ?v= для style.css")
                continue
            versions[rel_name] = v

            is_sub = len(hpath.relative_to(ROOT_DIR).parts) > 1
            expected_prefix = "../static/css/style.css" if is_sub else "./static/css/style.css"
            if not full_href.startswith(expected_prefix):
                path_errors.append(f"{rel_name}: ожидался путь {expected_prefix}, получен {full_href}")
        except Exception as e:
            report_fail(f"Ошибка проверки {rel_name}", str(e))

    unique_versions = set(versions.values())
    if len(unique_versions) == 1:
        v_val = next(iter(unique_versions))
        report_pass(f"Все {len(versions)} страниц используют единую версию стилей: ?v={v_val}")
    else:
        report_fail(f"Рассинхрон версий style.css: обнаружены разные версии: {unique_versions}")

    if not path_errors:
        report_pass("Относительные пути к style.css корректны во всех 10 шаблонах")
    else:
        for pe in path_errors:
            report_fail(pe)

def main():
    print("=" * 60)
    print(" VoltGroup Project Health & Test Check (tools/check.py)")
    print("=" * 60)

    check_python_syntax()
    check_json_configs()
    check_gallery_assets()
    run_node_tests()
    check_security_sanity()
    check_css_version_consistency()

    print("\n" + "=" * 60)
    if failed_count == 0:
        print(f" [OK] ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ УСПЕШНО! (Пройдено: {passed_count}, Ошибок: 0)")
        print("=" * 60)
        sys.exit(0)
    else:
        print(f" [FAIL] ОБНАРУЖЕНЫ ОШИБКИ: {failed_count} (Пройдено: {passed_count})")
        print("=" * 60)
        for err in errors:
            print(err)
        sys.exit(1)

if __name__ == "__main__":
    main()
