/**
 * static/js/money.js
 * Преобразование числовых сумм в сумму прописью на русском языке
 * VoltGroup — Генератор смет и документов
 */

(function (global) {
    'use strict';

    function plural(n, form1, form2, form5) {
        n = Math.abs(n) % 100;
        const n1 = n % 10;
        if (n > 10 && n < 20) return form5;
        if (n1 > 1 && n1 < 5) return form2;
        if (n1 === 1) return form1;
        return form5;
    }

    function tripletToWords(num, gender) {
        const units = [
            ['', ''],
            ['один', 'одна'],
            ['два', 'две'],
            ['три', 'три'],
            ['четыре', 'четыре'],
            ['пять', 'пять'],
            ['шесть', 'шесть'],
            ['семь', 'семь'],
            ['восемь', 'восемь'],
            ['девять', 'девять']
        ];
        const teens = [
            'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
            'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
        ];
        const tens = [
            '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
            'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'
        ];
        const hundreds = [
            '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
            'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'
        ];

        const words = [];
        const h = Math.floor(num / 100);
        const t = Math.floor((num % 100) / 10);
        const u = num % 10;

        if (h > 0) words.push(hundreds[h]);

        if (t === 1) {
            words.push(teens[u]);
        } else {
            if (t > 1) words.push(tens[t]);
            if (u > 0) words.push(units[u][gender]);
        }
        return words.join(' ');
    }

    /**
     * Преобразует сумму в числовом виде в текст прописью:
     * Например: 123456.78 -> "сто двадцать три тысячи четыреста пятьдесят шесть рублей 78 копеек"
     *
     * @param {number|string} amount - сумма в рублях
     * @returns {string} сумма прописью
     */
    function numberToWordsRu(amount) {
        if (typeof amount !== 'number') {
            amount = parseFloat(String(amount).replace(/\s+/g, '').replace(',', '.')) || 0;
        }
        amount = Math.round(amount * 100) / 100;
        const isNegative = amount < 0;
        amount = Math.abs(amount);

        const intPart = Math.floor(amount);
        const kopPart = Math.round((amount - intPart) * 100);

        const scales = [
            { gender: 0, forms: ['рубль', 'рубля', 'рублей'] },
            { gender: 1, forms: ['тысяча', 'тысячи', 'тысяч'] },
            { gender: 0, forms: ['миллион', 'миллиона', 'миллионов'] },
            { gender: 0, forms: ['миллиард', 'миллиарда', 'миллиардов'] }
        ];

        const words = [];
        if (isNegative) words.push('минус');

        if (intPart === 0) {
            words.push('ноль рублей');
        } else {
            let temp = intPart;
            const parts = [];
            let scaleIdx = 0;

            while (temp > 0 && scaleIdx < scales.length) {
                const triplet = temp % 1000;
                if (triplet > 0 || (scaleIdx === 0 && temp === 0)) {
                    const scale = scales[scaleIdx];
                    const tripletText = tripletToWords(triplet, scale.gender);
                    const noun = plural(triplet, scale.forms[0], scale.forms[1], scale.forms[2]);
                    if (triplet > 0) {
                        parts.unshift((tripletText ? tripletText + ' ' : '') + noun);
                    }
                } else if (scaleIdx === 0 && intPart % 1000 === 0) {
                    parts.unshift('рублей');
                }
                temp = Math.floor(temp / 1000);
                scaleIdx++;
            }
            words.push(parts.join(' '));
        }

        const kopStr = String(kopPart).padStart(2, '0');
        const kopNoun = plural(kopPart, 'копейка', 'копейки', 'копеек');
        words.push(kopStr + ' ' + kopNoun);

        return words.join(' ').replace(/\s+/g, ' ').trim();
    }

    // Экспорт для браузера и Node.js
    global.numberToWordsRu = numberToWordsRu;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { numberToWordsRu };
    }
})(typeof window !== 'undefined' ? window : globalThis);
