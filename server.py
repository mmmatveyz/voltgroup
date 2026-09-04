from flask import Flask, request, jsonify
import requests
import os
import json
import html
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
if not os.path.exists('logs'):
    os.mkdir('logs')

file_handler = RotatingFileHandler('logs/app.log', maxBytes=10240000, backupCount=5)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
file_handler.setLevel(logging.INFO)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)
app.logger.info('VoltGroup Server Startup')

# ----------------------------------------------------
# 2. ОГРАНИЧЕНИЕ CORS И RATE LIMITING
# ----------------------------------------------------
ALLOWED_ORIGINS = [
    "https://voltgroup-spb.ru",
    "https://www.voltgroup-spb.ru"
]

CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}})

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# ----------------------------------------------------
# 3. SECURITY HEADERS (Заголовки безопасности)
# ----------------------------------------------------
@app.after_request
def set_security_headers(response):
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-XSS-Protection'] = '1; mode=block'
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
    'photo': 7
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

STAGES = [
    "Завоз материалов",
    "Штробление и кабель",
    "Сборка электрощита",
    "Чистовой монтаж",
    "Сдача объекта / Акт"
]

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

def build_objects_list(ws):
    try:
        rows = ws.get_all_values()
    except Exception as e:
        app.logger.error(f"Ошибка получения списка: {e}")
        rows = []

    buttons = []
    # Начиная со строки 2 (индекс 1)
    if len(rows) > 1:
        for row in rows[1:]:
            if row and row[0].strip():
                obj_id = row[0].strip()
                addr = row[5].strip() if len(row) > 5 and row[5].strip() else f"Объект №{obj_id}"
                progress = row[1].strip() if len(row) > 1 and row[1].strip() else "0"
                short_addr = (addr[:20] + '…') if len(addr) > 20 else addr
                label = f"№{obj_id} · {short_addr} ({progress}%)"
                buttons.append([{"text": label, "callback_data": f"o:v:{obj_id}"}])

    buttons.append([{"text": "➕ Добавить новый", "callback_data": "m:new"}])
    buttons.append([{"text": "« Главное меню", "callback_data": "m:main"}])

    count = len(buttons) - 2
    text = f"📋 <b>Список объектов VoltGroup</b> (Всего: {count}):\n\nВыберите объект для управления:"
    return text, {"inline_keyboard": buttons}

def build_object_view(ws, obj_id):
    cell = ws.find(str(obj_id), in_column=1)
    if not cell:
        return f"⚠️ Объект №{html.escape(str(obj_id))} не найден в таблице.", {
            "inline_keyboard": [[{"text": "« К списку объектов", "callback_data": "m:list"}]]
        }

    vals = ws.row_values(cell.row)
    while len(vals) < 7:
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

@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({"status": "awake"}), 200

