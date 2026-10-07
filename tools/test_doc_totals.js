/**
 * tools/test_doc_totals.js
 * Тестирование логики формирования цен и текстов в документах (карточка 016, 018, пункты № 11, 14 AUDIT.md)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../static/js/money.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { numberToWordsRu } = globalThis;

function calculateTotalsSim(servicesTotal, discountInput, materialsTotal, masterBuys) {
    let discountAmount = 0, discountPercent = 0;
    if (discountInput) {
        if (discountInput.includes('%')) {
            discountPercent = parseFloat(discountInput.replace('%', '')) || 0;
            discountAmount = servicesTotal * (discountPercent / 100);
        } else {
            discountAmount = parseFloat(discountInput) || 0;
        }
    }
    discountAmount = Math.round(discountAmount);
    const worksFinal = Math.max(0, servicesTotal - discountAmount);
    const materialsToPay = masterBuys ? materialsTotal : 0;
    const grandTotal = worksFinal + materialsToPay;
    return { servicesTotal, discountAmount, discountPercent, worksFinal, materialsTotal, materialsToPay, grandTotal };
}

console.log('=== ТЕСТИРОВАНИЕ БАЗЫ РАСЧЁТА В ДОКУМЕНТАХ ===\n');

// Сценарий 1: masterBuys = true, скидка 10%
{
    const t = calculateTotalsSim(100000, '10%', 30000, true);
    console.log('Сценарий 1 (мастер закупает, скидка 10%):');
    console.log(`  servicesTotal: ${t.servicesTotal}, discountAmount: ${t.discountAmount}, worksFinal: ${t.worksFinal}`);
    console.log(`  materialsTotal: ${t.materialsTotal}, grandTotal: ${t.grandTotal}`);
    if (t.worksFinal !== 90000) throw new Error('worksFinal should be 90000');
    if (t.materialsTotal !== 30000) throw new Error('materialsTotal should be 30000');
    if (t.grandTotal !== 120000) throw new Error('grandTotal should be 120000');
    console.log('  ✓ Базовые суммы корректны (90 000 + 30 000 = 120 000)');
    console.log(`  Сумма прописью grandTotal: "${numberToWordsRu(t.grandTotal)}"`);
}

// Сценарий 2: masterBuys = false, скидка 10%
{
    const t = calculateTotalsSim(100000, '10%', 30000, false);
    console.log('\nСценарий 2 (заказчик закупает, скидка 10%):');
    console.log(`  worksFinal: ${t.worksFinal}, grandTotal: ${t.grandTotal}`);
    if (t.worksFinal !== 90000) throw new Error('worksFinal should be 90000');
    if (t.grandTotal !== 90000) throw new Error('grandTotal should be 90000');
    console.log('  ✓ Цена договора = worksFinal = 90 000 при выключенных материалах мастера');
}

// Сценарий 3: masterBuys = true, скидка 0
{
    const t = calculateTotalsSim(100000, '', 30000, true);
    console.log('\nСценарий 3 (мастер закупает, без скидки):');
    console.log(`  worksFinal: ${t.worksFinal}, grandTotal: ${t.grandTotal}`);
    if (t.worksFinal !== 100000) throw new Error('worksFinal should be 100000');
    if (t.grandTotal !== 130000) throw new Error('grandTotal should be 130000');
    console.log('  ✓ Цена договора = 130 000 (100 000 + 30 000)');
}

// Сценарий 4: masterBuys = false, скидка 0
{
    const t = calculateTotalsSim(100000, '', 30000, false);
    console.log('\nСценарий 4 (заказчик закупает, без скидки):');
    console.log(`  worksFinal: ${t.worksFinal}, grandTotal: ${t.grandTotal}`);
    if (t.worksFinal !== 100000) throw new Error('worksFinal should be 100000');
    if (t.grandTotal !== 100000) throw new Error('grandTotal should be 100000');
    console.log('  ✓ Цена договора = 100 000');
}

// Проверка файлов после рефакторинга
const docsJs = fs.readFileSync(path.join(__dirname, '../static/js/documents.js'), 'utf8');
const estimateJs = fs.readFileSync(path.join(__dirname, '../static/js/estimate.js'), 'utf8');
const estimateHtml = fs.readFileSync(path.join(__dirname, '../estimate.html'), 'utf8');

const checks = [
    { name: 'Договор п. 2.1 содержит grandTotal', pattern: /2\.1\. Общая цена настоящего Договора составляет: <strong>\$\{ctx\.totals\.grandTotal\.toLocaleString\('ru-RU'\)\} руб\./ },
    { name: 'Договор п. 2.2 содержит worksFinal и скидку', pattern: /стоимость подлежащих выполнению электромонтажных работ: <strong>\$\{ctx\.totals\.worksFinal\.toLocaleString\('ru-RU'\)\} руб\./ },
    { name: 'Договор п. 2.3 содержит аванс на материалы', pattern: /Оплата стоимости материалов в размере/ },
    { name: 'Акт содержит общую стоимость по договору grandTotal', pattern: /ОБЩАЯ СТОИМОСТЬ ПО ДОГОВОРУ/ },
    { name: 'Акт содержит расшифровку остатка за работы', pattern: /Остаток к перечислению за выполненные работы/ },
    { name: 'Спецификация содержит ОБЩАЯ ЦЕНА ПО ДОГОВОРУ grandTotal', pattern: /ОБЩАЯ ЦЕНА ПО ДОГОВОРУ: \$\{ctx\.totals\.grandTotal\.toLocaleString\('ru-RU'\)\} руб\./ },
    { name: 'Печатная смета разделяет стоимость до скидки и скидку', pattern: /Стоимость работ без скидки:/ },
    { name: 'КП разделяет стоимость до скидки и скидку', pattern: /Стоимость электромонтажных работ без скидки:/ },
    { name: 'Функция getDocContext определена', pattern: /function getDocContext\(/ },
    { name: 'Функция buildWorksRowsHtml определена', pattern: /function buildWorksRowsHtml\(/ },
    { name: 'Функция buildMaterialsRowsHtml определена', pattern: /function buildMaterialsRowsHtml\(/ }
];

console.log('\n=== ПРОВЕРКА ШАБЛОНОВ В static/js/documents.js ===');
let allPassed = true;
checks.forEach(c => {
    if (c.pattern.test(docsJs)) {
        console.log(`✓ ${c.name}`);
    } else {
        console.error(`✗ ОШИБКА: Не найден шаблон: ${c.name}`);
        allPassed = false;
    }
});

console.log('\n=== ПРОВЕРКА ПОДКЛЮЧЕНИЯ СКРИПТОВ В estimate.html ===');
const htmlChecks = [
    { name: 'config.js подключен', pattern: /<script src="static\/js\/config\.js"><\/script>/ },
    { name: 'money.js подключен', pattern: /<script src="static\/js\/money\.js"><\/script>/ },
    { name: 'estimate.js подключен', pattern: /<script src="static\/js\/estimate\.js"><\/script>/ },
    { name: 'documents.js подключен', pattern: /<script src="static\/js\/documents\.js"><\/script>/ }
];

htmlChecks.forEach(c => {
    if (c.pattern.test(estimateHtml)) {
        console.log(`✓ ${c.name}`);
    } else {
        console.error(`✗ ОШИБКА: Не найден тег подключения: ${c.name}`);
        allPassed = false;
    }
});

console.log('\n=== ПРОВЕРКА РАЗМЕРА estimate.html ===');
const lineCount = estimateHtml.split('\n').length;
console.log(`Количество строк в estimate.html: ${lineCount}`);
if (lineCount <= 600) {
    console.log(`✓ Размер сокращён более чем в 3.5 раза (было 2208, стало ${lineCount})`);
} else {
    console.error(`✗ Размер estimate.html больше ожидаемого: ${lineCount}`);
    allPassed = false;
}

if (!allPassed) {
    process.exit(1);
} else {
    console.log('\n🎉 Все проверки успешно пройдены!');
}
