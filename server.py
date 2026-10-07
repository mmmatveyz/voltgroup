from flask import Flask, request, jsonify
import requests
import os
import json
import html
import re
import secrets
import time
import logging
from logging.handlers import RotatingFileHandler
import gspread
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# ----------------------------------------------------
# 1. НАСТРОЙКА БЕЗОПАСНОСТИ И ЛОГИРОВАНИЯ
# ----------------------------------------------------
app.config['ENV'] = 'production'
app.debug = False

# Логирование в файл вместо вывода ошибок в консоль/браузер
LOG_DIR = os.environ.get('LOG_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs'))
try:
    os.makedirs(LOG_DIR, exist_ok=True)
    file_handler = RotatingFileHandler(os.path.join(LOG_DIR, 'app.log'), maxBytes=10240000, backupCount=5)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.info('VoltGroup Server Startup')
except Exception as log_err:
    logging.basicConfig(level=logging.INFO)
    app.logger.warning(f"Не удалось инициализировать файловый логгер: {log_err}")

# ----------------------------------------------------
# 2. ОГРАНИЧЕНИЕ CORS И RATE LIMITING
# ----------------------------------------------------
DEFAULT_ALLOWED_ORIGINS = [
    "https://voltgroup-spb.ru",
    "https://www.voltgroup-spb.ru",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
]

env_origins = os.environ.get('ALLOWED_ORIGINS')
if env_origins:
    ALLOWED_ORIGINS = [origin.strip() for origin in env_origins.split(',') if origin.strip()]
else:
    ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS

CORS(app, resources={
    r"/ping": {"origins": ALLOWED_ORIGINS},
    r"/send-message": {"origins": ALLOWED_ORIGINS},
    r"/get-status": {"origins": ALLOWED_ORIGINS}
})

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["1000 per day", "300 per hour"],
    storage_uri="memory://"
)

@app.errorhandler(429)
def ratelimit_handler(e):
    """Возвращает понятный структурированный JSON при превышении лимита запросов (HTTP 429)"""
    description = getattr(e, 'description', None)
    return jsonify({
        "status": "error",
        "msg": "Слишком много запросов. Пожалуйста, подождите минуту перед повторной попыткой.",
        "detail": str(description) if description else "Превышен лимит запросов с вашего IP-адреса"
    }), 429

# ----------------------------------------------------
# 3. SECURITY HEADERS (Заголовки безопасности)
# ----------------------------------------------------
@app.after_request
def set_security_headers(response):
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    return response

# ----------------------------------------------------
# 4. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ И Google Таблицы
# ----------------------------------------------------
BOT_TOKEN = os.environ.get('BOT_TOKEN')
CHAT_ID = os.environ.get('CHAT_ID')
SHEET_URL = os.environ.get('SHEET_URL')
TELEGRAM_SECRET_TOKEN = os.environ.get('TELEGRAM_SECRET_TOKEN')

COLUMNS_MAP = {
    'progress': 2,
    'stage': 3,
    'total': 4,
    'paid': 5,
    'address': 6,
    'photo': 7,
    'token': 8
}

_cached_ws = None

def get_sheet():
    """Подключается к Google Таблице с повторным использованием сессии"""
    global _cached_ws
    if _cached_ws is not None:
        try:
            _cached_ws.title
            return _cached_ws
        except Exception:
            _cached_ws = None

    creds_json = os.environ.get('GOOGLE_CREDENTIALS')
    if not creds_json or not SHEET_URL:
        raise ValueError("Не настроены переменные GOOGLE_CREDENTIALS или SHEET_URL")

    creds_dict = json.loads(creds_json)
    gc = gspread.service_account_from_dict(creds_dict)
    sh = gc.open_by_url(SHEET_URL)
    _cached_ws = sh.sheet1
    return _cached_ws

class SnapshotCell:
    """Обертка ячейки для совместимости с интерфейсом gspread.Cell"""
    def __init__(self, row, col, value):
        self.row = row
        self.col = col
        self.value = value