@app.route('/send-message', methods=['POST'])
@limiter.limit("5 per minute")  # Ограничение: не более 5 заявок в минуту с одного IP
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
@limiter.limit("15 per minute")
def get_status():
    # Безопасное получение ID из POST (JSON body) или GET (query param)
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        obj_id = data.get('id')
    else:
        obj_id = request.args.get('id')

    if not obj_id:
        return jsonify({"status": "error", "msg": "ID объекта не указан"}), 400

    try:
        ws = get_sheet()
        cell = ws.find(str(obj_id), in_column=1)
        if cell:
            row_values = ws.row_values(cell.row)
            while len(row_values) < 7:
                row_values.append("")

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
@limiter.limit("60 per minute")
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
            ws = get_sheet()

            # Главное меню
            if cb_data == "m:main":
                user_states.pop(chat_id, None)
                text, kb = build_main_menu()
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Список объектов
            elif cb_data == "m:list":
                user_states.pop(chat_id, None)
                text, kb = build_objects_list(ws)
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Запрос на создание нового объекта
            elif cb_data == "m:new":
                user_states[chat_id] = {"action": "await_new"}
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
                text, kb = build_object_view(ws, obj_id)
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
                cell = ws.find(str(obj_id), in_column=1)
                if cell:
                    ws.update_cell(cell.row, COLUMNS_MAP['progress'], val)
                text, kb = build_object_view(ws, obj_id)
                text = f"✅ <i>Прогресс обновлён на {val}%!</i>\n\n" + text
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
                idx = int(parts[3])
                if 0 <= idx < len(STAGES):
                    stage_name = STAGES[idx]
                    cell = ws.find(str(obj_id), in_column=1)
                    if cell:
                        ws.update_cell(cell.row, COLUMNS_MAP['stage'], stage_name)
                text, kb = build_object_view(ws, obj_id)
                text = f"✅ <i>Этап изменён на «{stage_name}»!</i>\n\n" + text
                edit_tg_message(chat_id, msg_id, text, reply_markup=kb)

            # Запрос ввода оплаты (o:pay:<id>)
            elif cb_data.startswith("o:pay:"):
                obj_id = cb_data.split(":", 2)[2]
                user_states[chat_id] = {"action": "await_pay", "obj_id": obj_id}
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
                cell = ws.find(str(obj_id), in_column=1)
                addr_text = f"по объекту №{obj_id}"
                if cell:
                    row_vals = ws.row_values(cell.row)
                    if len(row_vals) > 5 and row_vals[5].strip():
                        addr_text = f"({row_vals[5].strip()})"

                client_msg = (
                    f"Здравствуйте! Вы можете отслеживать ход электромонтажных работ, этапы и финансовый баланс онлайн {html.escape(addr_text)}:\n\n"
                    f"👉 https://voltgroup-spb.ru/client/index.html?id={obj_id}\n\n"
                    f"VoltGroup · Электромонтаж и автоматизация"
                )
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
            ws = get_sheet()

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
                action = state.get("action")

                # Обработка ввода оплаты
                if action == "await_pay":
                    obj_id = state.get("obj_id")
                    user_states.pop(chat_id, None)
                    cell = ws.find(str(obj_id), in_column=1)
                    if not cell:
                        send_tg_message(chat_id, f"⚠️ Объект №{obj_id} не найден.")
                        return '', 200

                    current_paid_str = ws.cell(cell.row, COLUMNS_MAP['paid']).value or "0"
                    current_paid_clean = int("".join(c for c in current_paid_str if c.isdigit()) or 0)

                    input_val = text.replace(" ", "").replace("₽", "")
                    if input_val.startswith("="):
                        new_paid = int("".join(c for c in input_val if c.isdigit()) or 0)
                    else:
                        add_sum = int("".join(c for c in input_val if c.isdigit()) or 0)
                        new_paid = current_paid_clean + add_sum

                    formatted_paid = f"{new_paid:,} ₽".replace(",", " ")
                    ws.update_cell(cell.row, COLUMNS_MAP['paid'], formatted_paid)

                    view_text, kb = build_object_view(ws, obj_id)
                    send_tg_message(chat_id, f"✅ <b>Оплата сохранена: {formatted_paid}</b>\n\n" + view_text, reply_markup=kb)
                    return '', 200

                # Обработка создания нового объекта
                elif action == "await_new":
                    user_states.pop(chat_id, None)
                    parts = [p.strip() for p in text.split(",", 1)]
                    new_id = parts[0]
                    new_addr = parts[1] if len(parts) > 1 else f"Объект №{new_id}"

                    if ws.find(str(new_id), in_column=1):
                        send_tg_message(chat_id, f"⚠️ Объект №{html.escape(new_id)} уже существует в таблице.")
                        return '', 200

                    ws.append_row([str(new_id), "0", "Завоз материалов", "0 ₽", "0 ₽", new_addr])
                    view_text, kb = build_object_view(ws, new_id)
                    send_tg_message(chat_id, f"🎉 <b>Объект №{html.escape(new_id)} успешно создан!</b>\n\n" + view_text, reply_markup=kb)
                    return '', 200

            # Резервная совместимость: КОМАНДА /new 142
            if text.startswith('/new '):
                parts = text.split(' ', 1)
                obj_id = parts[1].strip()

                if ws.find(obj_id, in_column=1):
                    send_tg_message(chat_id, f"⚠️ Объект {html.escape(obj_id)} уже существует в таблице.")
                    return '', 200

                ws.append_row([obj_id, "0", "Завоз материалов", "0 ₽", "0 ₽", f"Объект №{obj_id}"])
                view_text, kb = build_object_view(ws, obj_id)
                send_tg_message(chat_id, f"✅ <b>Объект {html.escape(obj_id)} создан!</b>\n\n" + view_text, reply_markup=kb)
                return '', 200

            # Резервная совместимость: КОМАНДА /update 142 progress 40
            elif text.startswith('/update '):
                parts = text.split(' ', 3)
                if len(parts) >= 4:
                    obj_id = parts[1].strip()
                    field = parts[2].strip().lower()
                    value = parts[3].strip()

                    if field not in COLUMNS_MAP:
                        send_tg_message(chat_id, f"⚠️ Неизвестное поле <code>{html.escape(field)}</code>.\nДоступные поля: progress, stage, total, paid, address, photo")
                        return '', 200

                    cell = ws.find(obj_id, in_column=1)
                    if cell:
                        ws.update_cell(cell.row, COLUMNS_MAP[field], value)
                        view_text, kb = build_object_view(ws, obj_id)
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
    # В продакшене запускать через Gunicorn / uWSGI
    app.run(host='127.0.0.1', port=8000, debug=False)