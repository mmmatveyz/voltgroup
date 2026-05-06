from flask import Flask, request, jsonify
import requests
import os
import time
import traceback

app = Flask(__name__)

# Получаем данные из переменных окружения (безопасно!)
# Если переменная не задана, используем значения по умолчанию (для тестов)
BOT_TOKEN = os.environ.get('BOT_TOKEN', '8188401835:AAGm4-L6jMd-dbx0r2_tI1HAIByceqfi-Ys')
CHAT_ID = os.environ.get('CHAT_ID', '351100092')

@app.after_request
def after_request(response):
    # Разрешаем CORS для твоего сайта на GitHub Pages
    response.headers.add('Access-Control-Allow-Origin', 'https://mmmatveyz.github.io')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/send-message', methods=['POST', 'OPTIONS'])
def send_message():
    # Обрабатываем preflight-запрос от браузера
    if request.method == 'OPTIONS':
        return '', 200

    try:
        data = request.json
        print(f"📩 Получены данные: {data}")

        name = data.get('name', 'Не указано')
        phone = data.get('phone', 'Не указано')
        service = data.get('service', 'Не указано')
        comment = data.get('comment', 'Нет')

        text = f"""
⚡️ *Новая заявка с сайта VoltGroup!*

👤 *Имя:* {name}
📞 *Телефон:* {phone}
🛠 *Задача:* {service}
💬 *Комментарий:* {comment}
        """

        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": CHAT_ID,
            "text": text,
            "parse_mode": "Markdown"
        }

        # Логика повторных попыток (Retry) для надежности
        max_retries = 3
        last_error = None

        for attempt in range(max_retries):
            try:
                print(f"🚀 Попытка #{attempt + 1} отправить в Telegram...")
                response_tg = requests.post(url, json=payload, timeout=10)

                if response_tg.status_code == 200:
                    print(f"✅ Успешно отправлено с попытки #{attempt + 1}")
                    return jsonify({"status": "success"}), 200
                else:
                    print(f"⚠️ Telegram вернул код {response_tg.status_code}")
                    last_error = response_tg.text
                    break # Если ошибка от самого Телеграма, повторять нет смысла

            except requests.exceptions.RequestException as e:
                print(f"⚠️ Ошибка сети (попытка {attempt + 1}): {e}")
                last_error = str(e)
                if attempt == max_retries - 1:
                    raise
                time.sleep(2) # Ждем перед следующей попыткой

        raise Exception(f"Не удалось отправить после {max_retries} попыток. Ошибка: {last_error}")

    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"💥 КРИТИЧЕСКАЯ ОШИБКА: {str(e)}")
        print(error_trace)
        return jsonify({"status": "error", "msg": str(e)}), 500

if __name__ == "__main__":
    # Для локального запуска
    app.run(debug=True, port=8000)