class SheetSnapshot:
    """
    Снимок таблицы для обслуживания одного входящего запроса (вебхук или API).
    Загружает данные ровно один раз через ws.get_all_values() и строит O(1) индекс по ID объекта.
    Все последующие чтения (поиск объекта, получение строки, чтение ячейки) выполняются из памяти
    без сетевых запросов. Запись (update_cell, append_row) обновляет как удаленную таблицу Google,
    так и локальный снимок, гарантируя согласованность данных в рамках запроса.
    """
    def __init__(self, ws):
        self.ws = ws
        try:
            self.rows = ws.get_all_values() if ws else []
        except Exception as e:
            app.logger.error(f"Ошибка загрузки снимка таблицы: {e}")
            self.rows = []
        self._build_index()

    def _build_index(self):
        self.index = {}  # obj_id -> row_number (1-based)
        if len(self.rows) > 1:
            for idx, row in enumerate(self.rows[1:], start=2):
                if row and len(row) > 0 and str(row[0]).strip():
                    obj_id = str(row[0]).strip()
                    self.index[obj_id] = idx

    def find_object(self, obj_id):
        """O(1) поиск ячейки объекта по точному совпадению ID"""
        target = str(obj_id).strip()
        if not target:
            return None
        row_num = self.index.get(target)
        if row_num is not None:
            return SnapshotCell(row_num, 1, target)
        return None

    def row_values(self, row_num):
        """Возвращает значения строки из снимка с дополнением минимум до 8 колонок"""
        row_idx = row_num - 1
        if 0 <= row_idx < len(self.rows):
            vals = list(self.rows[row_idx])
            while len(vals) < 8:
                vals.append("")
            return vals
        return [""] * 8

    def cell(self, row_num, col_num):
        """Возвращает ячейку из снимка памяти без сетевого вызова"""
        row_idx = row_num - 1
        col_idx = col_num - 1
        if 0 <= row_idx < len(self.rows):
            row = self.rows[row_idx]
            val = row[col_idx] if 0 <= col_idx < len(row) else ""
            return SnapshotCell(row_num, col_num, val)
        return SnapshotCell(row_num, col_num, "")

    def get_all_values(self):
        """Возвращает кэшированные строки таблицы"""
        return self.rows

    def update_cell(self, row_num, col_num, value):
        """Синхронно обновляет ячейку в Google Таблице и в снимке памяти"""
        str_val = str(value)
        if self.ws:
            self.ws.update_cell(row_num, col_num, str_val)
        row_idx = row_num - 1
        col_idx = col_num - 1
        while len(self.rows) <= row_idx:
            self.rows.append([])
        row = self.rows[row_idx]
        while len(row) <= col_idx:
            row.append("")
        row[col_idx] = str_val
        if col_num == 1:
            self._build_index()

    def append_row(self, row_values):
        """Синхронно добавляет строку в Google Таблицу и в снимок памяти"""
        str_row = [str(v) for v in row_values]
        if self.ws:
            self.ws.append_row(str_row)
        self.rows.append(str_row)
        new_row_num = len(self.rows)
        if str_row and str_row[0].strip():
            self.index[str_row[0].strip()] = new_row_num

def get_sheet_snapshot():
    """Возвращает свежий снимок Google Таблицы для обслуживания одного запроса"""
    return SheetSnapshot(get_sheet())

def find_object_cell(ws, obj_id):
    """
    Ищет ячейку с точным совпадением ID объекта в первой колонке (колонка A).
    Исключает частичные совпадения подстрок (например, чтобы '14' не находило '145').
    Если передан SheetSnapshot, использует локальный индекс O(1) без сетевых запросов.
    """
    target = str(obj_id).strip()
    if not target:
        return None

    if hasattr(ws, 'find_object'):
        return ws.find_object(target)

    try:
        # gspread поддерживает re.Pattern в методе find()
        pattern = re.compile(rf"^\s*{re.escape(target)}\s*$")
        cell = ws.find(pattern, in_column=1)
        if cell:
            val = getattr(cell, 'value', None)
            if val is not None:
                if str(val).strip() == target:
                    return cell
            else:
                row_val = ws.cell(cell.row, 1).value
                if str(row_val).strip() == target:
                    return cell
    except Exception as e:
        app.logger.warning(f"Ошибка find(regex) для объекта {target}: {e}")

    # Резервный поиск по первой колонке с точным сравнением
    try:
        col_values = ws.col_values(1)
        for idx, val in enumerate(col_values, start=1):
            if str(val).strip() == target:
                class ExactCell:
                    def __init__(self, row, value):
                        self.row = row
                        self.value = value
                return ExactCell(idx, str(val).strip())
    except Exception as e:
        app.logger.error(f"Ошибка col_values при поиске объекта {target}: {e}")

    return None

STAGES = [
    "Завоз материалов",
    "Штробление и кабель",
    "Сборка электрощита",
    "Чистовой монтаж",
    "Сдача объекта / Акт"
]

# ⚠️ ВАЖНО: user_states и лимитер хранятся в памяти процесса.
# Запуск бэкенда строго в один процесс: gunicorn -w 1 -k gthread --threads 8.
# При числе воркеров > 1 состояние теряется между запросами (см. AUDIT.md пункт 2).
USER_STATE_TTL_SECONDS = 900  # 15 минут TTL для незавершённых диалогов
user_states = {}

def send_tg_message(chat_id, text, parse_mode="HTML", reply_markup=None):
    """Отправляет сообщение в Telegram с проверкой статуса и поддержкой клавиатуры"""
    if not BOT_TOKEN:
        app.logger.error("BOT_TOKEN не задан")
        return False
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        resp = requests.post(url, json=payload, timeout=10)
        data = resp.json()
        if not data.get("ok"):
            app.logger.error(f"Ошибка Telegram API: {data}")
            return False
        return True
    except Exception as e:
        app.logger.error(f"Ошибка отправки сообщения в Telegram: {e}")
        return False

