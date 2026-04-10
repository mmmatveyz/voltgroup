# VoltGroup Website

Профессиональный сайт для электромонтажных услуг в Санкт-Петербурге.

## 📦 Структура
- `index.html` — главная страница
- `privacy.html` — политика конфиденциальности
- `offer.html` — публичная оферта
- `cookies.html` — политика cookies
- `gallery/` — папка с фото и конфигом галереи
- `robots.txt` — для поисковиков
- `sitemap.xml` — карта сайта

## 🚀 Быстрый старт

1. Замени в `index.html`:
    - `[Фамилия Имя Отчество]` → твои данные
    - `[Ваш ИНН]` → твой ИНН
    - `+79990000000` → твой телефон
    - `ВАШ_ID` в JavaScript → ID формы Formspree

2. Зарегистрируйся на [formspree.io](https://formspree.io) и создай форму

3. Загрузи фото в папку `gallery/`

4. Отредактируй `gallery/gallery-config.json` под свои работы

5. Загрузи всё на хостинг (Netlify/Beget/GitHub Pages)

6. Подключи домен `voltgroup-spb.ru`

## 📸 Как добавить фото в галерею

1. Сохрани фото в папку `gallery/` (например, `my-work-01.jpg`)
2. Открой `gallery/gallery-config.json`
3. Добавь новую запись:
```json
{
  "image": "gallery/my-work-01.jpg",
  "title": "Название работы",
  "description": "Описание",
  "badges": ["Тег 1", "Тег 2"]
}