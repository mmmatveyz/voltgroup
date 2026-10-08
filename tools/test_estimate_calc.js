/**
 * tools/test_estimate_calc.js
 * Автоматические тесты расчёта сметы (calculateTotals) в static/js/estimate.js:
 * - Базовый расчёт услуг (кол-во × цена)
 * - Коэффициент сложности (+20%)
 * - Скидки (процентные: 0%, 10%, 20% и фиксированные в рублях)
 * - Расчёт материалов (закупка подрядчиком vs обеспечение заказчиком)
 * - Кастомные позиции работ
 * - Граничные случаи (скидка > суммы, нулевые объёмы, округление до рублей)
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passedTests++;
    } else {
        console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
        failedTests++;
    }
}

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        console.log(`  ✓ PASS: ${testName} [${actual}]`);
        passedTests++;
    } else {
        console.error(`  ❌ FAIL: ${testName} — Ожидалось: ${expected}, получено: ${actual}`);
        failedTests++;
    }
}

/**
 * Создаёт тестовое окружение с мок-DOM для static/js/estimate.js
 */
function createEstimateEnvironment() {
    const elements = new Map();

    function getOrCreateEl(id) {
        if (!elements.has(id)) {
            elements.set(id, {
                id,
                value: '',
                checked: false,
                textContent: '',
                style: {},
                classList: {
                    toggle: () => {},
                    add: () => {},
                    remove: () => {}
                }
            });
        }
        return elements.get(id);
    }

    // Регистрация стандартных элементов интерфейса
    [
        'discount-input',
        'master-buys-materials',
        'services-total-display',
        'discount-value-display',
        'works-subtotal-display',
        'materials-total-display',
        'grand-total',
        'materials-summary-row',
        'selected-count-badge',
        'btn-filter-selected',
        'client-name',
        'client-phone',
        'client-address',
        'estimate-date',
        'invoice-number',
        'btn-send-estimate',
        'estimate-send-status'
    ].forEach(id => getOrCreateEl(id));

    const customWorkRows = [];
    const materialRows = [];

    const mockDocument = {
        addEventListener: () => {},
        removeEventListener: () => {},
        getElementById: (id) => getOrCreateEl(id),
        querySelectorAll: (sel) => {
            if (sel === '.custom-work-row') return customWorkRows;
            if (sel === '#materials-body tr') return materialRows;
            return [];
        },
        createElement: (tag) => ({
            tagName: tag,
            style: {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            appendChild: () => {},
            removeChild: () => {}
        })
    };

    const mockWindow = {
        document: mockDocument,
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { protocol: 'http:' },
        allServices: [],
        servicesState: {},
        currentSection: 'install',
        currentCategory: 'all',
        showOnlySelected: false
    };

    mockWindow.window = mockWindow;

    const estimateCode = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'estimate.js'), 'utf8');
    const script = new vm.Script(estimateCode);
    const context = vm.createContext(mockWindow);
    script.runInContext(context);

    return {
        window: mockWindow,
        elements,
        customWorkRows,
        materialRows,
        setDiscount: (val) => { getOrCreateEl('discount-input').value = val; },
        setMasterBuys: (checked) => { getOrCreateEl('master-buys-materials').checked = checked; },
        addCustomRow: (name, price, qty, isComplex = false) => {
            const sumCell = { textContent: '' };
            customWorkRows.push({
                querySelector: (sel) => {
                    if (sel === '.name-input') return { value: name };
                    if (sel === '.mat-unit') return { value: 'шт.' };
                    if (sel === '.mat-price') return { value: String(price) };
                    if (sel === '.custom-qty-input') return { value: String(qty) };
                    if (sel === '.custom-complex') return { checked: isComplex };
                    if (sel === 'td:nth-child(5)') return sumCell;
                    return null;
                }
            });
        },
        addMaterialRow: (name, price, qty) => {
            const sumCell = { textContent: '' };
            materialRows.push({
                querySelector: (sel) => {
                    if (sel === '.mat-name') return { value: name };
                    if (sel === '.mat-unit') return { value: 'м' };
                    if (sel === '.mat-price') return { value: String(price) };
                    if (sel === '.mat-qty') return { value: String(qty) };
                    if (sel === 'td:nth-child(5)') return sumCell;
                    return null;
                }
            });
        }
    };
}