def edit_tg_message(chat_id, message_id, text, parse_mode="HTML", reply_markup=None):
    """Редактирует существующее сообщение в Telegram"""
    if not BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText"
    payload = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": parse_mode}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        resp = requests.post(url, json=payload, timeout=10)
        return resp.json().get("ok", False)
    except Exception as e:
        app.logger.error(f"Ошибка editMessageText: {e}")
        return False

def answer_callback(callback_query_id, text=None):
    """Отвечает на callback_query, снимая спиннер загрузки"""
    if not BOT_TOKEN or not callback_query_id:
        return False
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery"
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
    try:
        requests.post(url, json=payload, timeout=5)
        return True
    except Exception as e:
        app.logger.error(f"Ошибка answerCallbackQuery: {e}")
        return False

def build_main_menu():
    text = (
        "⚡️ <b>Панель управления VoltGroup</b>\n\n"
        "Управляйте объектами и этапами электромонтажа в 1 клик:"
    )
    kb = {
        "inline_keyboard": [
            [
                {"text": "📋 Мои объекты", "callback_data": "m:list"},
                {"text": "➕ Новый объект", "callback_data": "m:new"}
            ],
            [
                {"text": "🔄 Обновить меню", "callback_data": "m:main"}
            ]
        ]
    }
    return text, kb

def format_short_address(raw_addr, max_len=20):
    """
    Формирует компактный читаемый фрагмент адреса для кнопки Telegram.
    Сохраняет улицу и номер дома, убирая длинные префиксы городов и избыточные детали (квартиры).
    """
    if not raw_addr or str(raw_addr).strip().startswith("Объект №"):
        return "Без адреса"

    clean = re.sub(r'^(?:г\.\s*санкт-петербург|санкт-петербург|спб|г\.\s*спб)[,\s]*', '', str(raw_addr).strip(), flags=re.IGNORECASE).strip()
    if not clean:
        clean = str(raw_addr).strip()

    if len(clean) <= max_len:
        return clean

    # Пытаемся выделить улицу и номер дома/строения
    m = re.search(r'^(.*?)(?:,\s*(?:д\.?|дом)?\s*|\s+(?:д\.?|дом)\s*)([0-9]+.*)$', clean, flags=re.IGNORECASE)
    if m:
        street = m.group(1).strip()
        house = m.group(2).strip()
        # Сокращаем house до номера дома и корпуса (отбрасываем квартиры/этажи/офисы)
        house_short = re.sub(r'[,\s]*(?:кв\.?|квартира|эт\.?|этаж|оф\.?|офис)\s*\d+.*$', '', house, flags=re.IGNORECASE).strip()
        if not house_short:
            house_short = house
        budget_for_street = max(8, max_len - len(house_short) - 2)
        if len(street) > budget_for_street:
            street_short = street[:budget_for_street].rstrip(' ,.') + '…'
        else:
            street_short = street
        return f"{street_short}, {house_short}"

    return clean[:max_len].rstrip(' ,.') + '…'

def disambiguate_button_labels(obj_items):
    """
    Разрешает коллизии одинаковых коротких адресов в списке кнопок:
    - obj_items: список кортежей (obj_id, progress, raw_addr)
    - добавляет номер квартиры/офиса или различимый суффикс
    - если адреса полностью идентичны, нумерует их (#1, #2...)
    Возвращает список элементов для inline_keyboard: [[{"text": ..., "callback_data": ...}], ...]
    """
    temp = []
    for obj_id, progress, raw_addr in obj_items:
        s_addr = format_short_address(raw_addr)
        temp.append({'id': str(obj_id), 'progress': str(progress), 'raw': str(raw_addr or ""), 'short': s_addr})

    # Подсчитываем повторения одинаковых коротких адресов (кроме 'Без адреса')
    counts = {}
    for item in temp:
        s = item['short']
        if s != "Без адреса":
            counts[s] = counts.get(s, 0) + 1

    seen_indices = {}
    buttons = []
    for item in temp:
        s_addr = item['short']
        if counts.get(s_addr, 0) > 1:
            idx = seen_indices.get(s_addr, 0) + 1
            seen_indices[s_addr] = idx
            flat_m = re.search(r'(?:кв\.?|оф\.?)\s*(\d+)', item['raw'], flags=re.IGNORECASE)
            if flat_m:
                s_addr = f"{s_addr} кв.{flat_m.group(1)}"
            else:
                s_addr = f"{s_addr} #{idx}"
        oid = item['id']
        prog = item['progress']
        label = f"№{oid} · {s_addr} ({prog}%)"
        buttons.append([{"text": label, "callback_data": f"o:v:{oid}"}])

    return buttons

