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
5. Базовые проверки безопасности и целостности репозитория (.env, CSP, .htaccess)
6. Архитектура Google Sheets: снимок SheetSnapshot, кэширование и сокращение сетевых запросов
7. Форматирование адресов объектов в боте и нейтральный текст ссылки клиенту (tasks/034)
8. Синхронность версий кэш-бэстинга style.css (?v=) и относительных путей

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
    print("\n[1/8] Проверка синтаксиса Python-файлов...")
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
    print("\n[2/8] Проверка JSON-конфигураций и структуры данных...")
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
    print("\n[3/8] Проверка файлов медиа и галереи...")
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
    print("\n[4/8] Запуск тестовых наборов JavaScript (Node.js)...")
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
    print("\n[5/8] Базовые проверки безопасности...")
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

def check_sheets_snapshot_logic():
    print("\n[6/8] Проверка архитектуры Google Sheets снимка (SheetSnapshot)...")
    server_py = ROOT_DIR / "server.py"
    if not server_py.exists():
        report_fail("server.py не найден")
        return

    server_code = server_py.read_text(encoding="utf-8")
    if "class SheetSnapshot" in server_code and "get_sheet_snapshot" in server_code:
        report_pass("Класс SheetSnapshot и фабрика get_sheet_snapshot присутствуют в server.py")
    else:
        report_fail("В server.py отсутствует SheetSnapshot или get_sheet_snapshot")
        return

    try:
        tree = ast.parse(server_code)
        target_nodes = []
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name in ("SnapshotCell", "SheetSnapshot"):
                target_nodes.append(node)

        module_ast = ast.Module(body=target_nodes, type_ignores=[])
        compiled = compile(module_ast, filename="<snapshot_test>", mode="exec")
        sandbox_ns = {"app": type("App", (), {"logger": type("Logger", (), {"error": lambda *a, **k: None})()})()}
        exec(compiled, sandbox_ns)

        SheetSnapshot = sandbox_ns["SheetSnapshot"]

        class MockWs:
            def __init__(self, rows):
                self._rows = [list(r) for r in rows]
                self.calls = {"get_all_values": 0, "update_cell": 0, "append_row": 0}
            def get_all_values(self):
                self.calls["get_all_values"] += 1
                return [list(r) for r in self._rows]
            def update_cell(self, r, c, v):
                self.calls["update_cell"] += 1
                self._rows[r - 1][c - 1] = str(v)
            def append_row(self, row):
                self.calls["append_row"] += 1
                self._rows.append(list(row))

        mock_ws = MockWs([
            ["id", "progress", "stage", "total", "paid", "address", "photo", "token"],
            ["14", "25", "Штробление", "100 000 ₽", "25 000 ₽", "ул. Мира, 1", "", "tok14"],
            ["145", "50", "Кабель", "200 000 ₽", "100 000 ₽", "пр. Невский, 10", "", "tok145"]
        ])

        snap = SheetSnapshot(mock_ws)
        assert mock_ws.calls["get_all_values"] == 1, "Должен быть ровно 1 вызов get_all_values"

        # O(1) точный поиск по ID
        c14 = snap.find_object("14")
        assert c14 is not None and c14.row == 2
        c145 = snap.find_object("145")
        assert c145 is not None and c145.row == 3
        assert snap.find_object("999") is None
        assert mock_ws.calls["get_all_values"] == 1

        # Обновление ячейки: сетевой вызов + мгновенное локальное обновление
        snap.update_cell(c14.row, 2, "75")
        assert mock_ws.calls["update_cell"] == 1
        assert snap.row_values(c14.row)[1] == "75"
        assert snap.cell(c14.row, 2).value == "75"

        # Добавление строки: сетевой вызов + добавление в локальный индекс
        snap.append_row(["200", "0", "Завоз", "50 000 ₽", "0 ₽", "ул. Садовая", "", "tok200"])
        assert mock_ws.calls["append_row"] == 1
        c200 = snap.find_object("200")
        assert c200 is not None and c200.row == 4
        assert snap.row_values(c200.row)[5] == "ул. Садовая"

        # За весь жизненный цикл запроса — ровно 1 чтение
        assert mock_ws.calls["get_all_values"] == 1
        report_pass("Модульный тест SheetSnapshot: ровно 1 чтение таблицы на запрос, O(1) поиск и синхронность")
    except Exception as e:
        report_fail("Сбой функционального теста SheetSnapshot", str(e))