console.log('=== ТЕСТИРОВАНИЕ РАСЧЁТНОЙ ЛОГИКИ СМЕТЫ (static/js/estimate.js) ===\n');

// -------------------------------------------------------------
// ТЕСТ 1: Базовый расчёт услуг (без скидок и коэффициентов)
// -------------------------------------------------------------
console.log('1. Базовый расчёт без скидки:');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Монтаж кабеля', price: 150, unit: 'м' },
        { name: 'Установка розетки', price: 350, unit: 'шт.' }
    ];
    env.window.servicesState = {
        0: { qty: 100, isComplex: false }, // 100 * 150 = 15 000
        1: { qty: 20, isComplex: false }   // 20 * 350 = 7 000
    };
    const res = env.window.calculateTotals();
    assertEqual(res.servicesTotal, 22000, 'Сумма услуг (15000 + 7000)');
    assertEqual(res.discountAmount, 0, 'Скидка = 0');
    assertEqual(res.worksFinal, 22000, 'Итого за работы = 22000');
    assertEqual(res.grandTotal, 22000, 'Общий итог = 22000');
}

// -------------------------------------------------------------
// ТЕСТ 2: Коэффициент сложности (+20%)
// -------------------------------------------------------------
console.log('\n2. Коэффициент сложности (+20%):');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Штробление бетон', price: 500, unit: 'м' } // 500 * 1.2 = 600
    ];
    env.window.servicesState = {
        0: { qty: 10, isComplex: true } // 10 * 600 = 6 000
    };
    const res = env.window.calculateTotals();
    assertEqual(res.servicesTotal, 6000, 'Штробление с к-том сложности (10 * 500 * 1.2)');
    assertEqual(res.worksFinal, 6000, 'Итого за работы');
}

// -------------------------------------------------------------
// ТЕСТ 3: Процентная скидка (0%, 10%, 20%)
// -------------------------------------------------------------
console.log('\n3. Процентная скидка (0%, 10%, 20%):');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Комплексный электромонтаж', price: 100000, unit: 'объект' }
    ];
    env.window.servicesState = { 0: { qty: 1, isComplex: false } };

    // 0%
    env.setDiscount('0%');
    let res = env.window.calculateTotals();
    assertEqual(res.discountAmount, 0, 'Скидка 0%');
    assertEqual(res.worksFinal, 100000, 'Работы при 0%');

    // 10%
    env.setDiscount('10%');
    res = env.window.calculateTotals();
    assertEqual(res.discountAmount, 10000, 'Скидка 10% от 100 000');
    assertEqual(res.worksFinal, 90000, 'Работы при 10%');

    // 20%
    env.setDiscount('20%');
    res = env.window.calculateTotals();
    assertEqual(res.discountAmount, 20000, 'Скидка 20% от 100 000');
    assertEqual(res.worksFinal, 80000, 'Работы при 20%');
}

// -------------------------------------------------------------
// ТЕСТ 4: Фиксированная скидка в рублях
// -------------------------------------------------------------
console.log('\n4. Фиксированная скидка в рублях:');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Электромонтаж', price: 50000, unit: 'объект' }
    ];
    env.window.servicesState = { 0: { qty: 1, isComplex: false } };

    env.setDiscount('7500');
    const res = env.window.calculateTotals();
    assertEqual(res.discountAmount, 7500, 'Фиксированная скидка 7500 руб.');
    assertEqual(res.worksFinal, 42500, 'Работы за вычетом фикс. скидки (50000 - 7500)');
}

// -------------------------------------------------------------
// ТЕСТ 5: Материалы — закупка подрядчиком vs обеспечение заказчиком
// -------------------------------------------------------------
console.log('\n5. Материалы и переключатель закупки:');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Монтаж щита', price: 20000, unit: 'шт.' }
    ];
    env.window.servicesState = { 0: { qty: 1, isComplex: false } };
    env.addMaterialRow('Кабель ВВГнг-LS 3х2.5', 95, 100); // 9500
    env.addMaterialRow('Автоматический выключатель 16А', 450, 10); // 4500
    // materialsTotal = 9500 + 4500 = 14000

    // Заказчик закупает (masterBuys = false)
    env.setMasterBuys(false);
    let res = env.window.calculateTotals();
    assertEqual(res.materialsTotal, 14000, 'Общая стоимость материалов');
    assertEqual(res.materialsToPay, 0, 'К оплате за материалы = 0 (обеспечивает заказчик)');
    assertEqual(res.grandTotal, 20000, 'Цена договора = worksFinal (материалы не входят)');

    // Подрядчик закупает (masterBuys = true)
    env.setMasterBuys(true);
    res = env.window.calculateTotals();
    assertEqual(res.materialsToPay, 14000, 'К оплате за материалы = 14000 (закупка подрядчиком)');
    assertEqual(res.grandTotal, 34000, 'Цена договора = worksFinal + materialsTotal (20000 + 14000)');
}