def build_client_share_message(obj_id, raw_addr, token):
    """
    Формирует готовое сообщение со ссылкой для пересылки заказчику (кнопка '🔗 Ссылка клиенту').
    - При наличии адреса: включает полный адрес в скобках с HTML-экранированием.
    - При отсутствии адреса (или дефолтном 'Объект №X'): нейтральная формулировка без пустых скобок.
    - Учитывает ограничения Telegram по длине.
    """
    addr = str(raw_addr).strip() if raw_addr else ""
    if addr and not addr.startswith("Объект №"):
        if len(addr) > 500:
            addr = addr[:497] + "..."
        addr_part = f" ({html.escape(addr)})"
    else:
        addr_part = ""

    return (
        f"Здравствуйте! Вы можете отслеживать ход электромонтажных работ, этапы и финансовый баланс онлайн{addr_part}:\n\n"
        f"👉 https://voltgroup-spb.ru/client/index.html?id={obj_id}&t={token}\n\n"
        f"VoltGroup · Электромонтаж и автоматизация"
    )

def build_objects_list(sheet):
    try:
        rows = sheet.get_all_values()
    except Exception as e:
        app.logger.error(f"Ошибка получения списка: {e}")
        rows = []

    obj_items = []
    # Начиная со строки 2 (индекс 1)
    if len(rows) > 1:
        for row in rows[1:]:
            if row and row[0].strip():
                obj_id = row[0].strip()
                progress = row[1].strip() if len(row) > 1 and row[1].strip() else "0"
                raw_addr = row[5].strip() if len(row) > 5 else ""
                obj_items.append((obj_id, progress, raw_addr))

    buttons = disambiguate_button_labels(obj_items)
    buttons.append([{"text": "➕ Добавить новый", "callback_data": "m:new"}])
    buttons.append([{"text": "« Главное меню", "callback_data": "m:main"}])

    count = len(obj_items)
    text = f"📋 <b>Список объектов VoltGroup</b> (Всего: {count}):\n\nВыберите объект для управления:"
    return text, {"inline_keyboard": buttons}

def build_object_view(sheet, obj_id):
    cell = find_object_cell(sheet, obj_id)
    if not cell:
        return f"⚠️ Объект №{html.escape(str(obj_id))} не найден в таблице.", {
            "inline_keyboard": [[{"text": "« К списку объектов", "callback_data": "m:list"}]]
        }

    vals = sheet.row_values(cell.row)
    while len(vals) < 8:
        vals.append("")

    progress = vals[1] or "0"
    stage = vals[2] or "Завоз материалов"
    total = vals[3] or "0 ₽"
    paid = vals[4] or "0 ₽"
    address = vals[5] or f"Объект №{obj_id}"

    text = (
        f"📍 <b>Объект №{html.escape(str(obj_id))}</b>\n\n"
        f"🏢 <b>Адрес:</b> {html.escape(str(address))}\n"
        f"📊 <b>Прогресс:</b> <code>{html.escape(str(progress))}%</code>\n"
        f"🏗 <b>Этап:</b> {html.escape(str(stage))}\n"
        f"💰 <b>Сумма сметы:</b> {html.escape(str(total))}\n"
        f"💳 <b>Оплачено:</b> {html.escape(str(paid))}\n"
    )

    kb = {
        "inline_keyboard": [
            [
                {"text": "📊 Прогресс", "callback_data": f"o:p:{obj_id}"},
                {"text": "🏗 Сменить этап", "callback_data": f"o:s:{obj_id}"}
            ],
            [
                {"text": "💰 Внести оплату", "callback_data": f"o:pay:{obj_id}"},
                {"text": "🔗 Ссылка клиенту", "callback_data": f"o:link:{obj_id}"}
            ],
            [
                {"text": "« К списку объектов", "callback_data": "m:list"},
                {"text": "🏠 Меню", "callback_data": "m:main"}
            ]
        ]
    }
    return text, kb

def build_progress_keyboard(obj_id):
    text = f"📊 <b>Изменение прогресса по объекту №{html.escape(str(obj_id))}</b>\n\nВыберите процент готовности:"
    kb = {
        "inline_keyboard": [
            [
                {"text": "10%", "callback_data": f"o:sp:{obj_id}:10"},
                {"text": "25%", "callback_data": f"o:sp:{obj_id}:25"},
                {"text": "40%", "callback_data": f"o:sp:{obj_id}:40"}
            ],
            [
                {"text": "50%", "callback_data": f"o:sp:{obj_id}:50"},
                {"text": "75%", "callback_data": f"o:sp:{obj_id}:75"},
                {"text": "90%", "callback_data": f"o:sp:{obj_id}:90"}
            ],
            [
                {"text": "100% (Объект завершён) ✅", "callback_data": f"o:sp:{obj_id}:100"}
            ],
            [
                {"text": "« Назад к объекту", "callback_data": f"o:v:{obj_id}"}
            ]
        ]
    }
    return text, kb

