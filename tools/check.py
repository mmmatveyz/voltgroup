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
import re
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
    py_files = [ROOT_DIR / "server.py", ROOT_DIR / "tools" / "backup.py", Path(__file__).resolve()]
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

    # Проверка: лимиты запросов и кастомный JSON 429 обработчик в server.py
    if server_py.exists():
        if "@app.errorhandler(429)" in server_code and "ratelimit_handler" in server_code:
            report_pass("Кастомный JSON-обработчик 429 настроен в server.py")
        else:
            report_fail("В server.py отсутствует кастомный JSON-обработчик @app.errorhandler(429)")

        if 'default_limits=["1000 per day", "300 per hour"]' in server_code:
            report_pass("Дефолтные лимиты Flask-Limiter расширены с учетом NAT (300 per hour)")
        else:
            report_fail("В server.py не обнаружены расширенные лимиты default_limits (300 per hour)")

    # Проверка: отсутствие устаревших личных ссылок matvey_zryachikh в формах и разметке
    html_files = list(ROOT_DIR.glob("*.html")) + list(ROOT_DIR.glob("*/index.html"))
    found_personal_tg = []
    for hf in html_files:
        try:
            content = hf.read_text(encoding="utf-8")
            if "matvey_zryachikh" in content:
                found_personal_tg.append(str(hf.relative_to(ROOT_DIR)))
        except Exception:
            pass
    if not found_personal_tg:
        report_pass("Личные ссылки matvey_zryachikh отсутствуют во всех HTML-страницах (используется voltgroup_spb)")
    else:
        report_fail(f"Обнаружены личные ссылки matvey_zryachikh в файлах: {', '.join(found_personal_tg)}")

    # Проверка: замена устаревшего document.write на Blob URL в генераторах документов (tasks/026)
    doc_js = ROOT_DIR / "static" / "js" / "documents.js"
    if doc_js.exists():
        doc_code = doc_js.read_text(encoding="utf-8")
        if "URL.createObjectURL(blob)" in doc_code and "new Blob" in doc_code:
            report_pass("Генераторы документов используют Blob URL для безопасного вывода на печать")
        else:
            report_fail("В static/js/documents.js отсутствует реализация Blob URL для печати")
    else:
        report_fail("static/js/documents.js не найден")

    # Проверка: единый конфиг реквизитов и контактов VG_COMPANY (tasks/029, п. 29 AUDIT)
    cfg_js = ROOT_DIR / "static" / "js" / "config.js"
    if cfg_js.exists():
        cfg_code = cfg_js.read_text(encoding="utf-8")
        required_keys = ["name", "inn", "phone", "telegram", "vk", "site", "brandName", "shortName"]
        missing_keys = [k for k in required_keys if f"{k}:" not in cfg_code and f"'{k}'" not in cfg_code and f'"{k}"' not in cfg_code]
        if "VG_COMPANY" in cfg_code and not missing_keys:
            report_pass("Конфиг static/js/config.js содержит единый объект VG_COMPANY со всеми реквизитами")
        else:
            report_fail(f"В static/js/config.js отсутствует VG_COMPANY или ключи: {missing_keys}")
    else:
        report_fail("static/js/config.js не найден")

    if doc_js.exists():
        doc_code = doc_js.read_text(encoding="utf-8")
        if "VG_COMPANY" in doc_code and "getContractorInfo" in doc_code:
            report_pass("Генераторы документов используют единый конфиг VG_COMPANY для реквизитов")
        else:
            report_fail("В static/js/documents.js отсутствует привязка к VG_COMPANY или getContractorInfo")

    # Проверка: абсолютный путь LOG_DIR и отказоустойчивость логирования (п. 24 AUDIT)
    if server_py.exists():
        server_code = server_py.read_text(encoding="utf-8")
        if "os.path.abspath(__file__)" in server_code and "os.makedirs(LOG_DIR, exist_ok=True)" in server_code:
            report_pass("Каталог logs/ использует абсолютный путь от расположения server.py с exist_ok=True")
        else:
            report_fail("В server.py путь к logs/ не приведен к абсолютному от __file__ или нет exist_ok=True")

        if "except Exception as log_err:" in server_code and "logging.basicConfig" in server_code:
            report_pass("При ошибках создания каталога/файла логов предусмотрен fallback на консольный логгер")
        else:
            report_fail("В server.py отсутствует fallback на базовый логгер при сбое файлового логгера")

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