// -------------------------------------------------------------
// ТЕСТ 6: Кастомные позиции работ
// -------------------------------------------------------------
console.log('\n6. Кастомные позиции работ:');
{
    const env = createEstimateEnvironment();
    env.addCustomRow('Алмазное бурение d100', 2500, 4, false); // 10 000
    env.addCustomRow('Монтаж шинопровода на высоте 4м', 1000, 5, true); // 5 * 1000 * 1.2 = 6 000

    const res = env.window.calculateTotals();
    assertEqual(res.servicesTotal, 16000, 'Сумма кастомных работ (10000 + 6000)');
    assertEqual(res.worksFinal, 16000, 'Итого за кастомные работы');
}

// -------------------------------------------------------------
// ТЕСТ 7: Граничные условия и округление
// -------------------------------------------------------------
console.log('\n7. Граничные условия:');
{
    const env = createEstimateEnvironment();
    env.window.allServices = [
        { name: 'Работа А', price: 153, unit: 'м' }
    ];
    env.window.servicesState = { 0: { qty: 7, isComplex: false } }; // 153 * 7 = 1071

    // Скидка 33% -> 1071 * 0.33 = 353.43 -> округление до 353
    env.setDiscount('33%');
    let res = env.window.calculateTotals();
    assertEqual(res.discountAmount, 353, 'Округление скидки до целых рублей');
    assertEqual(res.worksFinal, 718, 'Округление работ (1071 - 353 = 718)');

    // Скидка превышает стоимость работ (не должно уходить в минус)
    env.setDiscount('5000');
    res = env.window.calculateTotals();
    assertEqual(res.worksFinal, 0, 'worksFinal не может быть отрицательным (Math.max(0, ...))');
}

// -------------------------------------------------------------
// ТЕСТ 8: Экспорт в CSV (экранирование ';', '"' и формат даты ДД.ММ.ГГГГ)
// -------------------------------------------------------------
console.log('\n8. Экспорт в CSV (экранирование разделителей и формат даты):');
{
    const env = createEstimateEnvironment();
    env.elements.get('client-name').value = 'Иванов; Иван Иванович';
    env.elements.get('client-address').value = 'г. СПб; Невский пр., д. "10"';
    env.elements.get('invoice-number').value = 'СМ;01/26';
    env.elements.get('estimate-date').value = '2026-10-07';

    env.window.allServices = [
        { name: 'Кабель ВВГ-Пнг(А); 3х2.5', price: 150, unit: 'м; пог.' }
    ];
    env.window.servicesState = { 0: { qty: 50, isComplex: false } };

    env.addCustomRow('Алмазное бурение; d100', 3000, 2, false);
    env.addMaterialRow('Автоматический выключатель 16А "ABB Basic 55"', 450, 6);

    const totals = env.window.calculateTotals();
    const csv = env.window.buildCsvData(totals);

    assert(csv.startsWith('\uFEFF'), 'CSV содержит маркер UTF-8 BOM');
    assert(csv.includes('07.10.2026'), 'Дата в CSV отформатирована как ДД.ММ.ГГГГ (07.10.2026)');
    assert(!csv.includes('2026-10-07'), 'Сырой формат ГГГГ-ММ-ДД отсутствует в CSV');

    // Функция проверки CSV-строки с учётом экранирования кавычек
    function parseCsvLine(line) {
        const fields = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ';' && !inQuotes) {
                fields.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        fields.push(cur);
        return fields;
    }

    const lines = csv.replace('\uFEFF', '').split(/\r?\n/).filter(l => l.trim().length > 0);

    // Проверка строки услуги: должна содержать ровно 7 колонок, несмотря на ';' в названии и единице
    const serviceLine = lines.find(l => l.includes('Кабель ВВГ'));
    assert(!!serviceLine, 'Строка с услугой найдена в CSV');
    if (serviceLine) {
        const fields = parseCsvLine(serviceLine);
        assertEqual(fields.length, 7, 'Строка услуги содержит ровно 7 колонок');
        assertEqual(fields[1], 'Кабель ВВГ-Пнг(А); 3х2.5', 'Точка с запятой в наименовании не разбила колонку');
        assertEqual(fields[2], 'м; пог.', 'Точка с запятой в единице измерения не разбила колонку');
    }

    // Проверка строки материала: кавычки и наименование
    const matLine = lines.find(l => l.includes('ABB Basic 55'));
    assert(!!matLine, 'Строка с материалом найдена в CSV');
    if (matLine) {
        const fields = parseCsvLine(matLine);
        assertEqual(fields.length, 6, 'Строка материала содержит ровно 6 колонок');
        assertEqual(fields[1], 'Автоматический выключатель 16А "ABB Basic 55"', 'Двойные кавычки в названии корректно сохранены');
    }

    // Проверка строки заказчика и адреса
    const clientLine = lines.find(l => l.includes('Заказчик:'));
    assert(!!clientLine, 'Строка заказчика найдена в CSV');
    if (clientLine) {
        const fields = parseCsvLine(clientLine);
        assertEqual(fields[1], 'Иванов; Иван Иванович', 'Точка с запятой в имени заказчика сохранена');
        assertEqual(fields[3], 'г. СПб; Невский пр., д. "10"', 'Точка с запятой и кавычки в адресе сохранены');
    }
}