def check_address_formatting():
    print("\n[7/8] Проверка форматирования адресов и ссылок клиенту (tasks/034)...")
    server_py = ROOT_DIR / "server.py"
    if not server_py.exists():
        report_fail("server.py не найден")
        return

    server_code = server_py.read_text(encoding="utf-8")
    required_symbols = ["format_short_address", "disambiguate_button_labels", "build_client_share_message"]
    for sym in required_symbols:
        if sym not in server_code:
            report_fail(f"В server.py отсутствует функция {sym}")
            return

    try:
        import html
        import re

        tree = ast.parse(server_code)
        target_funcs = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in required_symbols:
                target_funcs.append(node)

        mod_ast = ast.Module(body=target_funcs, type_ignores=[])
        compiled = compile(mod_ast, "<address_test>", "exec")
        sandbox_ns = {"re": re, "html": html}
        exec(compiled, sandbox_ns)

        disambiguate_button_labels = sandbox_ns["disambiguate_button_labels"]
        build_client_share_message = sandbox_ns["build_client_share_message"]

        # Тест 1: различение похожих адресов
        sample_items = [
            ("10", "0", "ул. Ленина, 24"),
            ("11", "10", "ул. Ленина, 24 к2"),
            ("12", "25", "ул. Ленина, 240"),
            ("13", "50", ""),
            ("14", "100", "Объект №14")
        ]
        buttons = disambiguate_button_labels(sample_items)
        labels = [b[0]["text"] for b in buttons]

        assert len(set(labels)) == len(labels), "Кнопки объектов должны быть уникальны"
        assert "24" in labels[0] and "24 к2" in labels[1] and "240" in labels[2]
        assert "Без адреса" in labels[3]
        assert "Без адреса" in labels[4]
        report_pass("Кнопки объектов со схожим началом корректно различимы и показывают номер дома")

        # Тест 2: коллизия абсолютно одинаковых адресов
        dups = [
            ("101", "0", "ул. Мира"),
            ("102", "0", "ул. Мира")
        ]
        dup_buttons = disambiguate_button_labels(dups)
        dup_labels = [b[0]["text"] for b in dup_buttons]
        assert dup_labels[0] != dup_labels[1]
        assert "#1" in dup_labels[0] and "#2" in dup_labels[1]
        report_pass("Одинаковые адреса автоматически нумеруются (#1, #2) для избежания коллизий")

        # Тест 3: сообщение клиенту с полным адресом
        msg_addr = build_client_share_message("10", "ул. Ленина, 24", "tok_abc")
        assert "онлайн (ул. Ленина, 24):" in msg_addr
        assert "id=10&t=tok_abc" in msg_addr
        report_pass("Сообщение клиенту содержит полный неотсечённый адрес в скобках")

        # Тест 4: сообщение клиенту при пустом/дефолтном адресе
        msg_empty = build_client_share_message("13", "", "tok_xyz")
        assert "онлайн:" in msg_empty
        assert "()" not in msg_empty
        assert "по объекту" not in msg_empty

        msg_def = build_client_share_message("14", "Объект №14", "tok_xyz")
        assert "онлайн:" in msg_def
        assert "()" not in msg_def
        report_pass("При пустом адресе текст нейтрален и не содержит пустых скобок")

        # Тест 5: HTML-экранирование и защита длины
        msg_esc = build_client_share_message("15", "ул. Ленина <Строителей> & Ко", "tok_999")
        assert "&lt;Строителей&gt; &amp; Ко" in msg_esc
        assert len(msg_esc) < 4096
        report_pass("Спецсимволы HTML безопасно экранируются, лимит длины соблюдён")

    except Exception as e:
        report_fail("Сбой функционального теста форматирования адресов", str(e))

def check_css_version_consistency():
    print("\n[8/8] Проверка синхронности версий CSS (?v=) и относительных путей...")
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
    check_sheets_snapshot_logic()
    check_address_formatting()
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
