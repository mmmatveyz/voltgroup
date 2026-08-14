from flask import Flask, request, jsonify
import requests
import os
import time
import traceback
import json
import gspread
from functools import wraps
from collections import defaultdict
import threading

app = Flask(__name__)

# --- RATE LIMITING (защита от спама) ---
# Ограничение: не более 5 запросов в минуту с одного IP для /send-message
rate_limit_store = defaultdict(list)
rate_limit_lock = threading.Lock()
RATE_LIMIT_WINDOW = 60  # окно в секундах
RATE_LIMIT_MAX_REQUESTS = 5  # макс. запросов в окно

def rate_limit(max_requests=RATE_LIMIT_MAX_REQUESTS, window=RATE_LIMIT_WINDOW):
    """Декоратор для ограничения частоты запросов"""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            ip = request.remote_addr or 'unknown'
            current_time = time.time()
            
            with rate_limit_lock:
                # Очищаем старые записи за пределами окна
                rate_limit_store[ip] = [t for t in rate_limit_store[ip] if current_time - t < window]
                
                # Проверяем лимит
                if len(rate_limit_store[ip]) >= max_requests:
                    return jsonify({
                        "status": "error",
                        "msg": f"Слишком много запросов. Попробуйте через {window} секунд."
                    }), 429
                
                # Записываем текущий запрос
                rate_limit_store[ip].append(current_time)
            
            return f(*args, **kwargs)
        return wrapped
    return decorator

# --- ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
BOT_TOKEN = os.environ.get('BOT_TOKEN')
CHAT_ID = os.environ.get('CHAT_ID')
SHEET_URL = os.environ.get('SHEET_URL')  # Ссылка на вашу Google Таблицу

# Карта колонок в нашей таблице:
# Карта колонок: 1=ID, 2=progress, 3=stage, 4=total, 5=paid, 6=address, 7=photo
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

    # Загружаем ключи из JSON-строки
    creds_dict = json.loads(creds_json)
    gc = gspread.service_account_from_dict(creds_dict)
    sh = gc.open_by_url(SHEET_URL)
    return sh.sheet1

def send_tg_message(chat_id, text):
    """Отправляет сообщение в Telegram"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})

@app.after_request
def after_request(response):
    # Ограничиваем CORS только доверенным доменом
    response.headers.add('Access-Control-Allow-Origin', 'https://voltgroup-spb.ru')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    # Security-заголовки для защиты от атак
    response.headers.add('X-Frame-Options', 'DENY')  # Защита от clickjacking
    response.headers.add('X-Content-Type-Options', 'nosniff')  # Запрет MIME-sniffing
    response.headers.add('X-XSS-Protection', '1; mode=block')  # XSS-фильтр браузера
    response.headers.add('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')  # HSTS
    return response

# --- 1. МАРШРУТЫ ДЛЯ САЙТА ---

@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({"status": "awake"}), 200

@app.route('/send-message', methods=['POST', 'OPTIONS'])
@rate_limit(max_requests=5, window=60)  # Не более 5 запросов в минуту с одного IP
def send_message():
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.json
        name = data.get('name', 'Не указано')
        phone = data.get('phone', 'Не указано')
        service = data.get('service', 'Не указано')
        source = data.get('source', 'Неизвестная страница')

        text = f"⚡️ *Новая заявка!*\n\n👤 Имя: {name}\n📞 Телефон: {phone}\n🛠 Задача: {service}\n📍 Источник: `{source}`"
        send_tg_message(CHAT_ID, text)
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/get-status', methods=['GET'])
def get_status():
    obj_id = request.args.get('id')
    try:
        ws = get_sheet()
        cell = ws.find(obj_id, in_column=1)
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
        print(f"Ошибка чтения таблицы: {e}")
        return jsonify({"status": "error", "msg": "Ошибка сервера"}), 500


# --- 2. МАРШРУТ ДЛЯ ТЕЛЕГРАМ БОТА (ВЕБХУК) ---

@app.route('/webhook', methods=['POST'])
def webhook():
    """Слушает команды из Telegram и записывает их в Google Таблицу"""
    data = request.json

    if "message" in data and "text" in data["message"]:
        chat_id = str(data["message"]["chat"]["id"])
        text = data["message"]["text"].strip()

        # Защита: слушать только вас
        if chat_id != str(CHAT_ID):
            return '', 200

        try:
            ws = get_sheet()

            # КОМАНДА: Создать новый объект (/new 142)
            if text.startswith('/new '):
                parts = text.split(' ', 1)
                obj_id = parts[1].strip()

                # Проверяем, нет ли уже такого ID
                if ws.find(obj_id, in_column=1):
                    send_tg_message(chat_id, f"⚠️ Объект {obj_id} уже существует в таблице.")
                    return '', 200

                # Добавляем новую строку в конец таблицы
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
                        send_tg_message(chat_id, f"⚠️ Неизвестное поле `{field}`.\nДоступные поля: progress, stage, total, paid, address")
                        return '', 200

                    cell = ws.find(obj_id, in_column=1)
                    if cell:
                        # Обновляем конкретную ячейку
                        ws.update_cell(cell.row, COLUMNS_MAP[field], value)
                        send_tg_message(chat_id, f"✅ Таблица обновлена!\nОбъект: {obj_id}\nПоле `{field}` изменено на `{value}`.")
                    else:
                        send_tg_message(chat_id, f"⚠️ Ошибка: Объект {obj_id} не найден.")

        except Exception as e:
            send_tg_message(chat_id, f"💥 Ошибка сервера при работе с таблицей: {e}")

    return '', 200

if __name__ == "__main__":
    # ВНИМАНИЕ: debug=False обязателен в продакшене!
    # Для локальной разработки можно установить debug=True
    app.run(debug=False, port=8000)