def check_data_normalization_logic():
    print("\n[8/9] Проверка нормализации данных из Google Таблицы (tasks/028, п. 27 AUDIT)...")
    server_py = ROOT_DIR / "server.py"
    if not server_py.exists():
        report_fail("server.py не найден")
        return

    server_code = server_py.read_text(encoding="utf-8")
    required_funcs = ["normalize_progress", "normalize_money_str", "normalize_stage", "normalize_photo_urls"]
    for fn in required_funcs:
        if f"def {fn}" in server_code:
            report_pass(f"Функция {fn} присутствует в server.py")
        else:
            report_fail(f"Функция {fn} отсутствует в server.py")
            return

    try:
        tree = ast.parse(server_code)
        target_nodes = []
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == "STAGES":
                        target_nodes.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in required_funcs:
                target_nodes.append(node)

        module_ast = ast.Module(body=target_nodes, type_ignores=[])
        compiled = compile(module_ast, filename="<normalization_test>", mode="exec")
        sandbox_ns = {
            "re": re,
            "app": type("App", (), {"logger": type("Logger", (), {"warning": lambda *a, **k: None, "error": lambda *a, **k: None})()})()
        }
        exec(compiled, sandbox_ns)

        norm_prog = sandbox_ns["normalize_progress"]
        norm_money = sandbox_ns["normalize_money_str"]
        norm_stage = sandbox_ns["normalize_stage"]
        norm_photo = sandbox_ns["normalize_photo_urls"]

        # Тест progress: 150 -> 100, -20 -> 0, "85%" -> 85, "много" -> 0, пустой -> 0
        assert norm_prog(150) == 100
        assert norm_prog(-20) == 0
        assert norm_prog("85%") == 85
        assert norm_prog("много") == 0
        assert norm_prog("") == 0
        assert norm_prog(None) == 0
        assert norm_prog(50) == 50
        report_pass("normalize_progress строго зажимает процент выполнения в диапазон 0..100")

        # Тест money: "50000" -> "50 000 ₽", "50 000 ₽" -> "50 000 ₽", "abc" -> "0 ₽", "" -> "0 ₽"
        assert norm_money("50000") == "50 000 ₽"
        assert norm_money("50 000 ₽") == "50 000 ₽"
        assert norm_money(" 1250300 ") == "1 250 300 ₽"
        assert norm_money("неизвестно") == "0 ₽"
        assert norm_money(None) == "0 ₽"
        report_pass("normalize_money_str корректно форматирует суммы и очищает ручной ввод")

        # Тест stage: стандартный этап -> без изменений, нестандартный -> без падений с логированием
        assert norm_stage("Завоз материалов") == "Завоз материалов"
        assert norm_stage("Нестандартный этап") == "Нестандартный этап"
        assert norm_stage("") == "Завоз материалов"
        report_pass("normalize_stage валидирует этап и подставляет дефолтный при пустом значении")

        # Тест photo: разбор строки, удаление дублей и пустых значений
        photo_input = "https://img1.com, , https://img2.com, https://img1.com,  https://img3.com "
        photo_res = norm_photo(photo_input)
        assert photo_res == "https://img1.com, https://img2.com, https://img3.com"
        assert norm_photo("") == ""
        assert norm_photo(None) == ""
        report_pass("normalize_photo_urls удаляет пустые элементы и дедуплицирует ссылки")

    except Exception as e:
        report_fail("Сбой модульного теста нормализации данных таблицы", str(e))