// ==========================================
// 9. ТЕСТ СБОРКИ СМЕТЫ ДЛЯ МАСТЕРА (tasks/046)
// ==========================================
console.log('\n--- Тест 9: Сборка сметы для передачи мастеру (tasks/046) ---');
{
    const env = createEstimateEnvironment();
    env.elements.get('client-name').value = 'Тестов Т.Т.';
    env.elements.get('client-phone').value = '+7 (999) 111-22-33';
    env.elements.get('client-address').value = 'СПб, пр. Просвещения, 15';
    env.elements.get('invoice-number').value = 'КП-99';
    env.elements.get('estimate-date').value = '2026-10-08';

    // Добавляем 20 услуг для проверки обрезки длинного списка до 15
    env.window.allServices = [];
    env.window.servicesState = {};
    for (let i = 0; i < 20; i++) {
        env.window.allServices.push({
            name: `Услуга №${i + 1}`,
            unit: 'шт.',
            price: 1000,
            section: 'install',
            category: 'Тест'
        });
        env.window.servicesState[i] = { qty: 2, isComplex: false };
    }

    env.setMasterBuys(true);
    env.addMaterialRow('Кабель ВВГнг-LS 3х2.5', 100, 50);

    const summary = env.window.buildEstimateSummaryForLead({ maxItems: 15 });
    assert(!!summary.text, 'Текст сметы сформирован');
    assertEqual(summary.totalWorksCount, 20, 'Всего 20 выбранных работ');
    assertEqual(summary.materialsCount, 1, 'Материалы присутствуют (1 позиция)');
    assertEqual(summary.grandTotal, 45000, 'Числовой итог сметы grandTotal равен 45 000 ₽');
    assert(summary.text.includes('Адрес: СПб, пр. Просвещения, 15'), 'Адрес присутствует в тексте');
    assert(summary.text.includes('15. Услуга №15'), '15-я позиция присутствует');
    assert(!summary.text.includes('16. Услуга №16'), '16-я позиция скрыта (лимит 15)');
    assert(summary.text.includes('… и ещё 5 позиций'), 'Выведено сообщение об оставшихся 5 позициях');
    const normalizedText = summary.text.replace(/\u00a0/g, ' ');
    assert(normalizedText.includes('Кабель ВВГнг-LS 3х2.5 — 50 м × 100 ₽ = 5 000 ₽'), 'Материал рассчитан и указан');
    assert(normalizedText.includes('ИТОГО К ОПЛАТЕ: 45 000 ₽'), 'Итоговая сумма рассчитана верно (40 000 работы + 5 000 материалы)');
}

console.log(`\nИТОГ ТЕСТОВ РАСЧЁТА: ${passedTests} пройдено, ${failedTests} провалено.`);
if (failedTests > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
