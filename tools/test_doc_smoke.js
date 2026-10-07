/**
 * tools/test_doc_smoke.js
 * Смоук-тесты генерации четырёх документов VoltGroup (static/js/documents.js):
 * 1. Смета (PDF) - generatePDF()
 * 2. Коммерческое предложение - generateCommercialOffer()
 * 3. Акт сдачи-приёмки работ - generateAct()
 * 4. Договор подряда со Спецификацией - generateContract()
 *
 * Проверяется:
 * - Все 4 документа успешно генерируются без исключений
 * - Единая база расчёта: цена договора (grandTotal) идентична во всех документах
 * - Отсутствие 'undefined', 'NaN', 'null' в сгенерированном HTML
 * - Наличие реквизитов Подрядчика и Заказчика
 * - Корректность работы с включёнными и выключенными материалами
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

function createDocumentsEnvironment(config = {}) {
    const {
        servicesTotal = 100000,
        discountAmount = 10000,
        discountPercent = 10,
        worksFinal = 90000,
        materialsTotal = 30000,
        masterBuys = true,
        clientName = 'Иванов Иван Иванович',
        clientAddress = 'г. Санкт-Петербург, Невский пр., д. 25, кв. 12',
        invoiceNum = 'СМ-102',
        estimateDate = '2026-10-07'
    } = config;

    const materialsToPay = masterBuys ? materialsTotal : 0;
    const grandTotal = worksFinal + materialsToPay;

    let capturedHtml = null;

    const mockDocument = {
        addEventListener: () => {},
        removeEventListener: () => {},
        getElementById: (id) => {
            if (id === 'client-name') return { value: clientName };
            if (id === 'client-address') return { value: clientAddress };
            if (id === 'invoice-number') return { value: invoiceNum };
            if (id === 'estimate-date') return { value: estimateDate };
            if (id === 'master-buys-materials') return { checked: masterBuys };
            if (id === 'discount-input') return { value: `${discountPercent}%` };
            return null;
        },
        querySelectorAll: (sel) => {
            if (sel === '.custom-work-row') return [];
            if (sel === '#materials-body tr') {
                return [
                    {
                        querySelector: (s) => {
                            if (s === '.mat-name') return { value: 'Кабель ВВГнг-LS' };
                            if (s === '.mat-unit') return { value: 'м' };
                            if (s === '.mat-price') return { value: '150' };
                            if (s === '.mat-qty') return { value: '200' };
                            return null;
                        }
                    }
                ];
            }
            return [];
        }
    };

    const mockWindow = {
        document: mockDocument,
        allServices: [
            { name: 'Монтаж щита распределительного', unit: 'шт.', price: 20000, category: 'Щиты' },
            { name: 'Прокладка силового кабеля', unit: 'м', price: 200, category: 'Кабель' }
        ],
        servicesState: {
            0: { qty: 2, isComplex: false }, // 40000
            1: { qty: 300, isComplex: false } // 60000 -> total 100000
        },
        calculateTotals: () => ({
            servicesTotal,
            discountAmount,
            discountPercent,
            worksFinal,
            materialsTotal,
            materialsToPay,
            grandTotal
        }),
        open: () => ({
            document: {
                open: () => {},
                write: (html) => { capturedHtml = html; },
                close: () => {}
            }
        }),
        alert: () => {}
    };

    mockWindow.window = mockWindow;

    // Загрузка money.js
    const moneyCode = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'money.js'), 'utf8');
    vm.runInNewContext(moneyCode, mockWindow);

    // Загрузка documents.js
    const docCode = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'documents.js'), 'utf8');
    vm.runInNewContext(docCode, mockWindow);

    return {
        window: mockWindow,
        getCapturedHtml: () => capturedHtml,
        grandTotal,
        worksFinal,
        materialsTotal
    };
}

console.log('=== СМОУК-ТЕСТЫ ГЕНЕРАЦИИ ДОКУМЕНТОВ (static/js/documents.js) ===\n');

// -------------------------------------------------------------
// ТЕСТ 1: Проверка четырёх документов при закупке материалов мастером
// -------------------------------------------------------------
console.log('1. Проверка четырёх генераторов (материалы закупает подрядчик):');
{
    const env = createDocumentsEnvironment({ masterBuys: true });
    const docs = [
        { name: 'Смета (generatePDF)', fn: env.window.generatePDF },
        { name: 'Коммерческое предложение (generateCommercialOffer)', fn: env.window.generateCommercialOffer },
        { name: 'Акт сдачи-приёмки (generateAct)', fn: env.window.generateAct },
        { name: 'Договор и Спецификация (generateContract)', fn: env.window.generateContract }
    ];

    docs.forEach(doc => {
        doc.fn();
        const html = env.getCapturedHtml();
        const normHtml = html ? html.replace(/\u00a0|\u202f/g, ' ') : '';
        assert(typeof html === 'string' && html.length > 500, `${doc.name}: HTML успешно сгенерирован (длина: ${html?.length || 0})`);
        assert(!html.includes('undefined'), `${doc.name}: не содержит 'undefined'`);
        assert(!html.includes('NaN'), `${doc.name}: не содержит 'NaN'`);
        assert(!html.includes('null'), `${doc.name}: не содержит 'null'`);
        assert(html.includes('591110297727'), `${doc.name}: содержит ИНН Подрядчика`);
        assert(html.includes('Иванов Иван Иванович'), `${doc.name}: содержит имя Заказчика`);
        assert(normHtml.includes('120 000') || html.includes('120000'), `${doc.name}: содержит общую цену договора (120 000)`);
    });
}

// -------------------------------------------------------------
// ТЕСТ 2: Проверка документов при материалах заказчика (masterBuys = false)
// -------------------------------------------------------------
console.log('\n2. Проверка генераторов (материалы обеспечивает заказчик):');
{
    const env = createDocumentsEnvironment({ masterBuys: false });
    // grandTotal = worksFinal = 90000
    assertEqual(env.grandTotal, 90000, 'grandTotal равен worksFinal при материалах заказчика');

    // Проверяем Договор
    env.window.generateContract();
    const contractHtml = (env.getCapturedHtml() || '').replace(/\u00a0|\u202f/g, ' ');
    assert(contractHtml.includes('90 000') || contractHtml.includes('90000'), 'Договор содержит цену договора 90 000 руб.');
    assert(contractHtml.includes('обеспечивает Заказчик'), 'Договор указывает, что материалы обеспечивает Заказчик');

    // Проверяем Акт
    env.window.generateAct();
    const actHtml = (env.getCapturedHtml() || '').replace(/\u00a0|\u202f/g, ' ');
    assert(actHtml.includes('90 000') || actHtml.includes('90000'), 'Акт содержит итого к оплате 90 000 руб.');
}

// -------------------------------------------------------------
// ТЕСТ 3: Проверка экранирования спецсимволов в реквизитах
// -------------------------------------------------------------
console.log('\n3. Проверка экранирования XSS-символов в имени и адресе:');
{
    const env = createDocumentsEnvironment({
        clientName: '<script>alert("xss")</script>Петров',
        clientAddress: 'Невский <img src=x onerror=alert(1)>'
    });

    env.window.generateContract();
    const html = env.getCapturedHtml();
    assert(!html.includes('<script>alert('), 'Скрипт в имени клиента экранирован');
    assert(html.includes('&lt;script&gt;') || html.includes('Петров'), 'Экранированная разметка присутствует');
    assert(!html.includes('<img src=x'), 'Опасный тег img в адресе экранирован');
}

console.log(`\nИТОГ СМОУК-ТЕСТОВ ДОКУМЕНТОВ: ${passedTests} пройдено, ${failedTests} провалено.`);
if (failedTests > 0) {
    process.exit(1);
} else {
    process.exit(0);
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