def check_error_alerts_system():
    print("\n[9/10] Проверка системы алертов об ошибках в Telegram (tasks/032, п. 32 AUDIT)...")
    server_path = ROOT_DIR / "server.py"
    with open(server_path, "r", encoding="utf-8") as f:
        server_code = f.read()

    required_symbols = [
        "notify_admin",
        "sanitize_error_reason",
        "_error_alert_timestamps",
        "_error_alert_counts",
        "ALERT_THROTTLE_SECONDS"
    ]
    for sym in required_symbols:
        if sym not in server_code:
            report_fail(f"В server.py отсутствует символ/функция {sym}")
            return

    try:
        import html
        import re
        from datetime import datetime

        tree = ast.parse(server_code)
        target_funcs = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in ["notify_admin", "sanitize_error_reason"]:
                target_funcs.append(node)

        mod_ast = ast.Module(body=target_funcs, type_ignores=[])
        compiled = compile(mod_ast, "<alerts_test>", "exec")
        
        sent_messages = []
        class MockApp:
            class logger:
                @staticmethod
                def error(*args, **kwargs): pass
                @staticmethod
                def warning(*args, **kwargs): pass
                @staticmethod
                def info(*args, **kwargs): pass

        def mock_send_tg_message(chat_id, text, reply_markup=None, parse_mode="HTML"):
            sent_messages.append((chat_id, text))
            return True

        sandbox_ns = {
            "re": re,
            "html": html,
            "datetime": datetime,
            "time": __import__("time"),
            "app": MockApp,
            "send_tg_message": mock_send_tg_message,
            "BOT_TOKEN": "123:ABC",
            "CHAT_ID": "123456",
            "ALERT_THROTTLE_SECONDS": 300,
            "_error_alert_timestamps": {},
            "_error_alert_counts": {}
        }
        exec(compiled, sandbox_ns)

        clean_err = sandbox_ns["sanitize_error_reason"]
        notify = sandbox_ns["notify_admin"]

        # Тест 1: Санитизация путей и чувствительных данных
        raw_exc = Exception("Failed opening /var/data/users/secret.json: gspread error at C:\\Users\\Admin\\project\\server.py line 42")
        cleaned = clean_err(raw_exc)
        assert "/var" not in cleaned and "secret.json" not in cleaned
        assert "C:\\" not in cleaned and "server.py" not in cleaned
        report_pass("sanitize_error_reason надежно очищает пути файловой системы и системные пути")

        # Тест 2: Отправка алерта и троттлинг (подавление дублей)
        sent_messages.clear()
        res1 = notify("sheet_conn", op_type="Чтение Google Sheets", exc=Exception("Timeout"))
        assert res1 is True
        assert len(sent_messages) == 1
        assert "🚨 <b>Сбой в работе VoltGroup</b>" in sent_messages[0][1]
        assert "Операция:</b> Чтение Google Sheets" in sent_messages[0][1]

        # Второй вызов подряд с тем же ключом должен быть отброшен троттлингом
        res2 = notify("sheet_conn", op_type="Чтение Google Sheets", exc=Exception("Timeout 2"))
        assert res2 is False
        assert len(sent_messages) == 1  # новых сообщений не отправлено!
        assert sandbox_ns["_error_alert_counts"]["sheet_conn"] == 1
        report_pass("notify_admin успешно отправляет алерт и троттлит повторные ошибки (минимум 5 мин)")

        # Тест 3: Другой ключ ошибки проходит без блокировки
        res3 = notify("tg_callback", op_type="Callback кнопка", obj_id="77", exc=Exception("Bad query"))
        assert res3 is True
        assert len(sent_messages) == 2
        assert "Объект ID:</b> <code>77</code>" in sent_messages[1][1]
        report_pass("notify_admin изолирует троттлинг по error_key и выводит ID объекта при наличии")

    except Exception as e:
        report_fail("Сбой проверки системы алертов об ошибках", str(e))

