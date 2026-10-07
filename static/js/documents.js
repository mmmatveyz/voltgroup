/**
 * static/js/documents.js
 * Генераторы юридических и расчётных документов VoltGroup:
 * 1. Смета (PDF/печать) - generatePDF()
 * 2. Коммерческое предложение - generateCommercialOffer()
 * 3. Акт сдачи-приёмки работ - generateAct()
 * 4. Договор подряда со Спецификацией - generateContract()
 *
 * Все документы оперируют единой ценой договора (grandTotal) в соответствии с правилами AUDIT.md № 11, 14.
 */

(function (window) {
    'use strict';

    // Реквизиты Исполнителя
    const CONTRACTOR = {
        name: 'Зрячих Матвей Олегович',
        status: 'Плательщик НПД (самозанятый)',
        inn: '591110297727',
        phone: '+7 (905) 208-42-84',
        site: 'voltgroup-spb.ru',
        region: 'Санкт-Петербург и ЛО'
    };

    /**
     * Сбор единого контекста для любого документа
     */
    function getDocContext(defaultPrefix, defaultClient) {
        const totals = typeof window.calculateTotals === 'function'
            ? window.calculateTotals()
            : { servicesTotal: 0, discountAmount: 0, discountPercent: 0, worksFinal: 0, materialsTotal: 0, grandTotal: 0 };

        const esc = window.escapeHtml || (s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');
        const clientNameEl = document.getElementById('client-name');
        const clientAddrEl = document.getElementById('client-address');
        const invoiceNumEl = document.getElementById('invoice-number');
        const dateEl = document.getElementById('estimate-date');
        const masterBuysEl = document.getElementById('master-buys-materials');

        const year = new Date().getFullYear();
        const clientName = esc((clientNameEl?.value || '').trim() || (defaultClient || 'Заказчик'));
        const clientAddr = esc((clientAddrEl?.value || '').trim() || 'г. Санкт-Петербург');
        const invoiceNum = esc((invoiceNumEl?.value || '').trim() || (defaultPrefix ? `${defaultPrefix}-${year}` : `Смета-${year}`));
        const dateRaw = dateEl?.value;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');
        const masterBuys = masterBuysEl ? masterBuysEl.checked : false;

        // Сбор списка выполненных работ
        const works = [];
        if (Array.isArray(window.allServices)) {
            window.allServices.forEach((s, index) => {
                const state = (window.servicesState && window.servicesState[index]) || { qty: 0, isComplex: false };
                if (state.qty > 0) {
                    const price = state.isComplex ? s.price * 1.2 : s.price;
                    works.push({
                        name: esc(s.name),
                        unit: esc(s.unit || 'шт.'),
                        qty: state.qty,
                        price: Math.round(price),
                        sum: Math.round(state.qty * price),
                        isComplex: !!state.isComplex
                    });
                }
            });
        }

        document.querySelectorAll('.custom-work-row').forEach(row => {
            const name = esc((row.querySelector('.name-input')?.value || 'Доп. работа').trim());
            const unit = esc((row.querySelector('.mat-unit')?.value || 'шт.').trim());
            const priceBase = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.custom-qty-input')?.value) || 0;
            const complexCheck = row.querySelector('.custom-complex');
            const isComplex = !!(complexCheck && complexCheck.checked);
            if (qty > 0 || priceBase > 0) {
                const price = isComplex ? priceBase * 1.2 : priceBase;
                works.push({
                    name,
                    unit,
                    qty,
                    price: Math.round(price),
                    sum: Math.round(qty * price),
                    isComplex
                });
            }
        });

        // Сбор списка материалов
        const materials = [];
        document.querySelectorAll('#materials-body tr').forEach(r => {
            const name = esc((r.querySelector('.mat-name')?.value || 'Материал').trim());
            const unit = esc((r.querySelector('.mat-unit')?.value || 'шт.').trim());
            const price = parseFloat(r.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(r.querySelector('.mat-qty')?.value) || 0;
            if (qty > 0 || price > 0) {
                materials.push({
                    name,
                    unit,
                    qty,
                    price: Math.round(price),
                    sum: Math.round(price * qty)
                });
            }
        });

        return {
            contractor: CONTRACTOR,
            totals,
            clientName,
            clientAddr,
            invoiceNum,
            date,
            masterBuys,
            works,
            materials
        };
    }

    /**
     * Формирование HTML строк таблицы работ
     */
    function buildWorksRowsHtml(works, isOffer) {
        let html = '';
        works.forEach((w, idx) => {
            let note = '';
            if (w.isComplex) {
                note = isOffer
                    ? ' <small style="color:#000; font-weight:600;">(коэф. сложности +20%)</small>'
                    : ' (коэф. сложности)';
            }
            const sumWeight = isOffer ? ' font-weight:600;' : '';
            html += `<tr>` +
                `<td style="text-align:center;">${idx + 1}</td>` +
                `<td>${w.name}${note}</td>` +
                `<td style="text-align:center;">${w.unit}</td>` +
                `<td style="text-align:center;">${w.qty}</td>` +
                `<td style="text-align:right;">${w.price.toLocaleString('ru-RU')} ₽</td>` +
                `<td style="text-align:right;${sumWeight}">${w.sum.toLocaleString('ru-RU')} ₽</td>` +
                `</tr>`;
        });
        return html;
    }

    /**
     * Формирование HTML строк таблицы материалов
     */
    function buildMaterialsRowsHtml(materials, isOffer) {
        let html = '';
        materials.forEach((m, idx) => {
            const sumWeight = isOffer ? ' font-weight:600;' : '';
            html += `<tr>` +
                `<td style="text-align:center;">${idx + 1}</td>` +
                `<td>${m.name}</td>` +
                `<td style="text-align:center;">${m.unit}</td>` +
                `<td style="text-align:center;">${m.qty}</td>` +
                `<td style="text-align:right;">${m.price.toLocaleString('ru-RU')} ₽</td>` +
                `<td style="text-align:right;${sumWeight}">${m.sum.toLocaleString('ru-RU')} ₽</td>` +
                `</tr>`;
        });
        return html;
    }

    /**
     * Безопасное открытие окна для печати
     */
    function openPrintWindow(html, alertMsg) {
        const win = window.open('', '_blank');
        if (win) {
            win.document.open();
            win.document.write(html);
            win.document.close();
        } else {
            alert(alertMsg || 'Пожалуйста, разрешите всплывающие окна в браузере для печати документа.');
        }
    }

    /**
     * 1. Генерация Сметы (Печать / PDF)
     */
    function generatePDF() {
        const ctx = getDocContext('Смета', 'Заказчик');
        if (ctx.totals.grandTotal === 0 && ctx.totals.materialsTotal === 0) {
            alert('Добавьте хотя бы одну позицию');
            return;
        }

        const worksHTML = buildWorksRowsHtml(ctx.works, false);
        const materialsHTML = buildMaterialsRowsHtml(ctx.materials, false);
        const toWords = window.numberToWordsRu || (n => String(n));

        const printHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Смета № ${ctx.invoiceNum} - VoltGroup</title>
    <style>
        @page { size: A4 portrait; margin: 8mm 10mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #000 !important; line-height: 1.35; background: #fff; margin: 0; padding: 10px 15px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
        .logo-box { font-size: 16pt; font-weight: 800; color: #000; letter-spacing: -0.5px; }
        .logo-box span { color: #0284c7; }
        @media print { .logo-box span { color: #000; } }
        .tagline { font-size: 8pt; color: #333; margin-top: 2px; }
        .contractor-info { text-align: right; font-size: 8pt; line-height: 1.3; color: #000; }
        .doc-title { text-align: center; margin: 10px 0 8px 0; }
        .doc-title h1 { font-size: 11.5pt; text-transform: uppercase; margin: 0 0 2px 0; font-weight: 800; letter-spacing: 0.5px; color: #000; }
        .doc-title .doc-date { font-size: 8.5pt; color: #333; }
        .client-info { background: #f8fafc; border: 1px solid #000; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; font-size: 8.5pt; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: #000; }
        .table-title { font-weight: 700; font-size: 9pt; margin: 8px 0 4px 0; text-transform: uppercase; letter-spacing: 0.3px; color: #000; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 8.5pt; border: 1px solid #000; }
        th, td { border: 1px solid #000 !important; padding: 4px 6px; color: #000 !important; }
        th { background: #e5e7eb !important; font-weight: 700; color: #000 !important; text-align: center; }
        .totals-card { margin-top: 8px; border-top: 2px solid #000; padding-top: 6px; text-align: right; page-break-inside: avoid; }
        .total-line { display: flex; justify-content: flex-end; gap: 20px; font-size: 8.5pt; margin-bottom: 2px; color: #000; }
        .total-line.discount { color: #000; font-weight: 700; }
        .total-line.grand { font-size: 11.5pt; font-weight: 800; color: #000; margin-top: 4px; border-top: 1px dashed #000; padding-top: 4px; }
        .notes-block { margin-top: 10px; background: #f8fafc; border: 1px solid #666; border-left: 3px solid #000; padding: 6px 10px; font-size: 7.5pt; color: #000; line-height: 1.35; page-break-inside: avoid; }
        .notes-block p { margin: 2px 0; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 14px; font-size: 8.5pt; color: #000; page-break-inside: avoid; }
        .sign-box { line-height: 1.3; }
        .sign-line { margin-top: 20px; border-top: 1px solid #000; padding-top: 2px; font-style: italic; font-size: 8pt; text-align: center; color: #000; }
        .controls { text-align: center; margin-bottom: 12px; padding: 8px; background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 6px; font-family: sans-serif; }
        .btn { padding: 8px 18px; background: #00E5FF; color: #050914; border: 1px solid #00b4d8; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin: 3px; }
        .btn-close { background: #e2e8f0; border-color: #cbd5e1; color: #334155; }
        @media print { .no-print { display: none !important; } body { padding: 0 !important; margin: 0 !important; } }
    </style>
</head>
<body>
    <div class="controls no-print">
        <h3 style="margin: 0 0 6px 0;">📄 Смета готова к печати</h3>
        <button class="btn" onclick="window.print()">🖨 Печать / Сохранить в PDF</button>
        <button class="btn btn-close" onclick="window.close()">Закрыть</button>
    </div>

    <div class="header">
        <div>
            <div class="logo-box">⚡ Volt<span>Group</span></div>
            <div class="tagline">Профессиональный электромонтаж в Санкт-Петербурге и ЛО</div>
        </div>
        <div class="contractor-info">
            <strong>Исполнитель:</strong> ${ctx.contractor.name}<br>
            Статус: ${ctx.contractor.status}<br>
            ИНН: ${ctx.contractor.inn} | Тел: ${ctx.contractor.phone}<br>
            Сайт: ${ctx.contractor.site}
        </div>
    </div>

    <div class="doc-title">
        <h1>СМЕТА НА ЭЛЕКТРОМОНТАЖНЫЕ РАБОТЫ № ${ctx.invoiceNum}</h1>
        <div class="doc-date">от «${ctx.date}» г.</div>
    </div>

    <div class="client-info">
        <div><strong>Заказчик:</strong> ${ctx.clientName}</div>
        <div><strong>Адрес объекта:</strong> ${ctx.clientAddr}</div>
    </div>

    <div class="table-title">1. Электромонтажные работы</div>
    <table>
        <thead>
            <tr>
                <th style="width: 4%;">№</th>
                <th>Наименование работ / услуг</th>
                <th style="width: 8%;">Ед.</th>
                <th style="width: 8%;">Кол-во</th>
                <th style="width: 14%;">Цена, ₽</th>
                <th style="width: 14%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${worksHTML}
        </tbody>
    </table>

    ${materialsHTML ? `
    <div class="table-title">2. Материалы и комплектующие ${ctx.masterBuys ? '(закупка Исполнителем)' : '(обеспечивает Заказчик)'}</div>
    <table>
        <thead>
            <tr>
                <th style="width: 4%;">№</th>
                <th>Наименование материала</th>
                <th style="width: 8%;">Ед.</th>
                <th style="width: 8%;">Кол-во</th>
                <th style="width: 14%;">Цена, ₽</th>
                <th style="width: 14%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${materialsHTML}
        </tbody>
    </table>` : ''}

    <div class="totals-card">
        ${ctx.totals.discountAmount > 0 ? `
        <div class="total-line"><span>Стоимость работ без скидки:</span><span>${ctx.totals.servicesTotal.toLocaleString('ru-RU')} ₽</span></div>
        <div class="total-line discount"><span>Скидка:</span><span>-${ctx.totals.discountAmount.toLocaleString('ru-RU')} ₽</span></div>
        <div class="total-line"><span>Итого за работы:</span><span>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</span></div>
        ` : `
        <div class="total-line"><span>Стоимость работ:</span><span>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</span></div>
        `}
        ${ctx.totals.materialsTotal > 0 ? `<div class="total-line"><span>Материалы:</span><span>${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽${!ctx.masterBuys ? ' (закупка заказчиком)' : ''}</span></div>` : ''}
        <div class="total-line grand"><span>ИТОГО К ОПЛАТЕ:</span><span>${ctx.totals.grandTotal.toLocaleString('ru-RU')} ₽</span></div>
    </div>

    <div class="notes-block">
        <p>• Гарантия на выполненные электромонтажные работы: <strong>12 месяцев</strong> с момента сдачи-приёмки.</p>
        <p>• Работы выполняются в строгом соответствии с Правилами устройства электроустановок (ПУЭ 7-е изд.) и СП 256.1325800.2016.</p>
        <p>• Применяется технология беспылевого штробления с использованием промышленного пылесоса.</p>
        <p>• Оплата производится в соответствии с ФЗ № 422-ФЗ с предоставлением фискального чека из приложения «Мой налог».</p>
    </div>

    <div class="signatures">
        <div class="sign-box">
            <strong>Исполнитель:</strong><br>
            ${ctx.contractor.name}<br>
            ИНН ${ctx.contractor.inn} | VoltGroup
            <div class="sign-line">/ Зрячих М.О. / М.П.</div>
        </div>
        <div class="sign-box" style="text-align: right;">
            <strong>Заказчик:</strong><br>
            ${ctx.clientName}<br>
            ${ctx.clientAddr}
            <div class="sign-line">/ ____________________ /</div>
        </div>
    </div>
</body>
</html>`;

        openPrintWindow(printHTML, 'Пожалуйста, разрешите всплывающие окна для печати сметы.');
    }

    /**
     * 2. Генерация Коммерческого предложения
     */
    function generateCommercialOffer() {
        const ctx = getDocContext('КП', 'Уважаемый Заказчик');
        if (ctx.totals.grandTotal === 0 && ctx.totals.materialsTotal === 0) {
            alert('Добавьте хотя бы одну позицию');
            return;
        }

        const worksHTML = buildWorksRowsHtml(ctx.works, true);
        const materialsHTML = buildMaterialsRowsHtml(ctx.materials, true);

        const offerHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Коммерческое предложение № ${ctx.invoiceNum} - VoltGroup</title>
    <style>
        @page { size: A4 portrait; margin: 8mm 10mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000 !important; max-width: 210mm; margin: 0 auto; padding: 10px 15px; line-height: 1.35; background: #fff; font-size: 8.5pt; }
        .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }
        .logo { font-size: 17pt; font-weight: 800; color: #000; letter-spacing: -0.5px; }
        .logo span { color: #0284c7; }
        @media print { .logo span { color: #000; } }
        .tagline { font-size: 8pt; color: #333; margin-top: 2px; }
        .company-info { text-align: right; font-size: 8pt; color: #000; line-height: 1.3; }
        h1 { font-size: 11.5pt; text-transform: uppercase; margin: 0 0 2px 0; color: #000; border-left: 3px solid #000; padding-left: 6px; font-weight: 800; }
        .subtitle { font-size: 8.5pt; color: #333; margin-bottom: 8px; margin-left: 9px; }
        .client-block { background: #f8fafc; padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; border: 1px solid #000; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 8.5pt; color: #000; }
        .client-block strong { color: #000; }
        .intro-text { font-size: 8.5pt; color: #000; margin-bottom: 8px; line-height: 1.35; }
        .table-title { font-weight: 700; font-size: 9pt; margin: 8px 0 4px 0; text-transform: uppercase; color: #000; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 8.5pt; border: 1px solid #000; }
        th { background: #e5e7eb !important; color: #000000 !important; padding: 5px 6px; text-align: center; font-weight: 700; border: 1px solid #000000 !important; }
        td { border: 1px solid #000000 !important; padding: 4px 6px; color: #000000 !important; }
        tr:nth-child(even) { background-color: #f9fafb; }
        .total-section { margin-top: 8px; text-align: right; page-break-inside: avoid; border-top: 2px solid #000; padding-top: 6px; }
        .total-row { font-size: 8.5pt; margin-bottom: 2px; color: #000; }
        .final-price { font-size: 11.5pt; font-weight: 800; color: #000; margin-top: 4px; }
        .features-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; page-break-inside: avoid; }
        .feature-card { background: #f8fafc; border: 1px solid #666; border-radius: 4px; padding: 5px 8px; font-size: 7.5pt; color: #000; line-height: 1.3; }
        .feature-card strong { color: #000; display: block; margin-bottom: 1px; font-size: 8pt; }
        .terms { margin-top: 8px; font-size: 7.5pt; color: #000; border-top: 1px solid #000; padding-top: 6px; page-break-inside: avoid; }
        .terms h3 { font-size: 8pt; color: #000; margin: 0 0 3px 0; text-transform: uppercase; font-weight: 700; }
        .terms ul { padding-left: 14px; margin: 0; }
        .terms li { margin-bottom: 2px; }
        .signature-block { margin-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #000; page-break-inside: avoid; }
        .sign-col { line-height: 1.3; }
        .sign-line { border-top: 1px solid #000; width: 200px; margin-top: 18px; text-align: center; padding-top: 2px; font-size: 7.5pt; color: #000; }
        .controls { text-align: center; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px; border: 1px dashed #94a3b8; font-family: sans-serif; }
        .btn { padding: 8px 18px; background: #00E5FF; color: #0b1120; border: 1px solid #00b4d8; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin: 3px; }
        .btn-close { background: #e2e8f0; border-color: #cbd5e1; color: #334155; }
        @media print { .no-print { display: none !important; } body { padding: 0 !important; margin: 0 !important; } }
    </style>
</head>
<body>
    <div class="controls no-print">
        <h3 style="margin: 0 0 6px 0;">📄 Коммерческое предложение готово</h3>
        <button class="btn" onclick="window.print()">🖨 Распечатать / Сохранить в PDF</button>
        <button class="btn btn-close" onclick="window.close()">Закрыть</button>
    </div>

    <div class="header">
        <div>
            <div class="logo">⚡ Volt<span>Group</span></div>
            <div class="tagline">Комплексный электромонтаж квартир, домов и коммерческих объектов</div>
        </div>
        <div class="company-info">
            <strong>${ctx.contractor.name}</strong><br>
            Статус: ${ctx.contractor.status}<br>
            ИНН: ${ctx.contractor.inn} | Тел: ${ctx.contractor.phone}<br>
            ${ctx.contractor.region} | ${ctx.contractor.site}
        </div>
    </div>

    <h1>Коммерческое предложение № ${ctx.invoiceNum}</h1>
    <div class="subtitle">на выполнение электромонтажных работ под ключ</div>

    <div class="client-block">
        <div><strong>Заказчик:</strong> ${ctx.clientName}</div>
        <div><strong>Дата:</strong> «${ctx.date}» г.</div>
        <div><strong>Адрес объекта:</strong> ${ctx.clientAddr}</div>
        <div><strong>Срок действия КП:</strong> 3 рабочих дня</div>
    </div>

    <div class="intro-text">
        Предлагаем Вашему вниманию подробный расчет стоимости электромонтажных работ. Все работы выполняются в строгом соответствии с ПУЭ-7 и СП 256.1325800.2016 с применением профессионального инструмента и системы беспылевого штробления.
    </div>

    <div class="table-title">Перечень и стоимость работ</div>
    <table>
        <thead>
            <tr>
                <th style="width: 4%;">№</th>
                <th style="text-align: left;">Наименование работ / услуг</th>
                <th style="width: 8%;">Ед.</th>
                <th style="width: 8%;">Кол-во</th>
                <th style="width: 14%; text-align: right;">Цена, ₽</th>
                <th style="width: 14%; text-align: right;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${worksHTML}
        </tbody>
    </table>

    ${materialsHTML ? `
    <div class="table-title">Материалы и комплектующие ${ctx.masterBuys ? '(закупка Исполнителем)' : '(обеспечивает Заказчик)'}</div>
    <table>
        <thead>
            <tr>
                <th style="width: 4%;">№</th>
                <th style="text-align: left;">Наименование материала</th>
                <th style="width: 8%;">Ед.</th>
                <th style="width: 8%;">Кол-во</th>
                <th style="width: 14%; text-align: right;">Цена, ₽</th>
                <th style="width: 14%; text-align: right;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${materialsHTML}
        </tbody>
    </table>` : ''}

    <div class="total-section">
        ${ctx.totals.discountAmount > 0 ? `
        <div class="total-row">Стоимость электромонтажных работ без скидки: <strong>${ctx.totals.servicesTotal.toLocaleString('ru-RU')} ₽</strong></div>
        <div class="total-row" style="color: #c00;">Персональная скидка: <strong>-${ctx.totals.discountAmount.toLocaleString('ru-RU')} ₽</strong></div>
        <div class="total-row">Итого за электромонтажные работы: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</strong></div>
        ` : `
        <div class="total-row">Стоимость электромонтажных работ: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</strong></div>
        `}
        ${ctx.masterBuys && ctx.totals.materialsTotal > 0 ? `<div class="total-row">Стоимость материалов: <strong>${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽</strong></div>` : ''}
        <div class="final-price">ИТОГО К ОПЛАТЕ: ${ctx.totals.grandTotal.toLocaleString('ru-RU')} ₽</div>
    </div>

    <div class="features-grid">
        <div class="feature-card">
            <strong>🛡 Гарантия 12 месяцев</strong>
            Официальная гарантия по договору на качество всех электромонтажных соединений и монтаж щита.
        </div>
        <div class="feature-card">
            <strong>💨 Штробление без пыли</strong>
            Работаем мощным штроборезом с подключением строительного пылесоса — чистота на вашем объекте.
        </div>
        <div class="feature-card">
            <strong>⚡ Надежность по ГОСТ и ПУЭ</strong>
            Правильный подбор сечений кабеля, негорючий ГОСТ-кабель (ВВГнг-LS), опрессовка гильзами ГМЛ.
        </div>
        <div class="feature-card">
            <strong>📱 Прозрачность и чек НПД</strong>
            Официальный договор самозанятого, поэтапная оплата, фискальный чек из приложения «Мой налог».
        </div>
    </div>

    <div class="terms">
        <h3>Условия сотрудничества:</h3>
        <ul>
            <li><strong>Срок действия цен:</strong> 3 рабочих дня с даты формирования коммерческого предложения.</li>
            <li><strong>Сроки проведения работ:</strong> согласуются индивидуально при заключении договора (ориентировочно от 2 до 10 рабочих дней).</li>
            <li><strong>Порядок расчётов:</strong> поэтапная оплата по факту выполнения каждого этапа, либо 100% оплата после подписания акта сдачи-приёмки.</li>
            <li><strong>Материалы:</strong> при закупке мастером — 100% предоплата по смете с предоставлением кассовых чеков.</li>
        </ul>
    </div>

    <div class="signature-block">
        <div class="sign-col">
            <strong>Исполнитель:</strong><br>
            ${ctx.contractor.name}<br>
            VoltGroup | ИНН ${ctx.contractor.inn}
            <div class="sign-line">/ Зрячих М.О. / М.П.</div>
        </div>
        <div class="sign-col" style="text-align: right;">
            <strong>Заказчик:</strong><br>
            ${ctx.clientName}<br>
            Согласовано
            <div class="sign-line" style="margin-left: auto;">/ ____________________ /</div>
        </div>
    </div>
</body>
</html>`;

        openPrintWindow(offerHTML, 'Пожалуйста, разрешите всплывающие окна для формирования КП.');
    }

    /**
     * 3. Генерация Акта сдачи-приёмки работ
     */
    function generateAct() {
        const ctx = getDocContext('А', 'Заказчик');
        if (ctx.totals.grandTotal === 0 && ctx.totals.materialsTotal === 0) {
            alert('Добавьте хотя бы одну позицию');
            return;
        }

        const worksHTML = buildWorksRowsHtml(ctx.works, false);
        const materialsHTML = buildMaterialsRowsHtml(ctx.materials, false);
        const toWords = window.numberToWordsRu || (n => String(n));

        const actHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Акт сдачи-приёмки работ № ${ctx.invoiceNum} - VoltGroup</title>
    <style>
        @page { size: A4 portrait; margin: 8mm 12mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: 'Times New Roman', Times, serif; color: #000 !important; max-width: 210mm; margin: 0 auto; padding: 10px 15px; line-height: 1.3; background: #fff; font-size: 9.5pt; }
        h1 { text-align: center; font-size: 12pt; font-weight: bold; margin: 0 0 3px 0; text-transform: uppercase; color: #000; }
        .doc-subtitle { text-align: center; font-size: 9.5pt; margin-bottom: 10px; font-weight: bold; color: #000; }
        .city-date { display: flex; justify-content: space-between; margin-bottom: 10px; font-weight: bold; font-size: 9pt; }
        .preamble { margin-bottom: 8px; text-align: justify; text-indent: 18px; font-size: 9pt; line-height: 1.35; }
        .clause-title { font-weight: bold; margin-top: 8px; margin-bottom: 4px; font-size: 9pt; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0 10px 0; font-size: 8.5pt; border: 1px solid #000; }
        th, td { border: 1px solid #000 !important; padding: 4px 6px; color: #000 !important; }
        th { background: #e5e7eb !important; text-align: center; font-weight: bold; color: #000 !important; }
        .totals-block { margin-top: 8px; text-align: right; font-size: 9.5pt; page-break-inside: avoid; }
        .total-line { margin-bottom: 2px; }
        .grand-total { font-size: 10.5pt; font-weight: bold; margin-top: 6px; border-top: 2px solid #000; padding-top: 3px; display: inline-block; min-width: 240px; }
        .legal-text { margin-top: 8px; font-size: 8.5pt; text-align: justify; line-height: 1.3; }
        .legal-text ol { margin: 4px 0 6px 16px; padding: 0; }
        .legal-text li { margin-bottom: 3px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 15px; font-size: 9pt; page-break-inside: avoid; }
        .sign-box { line-height: 1.3; }
        .sign-title { font-weight: bold; margin-bottom: 4px; }
        .sign-line { margin-top: 25px; border-top: 1px solid #000; padding-top: 2px; font-style: italic; font-size: 8.5pt; text-align: center; }
        .controls { text-align: center; margin-bottom: 12px; padding: 8px; background: #f5f5f5; border-radius: 6px; border: 1px dashed #999; font-family: sans-serif; }
        .btn { padding: 8px 18px; background: #00E5FF; color: #050914; border: 1px solid #00b4d8; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin: 3px; }
        .btn-close { background: #ddd; color: #333; }
        @media print { .no-print { display: none !important; } body { padding: 0 !important; margin: 0 !important; } }
    </style>
</head>
<body>
    <div class="controls no-print">
        <h3 style="margin: 0 0 6px 0;">📝 Акт сдачи-приёмки сформирован</h3>
        <button class="btn" onclick="window.print()">🖨 Распечатать / Сохранить в PDF</button>
        <button class="btn btn-close" onclick="window.close()">Закрыть</button>
    </div>

    <h1>АКТ СДАЧИ-ПРИЁМКИ ВЫПОЛНЕННЫХ РАБОТ</h1>
    <div class="doc-subtitle">к Договору подряда № ${ctx.invoiceNum}</div>

    <div class="city-date">
        <span>г. Санкт-Петербург</span>
        <span>«${ctx.date}» г.</span>
    </div>

    <div class="preamble">
        Мы, нижеподписавшиеся: гражданин РФ <strong>${ctx.contractor.name}</strong> (ИНН ${ctx.contractor.inn}), применяющий специальный налоговый режим «Налог на профессиональный доход» (самозанятый) в соответствии с Федеральным законом от 27.11.2018 № 422-ФЗ, именуемый в дальнейшем <strong>«Исполнитель»</strong> (Подрядчик), с одной стороны, и гражданин(ка) <strong>${ctx.clientName}</strong>, именуемый(ая) в дальнейшем <strong>«Заказчик»</strong>, с другой стороны, совместно именуемые «Стороны», руководствуясь статьей 720 Гражданского кодекса Российской Федерации, составили настоящий Акт о нижеследующем:
    </div>

    <div class="clause-title">1. Перечень выполненных электромонтажных работ:</div>
    <div style="font-size: 9.5pt; margin-bottom: 6px;">Адрес объекта: <strong>${ctx.clientAddr}</strong></div>

    <table>
        <thead>
            <tr>
                <th style="width: 5%;">№</th>
                <th>Наименование работ / услуг</th>
                <th style="width: 10%;">Ед. изм.</th>
                <th style="width: 10%;">Кол-во</th>
                <th style="width: 15%;">Цена, ₽</th>
                <th style="width: 15%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${worksHTML}
        </tbody>
    </table>

    ${materialsHTML ? `
    <div class="clause-title">2. Перечень израсходованных материалов:</div>
    <table>
        <thead>
            <tr>
                <th style="width: 5%;">№</th>
                <th>Наименование материала</th>
                <th style="width: 10%;">Ед. изм.</th>
                <th style="width: 10%;">Кол-во</th>
                <th style="width: 15%;">Цена, ₽</th>
                <th style="width: 15%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${materialsHTML}
        </tbody>
    </table>` : ''}

    <div class="totals-block">
        ${ctx.totals.discountAmount > 0 ? `
        <div class="total-line">Стоимость выполненных работ без скидки: <strong>${ctx.totals.servicesTotal.toLocaleString('ru-RU')} ₽</strong></div>
        <div class="total-line" style="color: #c00;">Скидка на работы: <strong>-${ctx.totals.discountAmount.toLocaleString('ru-RU')} ₽</strong></div>
        <div class="total-line">Итого за выполненные работы: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</strong></div>
        ` : `
        <div class="total-line">Стоимость выполненных работ: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</strong></div>
        `}
        ${ctx.masterBuys && ctx.totals.materialsTotal > 0 ? `
        <div class="total-line">Стоимость материалов (закупка Подрядчиком): <strong>${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽</strong></div>
        <div class="total-line" style="font-size: 8.5pt; color: #555;">(Материалы на сумму ${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽ профинансированы Заказчиком ранее авансом)</div>
        <div class="grand-total" style="display:block; text-align:right;">
            ОБЩАЯ СТОИМОСТЬ ПО ДОГОВОРУ: <strong>${ctx.totals.grandTotal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.grandTotal)})</strong>.<br>
            <span style="font-size: 9.5pt; font-weight: normal;">Остаток к перечислению за выполненные работы: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.worksFinal)})</strong>.</span>
        </div>` : `
        <div class="grand-total" style="display:block; text-align:right;">
            ОБЩАЯ СТОИМОСТЬ ПО ДОГОВОРУ (К ОПЛАТЕ): <strong>${ctx.totals.grandTotal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.grandTotal)})</strong>.
        </div>`}
    </div>

    <div class="legal-text">
        <ol>
            <li>Вышеперечисленные работы выполнены Исполнителем в полном объеме, в установленный срок и с надлежащим качеством, в строгом соответствии с требованиями ПУЭ (Правила устройства электроустановок, 7-е изд.), СП 256.1325800.2016 и условиями Договора.</li>
            <li>Заказчик произвел детальный осмотр и проверку работоспособности смонтированных кабельных линий, электроустановочных изделий и щитового оборудования. Претензий по объему, качеству и срокам выполнения работ Заказчик к Исполнителю не имеет.</li>
            <li>Исполнитель предоставляет гарантию на выполненные электромонтажные работы сроком на <strong>12 (двенадцать) месяцев</strong> с даты подписания настоящего Акта. Гарантия не распространяется на естественный износ, дефекты оборудования заводского характера и последствия вмешательства третьих лиц.</li>
            <li>В соответствии со ст. 14 Федерального закона от 27.11.2018 № 422-ФЗ Исполнитель сформировал и предоставил Заказчику фискальный чек в приложении «Мой налог» на полученную сумму оплаты.</li>
            <li>Настоящий Акт составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.</li>
        </ol>
    </div>

    <div class="signatures">
        <div class="sign-box">
            <div class="sign-title">ИСПОЛНИТЕЛЬ:</div>
            ${ctx.contractor.name}<br>
            Статус: ${ctx.contractor.status}<br>
            ИНН: ${ctx.contractor.inn}<br>
            Тел: ${ctx.contractor.phone}
            <div class="sign-line">/ Зрячих М.О. /</div>
        </div>
        <div class="sign-box">
            <div class="sign-title">ЗАКАЗЧИК:</div>
            ФИО: ${ctx.clientName}<br>
            Адрес: ${ctx.clientAddr}<br>
            Паспортные данные: _________________________<br>
            Телефон: _________________________
            <div class="sign-line">/ ____________________ /</div>
        </div>
    </div>
</body>
</html>`;

        openPrintWindow(actHTML, 'Пожалуйста, разрешите всплывающие окна для печати акта.');
    }

    /**
     * 4. Генерация Договора подряда со Спецификацией
     */
    function generateContract() {
        const ctx = getDocContext('Д', '____________________');
        if (ctx.totals.grandTotal === 0 && ctx.totals.materialsTotal === 0) {
            alert('Смета пуста! Укажите хотя бы одну работу или материал для формирования договора.');
            return;
        }

        const worksRowsHTML = buildWorksRowsHtml(ctx.works, false);
        const matRowsHTML = buildMaterialsRowsHtml(ctx.materials, false);
        const toWords = window.numberToWordsRu || (n => String(n));

        const contractHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Договор подряда № ${ctx.invoiceNum} - VoltGroup</title>
    <style>
        @page { size: A4 portrait; margin: 10mm 15mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.35; color: #000; margin: 0; padding: 10px 15px; }
        h1 { font-size: 13pt; text-align: center; text-transform: uppercase; margin-bottom: 5px; font-weight: bold; }
        .doc-date { display: flex; justify-content: space-between; margin-bottom: 15px; font-weight: bold; }
        .clause-title { font-weight: bold; margin-top: 12px; margin-bottom: 4px; text-transform: uppercase; font-size: 10pt; }
        p { margin: 4px 0; text-align: justify; text-indent: 20px; }
        .no-indent { text-indent: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; font-size: 9pt; }
        th, td { border: 1px solid #000; padding: 4px 6px; }
        th { background: #f0f0f0; text-align: center; font-weight: bold; }
        .signatures { display: flex; justify-content: space-between; margin-top: 25px; page-break-inside: avoid; }
        .sign-col { width: 48%; }
        .sign-line { border-top: 1px solid #000; margin-top: 35px; text-align: center; font-size: 8.5pt; padding-top: 3px; }
        .controls { text-align: center; margin-bottom: 15px; padding: 10px; background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 6px; font-family: sans-serif; }
        .btn { padding: 8px 18px; background: #00E5FF; color: #050914; border: 1px solid #00b4d8; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin: 3px; }
        .btn-close { background: #e2e8f0; border-color: #cbd5e1; color: #334155; }
        @media print { .no-print { display: none !important; } body { padding: 0 !important; } }
    </style>
</head>
<body>
    <div class="controls no-print">
        <h3 style="margin: 0 0 6px 0; font-family: sans-serif;">📄 Договор подряда готов к печати</h3>
        <button class="btn" onclick="window.print()">🖨 Печать / Сохранить в PDF</button>
        <button class="btn btn-close" onclick="window.close()">Закрыть</button>
    </div>

    <h1>ДОГОВОР ПОДРЯДА НА ВЫПОЛНЕНИЕ ЭЛЕКТРОМОНТАЖНЫХ РАБОТ № ${ctx.invoiceNum}</h1>
    <div class="doc-date">
        <span>г. Санкт-Петербург</span>
        <span>«${ctx.date}» г.</span>
    </div>

    <p>
        Гражданин РФ <strong>${ctx.contractor.name}</strong> (ИНН ${ctx.contractor.inn}), применяющий специальный налоговый режим «Налог на профессиональный доход» (самозанятый) в соответствии с Федеральным законом от 27.11.2018 № 422-ФЗ, именуемый в дальнейшем <strong>«Подрядчик»</strong>, с одной стороны, и
    </p>
    <p>
        Гражданин(ка) <strong>${ctx.clientName}</strong>, именуемый(ая) в дальнейшем <strong>«Заказчик»</strong>, с другой стороны, совместно именуемые «Стороны», руководствуясь Гражданским кодексом Российской Федерации (гл. 37, § 1, 2 ст. 702–739 ГК РФ), заключили настоящий Договор о нижеследующем:
    </p>

    <div class="clause-title">1. ПРЕДМЕТ ДОГОВОРА</div>
    <p>1.1. Подрядчик обязуется выполнить по заданию Заказчика комплекс электромонтажных работ на объекте, расположенном по адресу: <strong>${ctx.clientAddr}</strong>, в соответствии с Приложением № 1 (Смета работ), являющимся неотъемлемой частью настоящего Договора, а Заказчик обязуется создать Подрядчику необходимые условия для выполнения работ, принять их результат и оплатить обусловленную Договором цену.</p>
    <p>1.2. Работы выполняются Подрядчиком с соблюдением действующих нормативно-технических требований, правил устройства электроустановок (ПУЭ 7-е изд.), СП 256.1325800.2016, а также норм пожарной безопасности и охраны труда.</p>

    <div class="clause-title">2. СТОИМОСТЬ РАБОТ И ПОРЯДОК РАСЧЁТОВ</div>
    <p>2.1. Общая цена настоящего Договора составляет: <strong>${ctx.totals.grandTotal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.grandTotal)})</strong>. НДС не облагается на основании ч. 8 ст. 2 Федерального закона от 27.11.2018 № 422-ФЗ.</p>
    <p>2.2. Указанная в п. 2.1 цена Договора включает в себя:
        <br>— стоимость подлежащих выполнению электромонтажных работ: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.worksFinal)})</strong>${ctx.totals.discountAmount > 0 ? ` (в том числе учтена согласованная скидка в размере ${ctx.totals.discountAmount.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.discountAmount)}))` : ''};
        <br>— ${ctx.masterBuys ? 'стоимость материалов и комплектующих, закупаемых Подрядчиком: <strong>' + ctx.totals.materialsTotal.toLocaleString('ru-RU') + ' руб. (' + toWords(ctx.totals.materialsTotal) + ')</strong>.' : 'материалы и комплектующие для выполнения работ обеспечиваются Заказчиком самостоятельно за свой счёт и в цену Договора не входят.'}
    </p>
    <p>2.3. ${ctx.masterBuys && ctx.totals.materialsTotal > 0 ? 'Оплата стоимости материалов в размере ' + ctx.totals.materialsTotal.toLocaleString('ru-RU') + ' руб. производится Заказчиком авансовым платежом до начала их закупки Подрядчиком. ' : ''}Оплата выполненных электромонтажных работ производится Заказчиком в рублях РФ поэтапно либо в полном объёме по факту завершения работ и подписания двустороннего Акта сдачи-приёмки выполненных работ.</p>
    <p>2.4. Подрядчик обязуется на каждую полученную сумму оплаты сформировать и передать Заказчику фискальный чек в электронной форме или на бумажном носителе из приложения «Мой налог» в соответствии со ст. 14 Федерального закона № 422-ФЗ.</p>

    <div class="clause-title">3. СРОКИ ВЫПОЛНЕНИЯ РАБОТ</div>
    <p>3.1. Подрядчик приступает к выполнению работ с момента обеспечения Заказчиком беспрепятственного доступа на объект и наличия точки подключения временного электроснабжения.</p>
    <p>3.2. Срок завершения работ согласуется Сторонами и может быть соразмерно продлён в случае задержки поставки материалов Заказчиком, отсутствия электроэнергии на объекте либо возникновения непредвиденных скрытых дефектов строительных конструкций.</p>

    <div class="clause-title">4. ПРАВА И ОБЯЗАННОСТИ СТОРОН</div>
    <p>4.1. <strong>Подрядчик обязан:</strong> выполнить работы качественно и в срок; обеспечить бережное отношение к имуществу Заказчика; применять технологию беспылевого штробления с использованием промышленного пылесоса; незамедлительно предупреждать Заказчика об обстоятельствах, угрожающих годности или прочности результатов работ.</p>
    <p>4.2. <strong>Заказчик обязан:</strong> предоставить Подрядчику доступ в помещение на согласованное время; предоставить схему расположения скрытых коммуникаций (отопление в полу, водопровод), при их наличии; своевременно принять и оплатить выполненные работы.</p>

    <div class="clause-title">5. ПОРЯДОК СДАЧИ И ПРИЁМКИ РАБОТ</div>
    <p>5.1. Сдача-приёмка выполненных работ оформляется двусторонним Актом сдачи-приёмки выполненных работ, подписываемым обеими Сторонами.</p>
    <p>5.2. Заказчик обязан в течение 3 (трёх) рабочих дней с момента предъявления результата работ осмотреть его и при отсутствии претензий подписать Акт либо направить обоснованный письменный отказ с перечнем необходимых доработок.</p>

    <div class="clause-title">6. ГАРАНТИЙНЫЕ ОБЯЗАТЕЛЬСТВА</div>
    <p>6.1. Гарантийный срок на качество выполненных электромонтажных работ составляет <strong>12 (двенадцать) месяцев</strong> с момента подписания Акта сдачи-приёмки выполненных работ.</p>
    <p>6.2. Гарантия распространяется на надёжность контактных соединений, расключение распределительных коробок, правильность монтажа кабельных линий и сборку электрощита.</p>
    <p>6.3. Гарантия не распространяется на заводской брак электроустановочных изделий и оборудования, приобретённых Заказчиком самостоятельно, а также в случаях механических повреждений кабелей третьими лицами при проведении последующих отделочных работ или нарушении правил эксплуатации.</p>

    <div class="clause-title">7. АДРЕСА, РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</div>
    <div class="signatures">
        <div class="sign-col">
            <strong>ПОДРЯДЧИК:</strong><br>
            ${ctx.contractor.name}<br>
            Статус: ${ctx.contractor.status}<br>
            ИНН: ${ctx.contractor.inn}<br>
            Телефон: ${ctx.contractor.phone}<br>
            Сайт: ${ctx.contractor.site}<br><br>
            <div class="sign-line">/ Зрячих М.О. /</div>
        </div>
        <div class="sign-col">
            <strong>ЗАКАЗЧИК:</strong><br>
            ФИО: ${ctx.clientName}<br>
            Адрес объекта: ${ctx.clientAddr}<br>
            Паспортные данные: ____________________<br>
            Телефон: ____________________<br><br>
            <div class="sign-line">/ ____________________ /</div>
        </div>
    </div>

    <div style="page-break-before: always; margin-top: 30px;"></div>

    <h2 style="font-weight: bold; text-align: right; font-size: 10pt; margin-bottom: 10px;">
        Приложение № 1<br>к Договору подряда № ${ctx.invoiceNum}<br>от «${ctx.date}» г.
    </h2>
    <h1 style="font-size: 12pt; margin-bottom: 15px;">СМЕТА-СПЕЦИФИКАЦИЯ ВЫПОЛНЯЕМЫХ РАБОТ</h1>

    <table>
        <thead>
            <tr>
                <th style="width: 5%;">№</th>
                <th>Наименование работ</th>
                <th style="width: 10%;">Ед. изм.</th>
                <th style="width: 10%;">Кол-во</th>
                <th style="width: 15%;">Цена, ₽</th>
                <th style="width: 15%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${worksRowsHTML}
            ${ctx.totals.discountAmount > 0 ? `
            <tr style="background: #f9f9f9;">
                <td colspan="5" style="text-align: right;">Стоимость работ без скидки:</td>
                <td style="text-align: right;">${ctx.totals.servicesTotal.toLocaleString('ru-RU')} ₽</td>
            </tr>
            <tr style="background: #f9f9f9; color: #c00;">
                <td colspan="5" style="text-align: right;">Скидка на работы:</td>
                <td style="text-align: right;">-${ctx.totals.discountAmount.toLocaleString('ru-RU')} ₽</td>
            </tr>` : ''}
            <tr style="font-weight: bold; background: #f9f9f9;">
                <td colspan="5" style="text-align: right;">Итого за электромонтажные работы:</td>
                <td style="text-align: right;">${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</td>
            </tr>
        </tbody>
    </table>

    ${matRowsHTML ? `
    <h1 style="font-size: 11pt; margin-top: 20px; margin-bottom: 10px;">Материалы ${ctx.masterBuys ? '(закупка Подрядчиком)' : '(обеспечивает Заказчик)'}</h1>
    <table>
        <thead>
            <tr>
                <th style="width: 5%;">№</th>
                <th>Наименование материала</th>
                <th style="width: 10%;">Ед. изм.</th>
                <th style="width: 10%;">Кол-во</th>
                <th style="width: 15%;">Цена, ₽</th>
                <th style="width: 15%;">Сумма, ₽</th>
            </tr>
        </thead>
        <tbody>
            ${matRowsHTML}
            <tr style="font-weight: bold; background: #f9f9f9;">
                <td colspan="5" style="text-align: right;">Итого за материалы:</td>
                <td style="text-align: right;">${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽</td>
            </tr>
        </tbody>
    </table>` : ''}

    <div style="margin-top: 15px; text-align: right; font-size: 10pt; line-height: 1.6;">
        <div>Стоимость электромонтажных работ: <strong>${ctx.totals.worksFinal.toLocaleString('ru-RU')} ₽</strong></div>
        ${ctx.masterBuys && ctx.totals.materialsTotal > 0 ? `<div>Стоимость материалов (закупка Подрядчиком): <strong>${ctx.totals.materialsTotal.toLocaleString('ru-RU')} ₽</strong></div>` : ''}
        <div style="font-size: 11.5pt; font-weight: bold; margin-top: 6px; border-top: 1px solid #000; padding-top: 6px;">
            ОБЩАЯ ЦЕНА ПО ДОГОВОРУ: ${ctx.totals.grandTotal.toLocaleString('ru-RU')} руб. (${toWords(ctx.totals.grandTotal)}).
        </div>
    </div>

    <div class="signatures" style="margin-top: 30px;">
        <div class="sign-col">
            Подрядчик: _______________ / Зрячих М.О. /
        </div>
        <div class="sign-col" style="text-align: right;">
            Заказчик: _______________ / ${ctx.clientName} /
        </div>
    </div>
</body>
</html>`;

        openPrintWindow(contractHTML, 'Пожалуйста, разрешите всплывающие окна для печати договора.');
    }

    // Экспорт в глобальную область видимости
    window.CONTRACTOR_INFO = CONTRACTOR;
    window.getDocContext = getDocContext;
    window.buildWorksRowsHtml = buildWorksRowsHtml;
    window.buildMaterialsRowsHtml = buildMaterialsRowsHtml;
    window.generatePDF = generatePDF;
    window.generateCommercialOffer = generateCommercialOffer;
    window.generateAct = generateAct;
    window.generateContract = generateContract;

})(window);
