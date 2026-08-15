from flask import Flask, request, jsonify
import requests
import os
import json
import logging
from logging.handlers import RotatingFileHandler
import gspread
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)

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

COLUMNS_MAP = {
    'progress': 2,
    'stage': 3,
    'total': 4,
    'paid': 5,
    'address': 6,
    'photo': 7
}

def get_sheet():
    """Подключается к Google Таблице по ключу из переменных окружения"""
    creds_json = os.environ.get('GOOGLE_CREDENTIALS')
    if not creds_json or not SHEET_URL:
        raise ValueError("Не настроены переменные GOOGLE_CREDENTIALS или SHEET_URL")

    creds_dict = json.loads(creds_json)
    gc = gspread.service_account_from_dict(creds_dict)
    sh = gc.open_by_url(SHEET_URL)
    return sh.sheet1

def send_tg_message(chat_id, text):
    """Отправляет сообщение в Telegram"""
    if not BOT_TOKEN:
        app.logger.error("BOT_TOKEN не задан")
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}, timeout=5)
    except Exception as e:
        app.logger.error(f"Ошибка отправки сообщения в Telegram: {e}")

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

        text = f"⚡️ *Новая заявка!*\n\n👤 Имя: {name}\n📞 Телефон: {phone}\n🛠 Задача: {service}\n📍 Источник: `{source}`"
        send_tg_message(CHAT_ID, text)
        return jsonify({"status": "success"}), 200
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
@limiter.limit("30 per minute")
def webhook():
    """Слушает команды из Telegram и записывает их в Google Таблицу"""
    data = request.get_json(silent=True) or {}

    if "message" in data and "text" in data["message"]:
        chat_id = str(data["message"]["chat"]["id"])
        text = data["message"]["text"].strip()

        # Защита: слушать только ваш CHAT_ID
        if chat_id != str(CHAT_ID):
            return '', 200

        try:
            ws = get_sheet()

            # КОМАНДА: Создать новый объект (/new 142)
            if text.startswith('/new '):
                parts = text.split(' ', 1)
                obj_id = parts[1].strip()

                if ws.find(obj_id, in_column=1):
                    send_tg_message(chat_id, f"⚠️ Объект {obj_id} уже существует в таблице.")
                    return '', 200

                ws.append_row([obj_id, "0", "Завоз материалов", "0 ₽", "0 ₽", f"Объект №{obj_id}"])

                reply = f"✅ *Объект {obj_id} создан в Google Таблице!*\n\n🔗 Ссылка для клиента:\nhttps://voltgroup-spb.ru/client/index.html?id={obj_id}"
                send_tg_message(chat_id, reply)

            # КОМАНДА: Обновить объект (/update 142 progress 40)
            elif text.startswith('/update '):
                parts = text.split(' ', 3)
                if len(parts) >= 4:
                    obj_id = parts[1].strip()
                    field = parts[2].strip().lower()
                    value = parts[3].strip()

                    if field not in COLUMNS_MAP:
                        send_tg_message(chat_id, f"⚠️ Неизвестное поле `{field}`.\nДоступные поля: progress, stage, total, paid, address, photo")
                        return '', 200

                    cell = ws.find(obj_id, in_column=1)
                    if cell:
                        ws.update_cell(cell.row, COLUMNS_MAP[field], value)
                        send_tg_message(chat_id, f"✅ Таблица обновлена!\nОбъект: {obj_id}\nПоле `{field}` изменено на `{value}`.")
                    else:
                        send_tg_message(chat_id, f"⚠️ Ошибка: Объект {obj_id} не найден.")

        except Exception as e:
            app.logger.error(f"Ошибка вебхука Telegram: {e}")
            send_tg_message(chat_id, f"💥 Ошибка сервера при работе с таблицей")

    return '', 200

if __name__ == "__main__":
    # В продакшене запускать через Gunicorn / uWSGI
    app.run(host='127.0.0.1', port=8000, debug=False)