def check_backup_system():
    print("\n[10/11] Проверка системы резервного копирования данных (tasks/033, п. 34 AUDIT)...")
    backup_script = ROOT_DIR / "tools" / "backup.py"
    restore_doc = ROOT_DIR / "docs" / "RESTORE.md"
    gitignore_path = ROOT_DIR / ".gitignore"

    if not backup_script.exists():
        report_fail("Файл tools/backup.py не найден")
        return
    if not restore_doc.exists():
        report_fail("Документ docs/RESTORE.md не найден")
        return

    # 1. Проверка .gitignore
    with open(gitignore_path, "r", encoding="utf-8") as f:
        gi_content = f.read()
    if "backups/" not in gi_content:
        report_fail(".gitignore не содержит исключения папки backups/")
        return
    report_pass(".gitignore содержит правило исключения папки backups/")

    # 2. Модульное тестирование логики сохранения и ротации снимков
    try:
        import tempfile
        import shutil
        import csv
        import glob
        import time
        from datetime import datetime

        with open(backup_script, "r", encoding="utf-8") as f:
            b_code = f.read()

        sandbox_ns = {
            "__file__": str(backup_script),
            "os": os,
            "sys": sys,
            "json": json,
            "csv": csv,
            "glob": glob,
            "time": time,
            "datetime": datetime,
            "Path": Path,
            "MAX_BACKUPS_TO_KEEP": 3
        }
        exec(b_code, sandbox_ns)

        save_fn = sandbox_ns["save_snapshot_data"]
        rotate_fn = sandbox_ns["rotate_backups"]

        # Создаем временную тестовую директорию
        test_dir = Path(tempfile.mkdtemp(prefix="vg_backup_test_"))
        try:
            sample_rows = [
                ["id", "address", "total", "paid", "progress", "stage", "photo", "token"],
                ["101", "ул. Ленина, 10", "150000", "50000", "30", "Черновой монтаж", "", "tok_101"],
                ["102", "Невский пр., 25", "280000", "280000", "100", "Сдан", "", "tok_102"]
            ]

            # Тест создания 5 бэкапов
            for i in range(5):
                ts = f"2026100{i}_120000"
                save_fn(sample_rows, backup_dir=test_dir, timestamp_str=ts)
                time.sleep(0.01)

            json_files = list(test_dir.glob("backup_*.json"))
            csv_files = list(test_dir.glob("backup_*.csv"))
            assert len(json_files) == 5, "Должно быть создано 5 JSON-файлов"
            assert len(csv_files) == 5, "Должно быть создано 5 CSV-файлов"

            # Проверка содержимого сохраненного JSON и CSV
            test_json = json_files[0]
            with open(test_json, "r", encoding="utf-8") as jf:
                parsed = json.load(jf)
                assert parsed["rows_count"] == 3
                assert parsed["data"][1][0] == "101"

            test_csv = csv_files[0]
            with open(test_csv, "r", encoding="utf-8-sig") as cf:
                reader = list(csv.reader(cf, delimiter=";"))
                assert len(reader) == 3
                assert reader[2][0] == "102"
                assert reader[2][1] == "Невский пр., 25"

            report_pass("save_snapshot_data корректно сохраняет данные в JSON и CSV с метаданными")

            # Тест ротации (оставляем только 3 самых свежих)
            del_count = rotate_fn(backup_dir=test_dir, max_keep=3)
            assert del_count == 4, f"Должно быть удалено 4 устаревших файла (2 JSON + 2 CSV), удалено {del_count}"
            remaining_json = list(test_dir.glob("backup_*.json"))
            remaining_csv = list(test_dir.glob("backup_*.csv"))
            assert len(remaining_json) == 3
            assert len(remaining_csv) == 3
            report_pass("rotate_backups корректно очищает старые архивы и сохраняет ротацию")

        finally:
            shutil.rmtree(test_dir, ignore_errors=True)

    except Exception as e:
        report_fail("Сбой тестирования логики резервного копирования", str(e))

def check_css_version_consistency():
    print("\n[11/11] Проверка синхронности версий CSS (?v=) и относительных путей...")
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
    check_data_normalization_logic()
    check_error_alerts_system()
    check_backup_system()
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