def build_stage_keyboard(obj_id):
    text = f"🏗 <b>Смена текущего этапа по объекту №{html.escape(str(obj_id))}</b>\n\nВыберите актуальный этап:"
    buttons = []
    for idx, stage_name in enumerate(STAGES):
        buttons.append([{"text": stage_name, "callback_data": f"o:ss:{obj_id}:{idx}"}])
    buttons.append([{"text": "« Назад к объекту", "callback_data": f"o:v:{obj_id}"}])
    return text, {"inline_keyboard": buttons}

# ----------------------------------------------------
# 5. МАРШРУТЫ ДЛЯ САЙТА
# ----------------------------------------------------

# Назначение /ping — предварительный прогрев бесплатного тарифа Render (cold start)
# при фокусе клиента на поле ввода в формах сайта. При переходе на платный инстанс
# необходимость отпадает. Ограничен 10 запросами в минуту с одного IP для защиты от спама.
@app.route('/ping', methods=['GET'])
@limiter.limit("10 per minute")
def ping():
    return jsonify({"status": "awake"}), 200

@app.route('/send-message', methods=['POST'])
@limiter.limit("5 per minute; 30 per hour")  # Защита от спама: не более 5 заявок в минуту и 30 в час
def send_message():
    try:
        data = request.get_json(silent=True) or {}
        name = data.get('name', 'Не указано')
        phone = data.get('phone', 'Не указано')
        service = data.get('service', 'Не указано')
        source = data.get('source', 'Неизвестная страница')

        text = (
            f"⚡️ <b>Новая заявка!</b>\n\n"
            f"👤 <b>Имя:</b> {html.escape(str(name))}\n"
            f"📞 <b>Телефон:</b> {html.escape(str(phone))}\n"
            f"🛠 <b>Задача:</b> {html.escape(str(service))}\n"
            f"📍 <b>Источник:</b> <code>{html.escape(str(source))}</code>"
        )
        success = send_tg_message(CHAT_ID, text, parse_mode="HTML")
        if success:
            return jsonify({"status": "success"}), 200
        else:
            return jsonify({"status": "error", "msg": "Не удалось доставить уведомление"}), 502
    except Exception as e:
        app.logger.error(f"Ошибка в /send-message: {e}")
        return jsonify({"status": "error", "msg": "Ошибка сервера"}), 500

@app.route('/get-status', methods=['GET', 'POST'])
@limiter.limit("60 per minute; 300 per hour")  # Мягкий лимит с учётом NAT в офисах и ЖК
def get_status():
    # Безопасное получение ID и токена из POST (JSON body) или GET (query param)
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        obj_id = data.get('id')
        token = data.get('t') or data.get('token')
    else:
        obj_id = request.args.get('id')
        token = request.args.get('t') or request.args.get('token')

    if not obj_id or not re.match(r"^\d{1,6}$", str(obj_id).strip()):
        return jsonify({"status": "error", "msg": "Некорректный ID объекта"}), 400

    if not token or not str(token).strip():
        return jsonify({"status": "error", "msg": "Отсутствует ключ доступа"}), 403

    try:
        sheet = get_sheet_snapshot()
        cell = find_object_cell(sheet, obj_id)
        if cell:
            row_values = sheet.row_values(cell.row)
            while len(row_values) < 8:
                row_values.append("")

            expected_token = row_values[7].strip()
            if not expected_token or not secrets.compare_digest(expected_token, str(token).strip()):
                return jsonify({"status": "error", "msg": "Неверный ключ доступа"}), 403

            data = {
                "progress": row_values[1],
                "stage": row_values[2],
                "total": row_values[3],
                "paid": row_values[4],
                "address": row_values[5],
                "photo": row_values[6]
            }
            return jsonify({"status": "success", "data": data}), 200
        else:
            return jsonify({"status": "error", "msg": "Объект не найден"}), 404
    except Exception as e:
        app.logger.error(f"Ошибка чтения таблицы: {e}")
        return jsonify({"status": "error", "msg": "Ошибка сервера"}), 500

# ----------------------------------------------------
# 6. МАРШРУТ ДЛЯ ТЕЛЕГРАМ БОТА (ВЕБХУК)
# ----------------------------------------------------

