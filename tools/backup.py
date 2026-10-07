#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/backup.py — Автономный скрипт резервного копирования Google Таблицы VoltGroup.
Задача 033 (пункт № 34 AUDIT.md).

Функционал:
1. Чтение всех данных sheet1 через сервисный аккаунт (GOOGLE_CREDENTIALS, SHEET_URL).
2. Сохранение снимка в формате JSON и CSV с временной меткой в имени файла (backups/backup_YYYYMMDD_HHMMSS.{json,csv}).
3. Ротация локальных архивов: сохранение последних 30 снимков, автоматическое удаление более старых.
4. Отправка уведомлений в Telegram администратору:
   - При сбое (неверные credentials, ошибка сети, пустая таблица) — алерт с описанием ошибки.
   - Опционально при успехе (флаг --notify-success).
5. Коды возврата: 0 — успех, 1 — сбой.
"""

import os
import sys
import json
import csv
import glob
import time
from datetime import datetime
from pathlib import Path

# Корень проекта
BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"
MAX_BACKUPS_TO_KEEP = 30

def notify_backup_status(is_error, message, details=None):
    """
    Отправляет уведомление в Telegram администратору о статусе резервного копирования.
    Не раскрывает пути и секреты.
    """
    bot_token = os.environ.get("BOT_TOKEN")
    chat_id = os.environ.get("CHAT_ID")
    if not bot_token or not chat_id:
        return False

    try:
        import requests
        import html

        time_str = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        if is_error:
            lines = [
                "🚨 <b>Сбой резервного копирования VoltGroup</b>\n",
                f"<b>Причина:</b> {html.escape(str(message))}",
                f"<b>Время:</b> {time_str}"
            ]
            if details:
                lines.append(f"<b>Детали:</b> <code>{html.escape(str(details)[:150])}</code>")
        else:
            lines = [
                "💾 <b>Резервное копирование VoltGroup успешно</b>\n",
                f"<b>Результат:</b> {html.escape(str(message))}",
                f"<b>Время:</b> {time_str}"
            ]

        text = "\n".join(lines)
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        requests.post(url, json=payload, timeout=10)
        return True
    except Exception as e:
        print(f"[!] Ошибка отправки уведомления в Telegram: {e}", file=sys.stderr)
        return False

def rotate_backups(backup_dir=BACKUP_DIR, max_keep=MAX_BACKUPS_TO_KEEP):
    """Удаляет старые бэкапы, оставляя только max_keep самых свежих пар/файлов"""
    if not os.path.exists(backup_dir):
        return 0

    json_files = sorted(glob.glob(str(Path(backup_dir) / "backup_*.json")), key=os.path.getmtime)
    csv_files = sorted(glob.glob(str(Path(backup_dir) / "backup_*.csv")), key=os.path.getmtime)

    deleted_count = 0
    if len(json_files) > max_keep:
        for f in json_files[:-max_keep]:
            try:
                os.remove(f)
                deleted_count += 1
            except OSError:
                pass

    if len(csv_files) > max_keep:
        for f in csv_files[:-max_keep]:
            try:
                os.remove(f)
                deleted_count += 1
            except OSError:
                pass

    return deleted_count

def save_snapshot_data(rows, backup_dir=BACKUP_DIR, timestamp_str=None):
    """
    Сохраняет матрицу строк таблицы в CSV и JSON.
    Возвращает словарь с путями сохраненных файлов.
    """
    if not timestamp_str:
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")

    os.makedirs(backup_dir, exist_ok=True)
    json_path = Path(backup_dir) / f"backup_{timestamp_str}.json"
    csv_path = Path(backup_dir) / f"backup_{timestamp_str}.csv"

    # 1. Сохранение JSON
    snapshot_meta = {
        "timestamp": datetime.now().isoformat(),
        "created_at": datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
        "rows_count": len(rows),
        "data": rows
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(snapshot_meta, f, ensure_ascii=False, indent=2)

    # 2. Сохранение CSV (с экранированием)
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        for row in rows:
            writer.writerow(row)

    return {
        "json": str(json_path),
        "csv": str(csv_path),
        "rows_count": len(rows),
        "timestamp": timestamp_str
    }

def perform_backup(notify_on_success=False):
    """
    Выполняет выгрузку из Google Таблицы и сохраняет файлы бэкапа.
    """
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    sheet_url = os.environ.get("SHEET_URL")

    if not creds_json or not sheet_url:
        err = "Отсутствуют переменные окружения GOOGLE_CREDENTIALS или SHEET_URL"
        print(f"[ERROR] {err}", file=sys.stderr)
        notify_backup_status(is_error=True, message=err)
        return False

    try:
        import gspread

        creds_dict = json.loads(creds_json)
        gc = gspread.service_account_from_dict(creds_dict)
        sh = gc.open_by_url(sheet_url)
        ws = sh.sheet1
        rows = ws.get_all_values()

        if not rows:
            err = "Таблица Google Sheets вернула пустой список строк"
            print(f"[ERROR] {err}", file=sys.stderr)
            notify_backup_status(is_error=True, message=err)
            return False

        saved = save_snapshot_data(rows)
        rotated = rotate_backups()

        summary = f"Сохранено {saved['rows_count']} строк (JSON и CSV). Удалено старых копий: {rotated}"
        print(f"[OK] Резервное копирование успешно выполнено: {summary}")

        if notify_on_success:
            notify_backup_status(is_error=False, message=summary)

        return True

    except Exception as e:
        err_type = type(e).__name__
        err_msg = str(e)
        print(f"[ERROR] Ошибка выполнения бэкапа: {err_type}: {err_msg}", file=sys.stderr)
        notify_backup_status(is_error=True, message=f"{err_type}: сбой чтения/сохранения", details=err_msg)
        return False

def main():
    notify_success = "--notify-success" in sys.argv
    success = perform_backup(notify_on_success=notify_success)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