@app.route('/webhook', methods=['POST'])
@limiter.limit("120 per minute")
def webhook():
    """Слушает команды и инлайн-кнопки из Telegram и управляет Google Таблицей"""
    if TELEGRAM_SECRET_TOKEN:
        token_header = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
        if token_header != TELEGRAM_SECRET_TOKEN:
            app.logger.warning("Отклонён вебхук с некорректным секретным токеном")
            return '', 403

    data = request.get_json(silent=True) or {}

    # 1. ОБРАБОТКА НАЖАТИЙ НА ИНЛАЙН-КНОПКИ (CALLBACK QUERY)
    if "callback_query" in data:
        cb = data["callback_query"]
        cb_id = cb.get("id")
        cb_data = cb.get("data", "")
        chat_id = str(cb.get("message", {}).get("chat", {}).get("id", ""))
        msg_id = cb.get("message", {}).get("message_id")

        answer_callback(cb_id)

        if chat_id != str(CHAT_ID):
            return '', 200

        try:
            sheet = get_sheet_snapshot()

            # Главное меню
            if cb_data == "m:main":
                user_states.pop(chat_id, None)
                text, kb = build_main_menu()
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Список объектов
            elif cb_data == "m:list":
                user_states.pop(chat_id, None)
                text, kb = build_objects_list(sheet)
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Запрос на создание нового объекта
            elif cb_data == "m:new":
                user_states[chat_id] = {"action": "await_new", "ts": time.time()}
                prompt_text = (
                    "➕ <b>Создание нового объекта</b>\n\n"
                    "Пришлите номер объекта (и адрес через запятую), например:\n"
                    "<code>145, ул. Ленина, 24</code>\n"
                    "или просто номер:\n"
                    "<code>145</code>\n\n"
                    "Для отмены отправьте /cancel"
                )
                cancel_kb = {"inline_keyboard": [[{"text": "« Отмена в меню", "callback_data": "m:main"}]]}
                edit_tg_message(chat_id, msg_id, prompt_text, reply_markup=cancel_kb)

            # Просмотр карточки конкретного объекта (o:v:<id>)
            elif cb_data.startswith("o:v:"):
                user_states.pop(chat_id, None)
                obj_id = cb_data.split(":", 2)[2]
                text, kb = build_object_view(sheet, obj_id)
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Меню смены прогресса (o:p:<id>)
            elif cb_data.startswith("o:p:"):
                obj_id = cb_data.split(":", 2)[2]
                text, kb = build_progress_keyboard(obj_id)
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Сохранение нового прогресса (o:sp:<id>:<val>)
            elif cb_data.startswith("o:sp:"):
                parts = cb_data.split(":")
                obj_id = parts[2]
                val = parts[3]
                try:
                    val_int = int(val)
                    if not (0 <= val_int <= 100):
                        raise ValueError()
                except ValueError:
                    send_tg_message(chat_id, "⚠️ Некорректное значение прогресса.")
                    return '', 200

                cell = find_object_cell(sheet, obj_id)
                if cell:
                    sheet.update_cell(cell.row, COLUMNS_MAP['progress'], str(val_int))
                text, kb = build_object_view(sheet, obj_id)
                text = f"✅ <i>Прогресс обновлён на {val_int}%!</i>\n\n" + text
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Меню смены этапа (o:s:<id>)
            elif cb_data.startswith("o:s:"):
                obj_id = cb_data.split(":", 2)[2]
                text, kb = build_stage_keyboard(obj_id)
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Сохранение нового этапа (o:ss:<id>:<idx>)
            elif cb_data.startswith("o:ss:"):
                parts = cb_data.split(":")
                obj_id = parts[2]
                try:
                    idx = int(parts[3])
                except (ValueError, IndexError):
                    idx = -1

                if 0 <= idx < len(STAGES):
                    stage_name = STAGES[idx]
                    cell = find_object_cell(sheet, obj_id)
                    if cell:
                        sheet.update_cell(cell.row, COLUMNS_MAP['stage'], stage_name)
                    text, kb = build_object_view(sheet, obj_id)
                    text = f"✅ <i>Этап изменён на «{html.escape(stage_name)}»!</i>\n\n" + text
                else:
                    text, kb = build_object_view(sheet, obj_id)
                    text = "⚠️ <i>Некорректный этап!</i>\n\n" + text
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Запрос ввода оплаты (o:pay:<id>)
            elif cb_data.startswith("o:pay:"):
                obj_id = cb_data.split(":", 2)[2]
                user_states[chat_id] = {"action": "await_pay", "obj_id": obj_id, "ts": time.time()}
                prompt_text = (
                    f"💰 <b>Внесение оплаты по объекту №{html.escape(str(obj_id))}</b>\n\n"
                    "Пришлите сумму сообщением:\n"
                    "• Число, чтобы <b>прибавить</b> к внесённому: <code>50000</code>\n"
                    "• Или точную сумму со знаком равно: <code>=120000</code>\n\n"
                    "Для отмены отправьте /cancel"
                )
                cancel_kb = {"inline_keyboard": [[{"text": "« Назад к объекту", "callback_data": f"o:v:{obj_id}"}]]}
                edit_tg_message(chat_id, msg_id, prompt_text, reply_markup=cancel_kb)

            # Готовое сообщение со ссылкой для пересылки клиенту (o:link:<id>)
            elif cb_data.startswith("o:link:"):
                obj_id = cb_data.split(":", 2)[2]
                cell = find_object_cell(sheet, obj_id)
                if not cell:
                    send_tg_message(chat_id, f"⚠️ Объект №{html.escape(str(obj_id))} не найден в таблице.")
                    return '', 200

                row_vals = sheet.row_values(cell.row)
                while len(row_vals) < 8:
                    row_vals.append("")

                token = row_vals[7].strip()
                if not token:
                    token = secrets.token_urlsafe(16)
                    sheet.update_cell(cell.row, COLUMNS_MAP['token'], token)

                raw_addr = row_vals[5].strip() if len(row_vals) > 5 else ""
                client_msg = build_client_share_message(obj_id, raw_addr, token)
                send_tg_message(chat_id, client_msg)

        except Exception as e:
            app.logger.error(f"Ошибка callback_query: {e}")
            send_tg_message(chat_id, "💥 Ошибка при обработке нажатия кнопки")

        return '', 200

    # 2. ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ И КОМАНД
    if "message" in data and "text" in data["message"]:
        chat_id = str(data["message"]["chat"]["id"])
        text = data["message"]["text"].strip()

        # Защита: слушать только ваш CHAT_ID
        if chat_id != str(CHAT_ID):
            return '', 200

        try:
            sheet = get_sheet_snapshot()

            # Команда /cancel сбрасывает ожидание ввода
            if text == "/cancel":
                user_states.pop(chat_id, None)
                msg, kb = build_main_menu()
                send_tg_message(chat_id, "Действие отменено.\n\n" + msg, reply_markup=kb)
                return '', 200

            # Команды старта / вызова меню
            if text in ["/start", "/menu", "меню", "Меню"]:
                user_states.pop(chat_id, None)
                msg, kb = build_main_menu()
                send_tg_message(chat_id, msg, reply_markup=kb)
                return '', 200

            # Проверка, ждал ли бот текстовый ввод от пользователя
            state = user_states.get(chat_id)
            if state:
                state_ts = state.get("ts", 0)
                if state_ts and (time.time() - state_ts > USER_STATE_TTL_SECONDS):
                    user_states.pop(chat_id, None)
                    msg, kb = build_main_menu()
                    send_tg_message(
                        chat_id,
                        "⌛ <b>Время ожидания ввода истекло.</b>\nПожалуйста, начните действие заново.\n\n" + msg,
                        reply_markup=kb
                    )
                    return '', 200

                action = state.get("action")

                # Обработка ввода оплаты
                if action == "await_pay":
                    obj_id = state.get("obj_id")
                    cell = find_object_cell(sheet, obj_id)
                    if not cell:
                        user_states.pop(chat_id, None)
                        send_tg_message(chat_id, f"⚠️ Объект №{html.escape(str(obj_id))} не найден.")
                        return '', 200

                    raw_text = text.strip()
                    cleaned = re.sub(r"(?i)\s*(₽|руб\.?|р\.?)$", "", raw_text).strip()
                    is_exact = cleaned.startswith("=")
                    num_part = cleaned[1:].strip() if is_exact else cleaned
                    num_clean = num_part.replace(" ", "")

                    if not num_clean.isdigit():
                        prompt_text = (
                            f"⚠️ <b>Не понял сумму оплаты:</b> <code>{html.escape(raw_text)}</code>\n\n"
                            "Пожалуйста, пришлите число цифрами:\n"
                            "• Чтобы <b>прибавить</b>: <code>50000</code> или <code>50 000 ₽</code>\n"
                            "• Чтобы <b>установить точно</b>: <code>=120000</code>\n\n"
                            "Для отмены отправьте /cancel"
                        )
                        user_states[chat_id] = {"action": "await_pay", "obj_id": obj_id, "ts": time.time()}
                        cancel_kb = {"inline_keyboard": [[{"text": "« Назад к объекту", "callback_data": f"o:v:{obj_id}"}]]}
                        send_tg_message(chat_id, prompt_text, reply_markup=cancel_kb)
                        return '', 200

                    parsed_sum = int(num_clean)
                    if not is_exact and parsed_sum == 0:
                        prompt_text = (
                            "⚠️ <b>Сумма для прибавления равна 0.</b>\n"
                            "Если вы хотите установить точную сумму или обнулить её, используйте знак равно: <code>=0</code>.\n\n"
                            "Для отмены отправьте /cancel"
                        )
                        user_states[chat_id] = {"action": "await_pay", "obj_id": obj_id, "ts": time.time()}
                        cancel_kb = {"inline_keyboard": [[{"text": "« Назад к объекту", "callback_data": f"o:v:{obj_id}"}]]}
                        send_tg_message(chat_id, prompt_text, reply_markup=cancel_kb)
                        return '', 200

                    # Сумма корректна — сбрасываем состояние и обновляем таблицу
                    user_states.pop(chat_id, None)

                    current_paid_str = sheet.cell(cell.row, COLUMNS_MAP['paid']).value or "0"
                    current_paid_clean = int("".join(c for c in current_paid_str if c.isdigit()) or 0)

                    if is_exact:
                        new_paid = parsed_sum
                    else:
                        new_paid = current_paid_clean + parsed_sum

                    formatted_paid = f"{new_paid:,} ₽".replace(",", " ")
                    sheet.update_cell(cell.row, COLUMNS_MAP['paid'], formatted_paid)

                    view_text, kb = build_object_view(sheet, obj_id)
                    send_tg_message(chat_id, f"✅ <b>Оплата сохранена: {formatted_paid}</b>\n\n" + view_text, reply_markup=kb)
                    return '', 200

                # Обработка создания нового объекта
                elif action == "await_new":
                    parts = [p.strip() for p in text.split(",", 1)]
                    new_id = parts[0]
                    new_addr = parts[1] if len(parts) > 1 else f"Объект №{new_id}"

                    if not re.match(r"^\d{1,6}$", new_id):
                        send_tg_message(
                            chat_id,
                            "⚠️ <b>Некорректный номер объекта:</b> <code>" + html.escape(new_id) + "</code>\n\n"
                            "Номер должен состоять только из цифр (от 1 до 6 знаков), например: <code>142</code> или <code>142, Ленина 10</code>."
                        )
                        return '', 200

                    user_states.pop(chat_id, None)

                    if find_object_cell(sheet, new_id):
                        send_tg_message(chat_id, f"⚠️ Объект №{html.escape(new_id)} уже существует в таблице.")
                        return '', 200

                    token = secrets.token_urlsafe(16)
                    sheet.append_row([str(new_id), "0", "Завоз материалов", "0 ₽", "0 ₽", new_addr, "", token])
                    view_text, kb = build_object_view(sheet, new_id)
                    send_tg_message(chat_id, f"🎉 <b>Объект №{html.escape(new_id)} успешно создан!</b>\n\n" + view_text, reply_markup=kb)
                    return '', 200

            # Резервная совместимость: КОМАНДА /new 142
            if text.startswith('/new '):
                parts = text.split(' ', 1)
                obj_id = parts[1].strip()

                if not re.match(r"^\d{1,6}$", obj_id):
                    send_tg_message(
                        chat_id,
                        "⚠️ <b>Некорректный номер объекта.</b>\n"
                        "Номер должен состоять только из цифр (от 1 до 6 знаков), например: <code>/new 142</code>"
                    )
                    return '', 200

                if find_object_cell(sheet, obj_id):
                    send_tg_message(chat_id, f"⚠️ Объект {html.escape(obj_id)} уже существует в таблице.")
                    return '', 200

                token = secrets.token_urlsafe(16)
                sheet.append_row([obj_id, "0", "Завоз материалов", "0 ₽", "0 ₽", f"Объект №{obj_id}", "", token])
                view_text, kb = build_object_view(sheet, obj_id)
                send_tg_message(chat_id, f"✅ <b>Объект {html.escape(obj_id)} создан!</b>\n\n" + view_text, reply_markup=kb)
                return '', 200

            # Резервная совместимость: КОМАНДА /update 142 progress 40
            elif text.startswith('/update '):
                parts = text.split(' ', 3)
                if len(parts) >= 4:
                    obj_id = parts[1].strip()
                    field = parts[2].strip().lower()
                    value = parts[3].strip()

                    if not re.match(r"^\d{1,6}$", obj_id):
                        send_tg_message(chat_id, "⚠️ Некорректный номер объекта.")
                        return '', 200

                    if field not in COLUMNS_MAP:
                        send_tg_message(chat_id, f"⚠️ Неизвестное поле <code>{html.escape(field)}</code>.\nДоступные поля: progress, stage, total, paid, address, photo")
                        return '', 200

                    cell = find_object_cell(sheet, obj_id)
                    if cell:
                        sheet.update_cell(cell.row, COLUMNS_MAP[field], value)
                        view_text, kb = build_object_view(sheet, obj_id)
                        send_tg_message(chat_id, f"✅ Обновлено!\n\n" + view_text, reply_markup=kb)
                    else:
                        send_tg_message(chat_id, f"⚠️ Ошибка: Объект {html.escape(obj_id)} не найден.")
                return '', 200

            # Если пришло любое другое сообщение — присылаем главное меню
            msg, kb = build_main_menu()
            send_tg_message(chat_id, msg, reply_markup=kb)

        except Exception as e:
            app.logger.error(f"Ошибка вебхука Telegram: {e}")
            send_tg_message(chat_id, "💥 Ошибка сервера при работе с таблицей")

    return '', 200

if __name__ == "__main__":
    # В продакшене запускать через Gunicorn: gunicorn -w 1 -k gthread --threads 8 server:app
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)