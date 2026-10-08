/**
 * static/js/estimate.js
 * Логика онлайн-калькулятора сметы VoltGroup:
 * - Загрузка и парсинг прайс-листа static/data/prices.json
 * - Рендеринг таблицы работ и материалов
 * - Расчёт итогов сметы (calculateTotals)
 * - Управление черновиками (localStorage и JSON-файлы)
 * - Экспорт сметы (в буфер обмена для мессенджеров, Excel/CSV)
 */

(function (window) {
    'use strict';

    // Экранирование опасных символов HTML
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Состояние калькулятора
    window.allServices = [];
    window.servicesState = {};
    window.currentSection = 'install';
    window.currentCategory = 'all';
    window.showOnlySelected = false;

    /**
     * Переключение фильтра «только выбранные»
     */
    function toggleOnlySelected() {
        window.showOnlySelected = !window.showOnlySelected;
        const btn = document.getElementById('btn-filter-selected');
        if (btn) {
            btn.classList.toggle('active', window.showOnlySelected);
        }
        renderServices();
    }

    /**
     * Обновление бейджа с количеством выбранных позиций
     */
    function updateSelectedBadge() {
        let count = 0;
        Object.keys(window.servicesState).forEach(idx => {
            if (window.servicesState[idx] && window.servicesState[idx].qty > 0) {
                count++;
            }
        });
        const badge = document.getElementById('selected-count-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    /**
     * Загрузка прайс-листа из static/data/prices.json
     */
    function loadPrices() {
        return fetch('static/data/prices.json', { cache: 'no-cache' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                window.allServices = [];
                ['install', 'engineering'].forEach(section => {
                    if (data[section] && data[section].categories) {
                        data[section].categories.forEach(cat => {
                            if (cat.items && Array.isArray(cat.items)) {
                                cat.items.forEach(item => {
                                    window.allServices.push({
                                        name: item.service || item.name || 'Без названия',
                                        unit: item.unit || 'шт.',
                                        price: item.price || 0,
                                        category: cat.name || 'Общее',
                                        section: section
                                    });
                                });
                            }
                        });
                    }
                });
                return true;
            })
            .catch(err => {
                console.error('❌ Ошибка загрузки prices.json:', err);
                const tbody = document.getElementById('services-body');
                if (tbody) {
                    tbody.textContent = '';
                    const tr = document.createElement('tr');
                    const td = document.createElement('td');
                    td.colSpan = 7;
                    td.style.cssText = "text-align:center; padding:30px; color:var(--danger);";
                    if (window.location.protocol === 'file:') {
                        td.innerHTML = '❌ <b>Браузер блокирует загрузку данных по протоколу file:// (CORS).</b><br><span style="color:var(--text-muted);font-size:0.9em;display:inline-block;margin-top:6px;">Запустите локальный HTTP-сервер: выполните <code>python -m http.server 8000</code> в корне проекта или используйте скрипт <code>tools/serve.cmd</code>, затем откройте <a href="http://localhost:8000/estimate.html" style="color:var(--accent);">http://localhost:8000/estimate.html</a></span>';
                    } else {
                        td.textContent = "❌ Не удалось загрузить прайс-лист. Проверьте файл static/data/prices.json.";
                    }
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
                return false;
            });
    }

    let hasPingedEstimate = false;
    function pingServerOnFocus() {
        if (!hasPingedEstimate) {
            hasPingedEstimate = true;
            const apiUrl = (typeof window !== 'undefined' && window.VG_API) ? window.VG_API : 'https://voltgroup-bot.onrender.com';
            fetch(`${apiUrl}/ping`, { method: 'GET' }).catch(() => {});
        }
    }

    /**
     * Маска и валидация номера телефона (+7 (___) ___-__-__)
     */
    function initPhoneMask(input) {
        if (!input) return;

        function formatPhone(val) {
            let digits = val.replace(/\D/g, '');
            if (!digits) return '';

            if (digits[0] === '7' || digits[0] === '8') {
                digits = digits.substring(1);
            } else if (digits[0] === '9') {
                // оставляем как есть
            } else {
                digits = digits.substring(1);
            }

            let res = '+7';
            if (digits.length > 0) {
                res += ' (' + digits.substring(0, 3);
            }
            if (digits.length >= 4) {
                res += ') ' + digits.substring(3, 6);
            }
            if (digits.length >= 7) {
                res += '-' + digits.substring(6, 8);
            }
            if (digits.length >= 9) {
                res += '-' + digits.substring(8, 10);
            }
            return res;
        }

        input.addEventListener('input', function () {
            const formatted = formatPhone(this.value);
            this.value = formatted;
            if (this.classList.contains('is-invalid')) {
                const digits = this.value.replace(/\D/g, '');
                if (digits.length === 11) {
                    this.classList.remove('is-invalid');
                }
            }
        });

        input.addEventListener('focus', function () {
            pingServerOnFocus();
            if (!this.value) {
                this.value = '+7 (';
            }
        });

        input.addEventListener('blur', function () {
            if (this.value === '+7 (' || this.value === '+7' || this.value === '+') {
                this.value = '';
                this.classList.remove('is-invalid');
            } else {
                const digits = this.value.replace(/\D/g, '');
                if (digits.length < 11) {
                    this.classList.add('is-invalid');
                } else {
                    this.classList.remove('is-invalid');
                }
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && this.value.length <= 4) {
                this.value = '';
            }
        });
    }

    /**
     * Инициализация калькулятора
     */
    function initApp() {
        const dateInput = document.getElementById('estimate-date');
        if (dateInput && !dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        window.currentSection = 'install';
        window.currentCategory = 'all';
        const btnInstall = document.getElementById('btn-install');
        if (btnInstall) btnInstall.classList.add('active');

        const phoneInput = document.getElementById('client-phone');
        if (phoneInput) {
            initPhoneMask(phoneInput);
        }
        const nameInput = document.getElementById('client-name');
        if (nameInput) {
            nameInput.addEventListener('focus', pingServerOnFocus);
        }

        updateCategoryOptions();
        updateDraftList();
        calculateTotals();
    }

    /**
     * Обновление выпадающего списка категорий
     */
    function updateCategoryOptions() {
        const select = document.getElementById('category-select');
        if (!select) return;
        select.textContent = '';

        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'Все работы';
        select.appendChild(optAll);

        const cats = new Set();
        window.allServices.filter(s => s.section === window.currentSection).forEach(s => cats.add(s.category));

        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
    }

    /**
     * Переключение разделов (Электромонтаж / Автоматизация)
     */
    function switchSection(section) {
        window.currentSection = section;
        document.querySelectorAll('.section-selector button').forEach(btn => btn.classList.remove('active'));
        if (section === 'install') {
            document.getElementById('btn-install')?.classList.add('active');
        } else {
            document.getElementById('btn-eng')?.classList.add('active');
        }
        updateCategoryOptions();
        const catSelect = document.getElementById('category-select');
        if (catSelect) catSelect.value = 'all';
        window.currentCategory = 'all';
        renderServices();
    }

    /**
     * Отрисовка каталога работ
     */
    function renderServices(preserveCustom = true) {
        let existingCustomWorks = [];
        if (preserveCustom) {
            existingCustomWorks = Array.from(document.querySelectorAll('.custom-work-row')).map(row => ({
                name: row.querySelector('.name-input') ? row.querySelector('.name-input').value : '',
                unit: row.querySelector('.mat-unit') ? row.querySelector('.mat-unit').value : 'шт.',
                price: row.querySelector('.mat-price') ? row.querySelector('.mat-price').value : '',
                qty: row.querySelector('.custom-qty-input') ? row.querySelector('.custom-qty-input').value : 1,
                complex: row.querySelector('.custom-complex') ? row.querySelector('.custom-complex').checked : false
            }));
        }

        const catSelect = document.getElementById('category-select');
        const selectedCat = catSelect ? catSelect.value : 'all';
        window.currentCategory = selectedCat;
        const tbody = document.getElementById('services-body');
        if (!tbody) return;
        tbody.textContent = '';

        let filteredWithIndices = window.allServices
            .map((service, originalIndex) => ({ service, originalIndex }))
            .filter(item => item.service.section === window.currentSection);

        if (window.currentCategory !== 'all') {
            filteredWithIndices = filteredWithIndices.filter(item => item.service.category === window.currentCategory);
        }

        if (window.showOnlySelected) {
            filteredWithIndices = filteredWithIndices.filter(item => {
                const state = window.servicesState[item.originalIndex];
                return state && state.qty > 0;
            });
        }

        if (filteredWithIndices.length === 0 && existingCustomWorks.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 7;
            td.style.cssText = "text-align:center; padding:25px; color:var(--text-muted); font-size: 0.95rem;";
            td.textContent = window.showOnlySelected ? "🔍 Пока не выбрано ни одной позиции в этом разделе" : "В этой категории пока нет работ";
            tr.appendChild(td);
            tbody.appendChild(tr);
            calculateTotals();
            return;
        }

        filteredWithIndices.forEach(({ service, originalIndex }) => {
            const index = originalIndex;
            const savedState = window.servicesState[index] || { qty: 0, isComplex: false };
            const tr = document.createElement('tr');
            tr.dataset.index = index;
            tr.innerHTML = `
                <td style="font-weight: 600;">${escapeHtml(service.name)}</td>
                <td style="color: var(--text-muted);">${escapeHtml(service.unit)}</td>
                <td style="white-space: nowrap;">${Number(service.price).toLocaleString('ru-RU')} ₽</td>
                <td>
                  <div class="qty-wrapper">
                    <button class="qty-btn" type="button" aria-label="Уменьшить количество" onclick="changeQty(${index}, -1)">−</button>
                    <input type="number" class="qty-input-stepper" id="qty-${index}" min="0" step="0.5" value="${savedState.qty}" oninput="handleServiceChange(${index}, this.value)" onchange="handleServiceChange(${index}, this.value)">
                    <button class="qty-btn" type="button" aria-label="Увеличить количество" onclick="changeQty(${index}, 1)">+</button>
                  </div>
                </td>
                <td id="sum-${index}" style="text-align:center; font-weight:700; color: var(--primary-install); white-space: nowrap;">${(savedState.qty * (savedState.isComplex ? service.price * 1.2 : service.price)).toLocaleString('ru-RU')} ₽</td>
                <td>
                  <label class="complexity-check">
                    <input type="checkbox" id="complex-${index}" ${savedState.isComplex ? 'checked' : ''} onchange="handleServiceChange(${index}, document.getElementById('qty-${index}').value)">
                    <span>Сложно</span>
                    <span class="complexity-badge">+20%</span>
                  </label>
                </td>
                <td></td>
            `;
            tbody.appendChild(tr);
        });

        // Восстанавливаем кастомные строки
        existingCustomWorks.forEach(cw => {
            const qty = parseFloat(cw.qty) || 0;
            if (!window.showOnlySelected || qty > 0) {
                addCustomWorkRow(cw.name, cw.price, cw.qty, cw.unit, cw.complex, false);
            }
        });

        calculateTotals();
    }

    /**
     * Изменение количества в каталоге
     */
    function changeQty(index, delta) {
        const input = document.getElementById(`qty-${index}`);
        if (!input) return;
        let currentVal = parseFloat(input.value) || 0;
        let step = currentVal % 1 !== 0 ? 0.5 : 1;
        let newVal = Math.max(0, currentVal + (delta * step));
        input.value = newVal;
        handleServiceChange(index, newVal);
    }

    /**
     * Обработка изменения позиции каталога
     */
    function handleServiceChange(index, qty) {
        if (!window.servicesState[index]) window.servicesState[index] = { qty: 0, isComplex: false };
        window.servicesState[index].qty = parseFloat(qty) || 0;
        const complexCheck = document.getElementById(`complex-${index}`);
        if (complexCheck) window.servicesState[index].isComplex = complexCheck.checked;

        const service = window.allServices[index];
        if (!service) return;

        let price = service.price;
        if (window.servicesState[index].isComplex) price = price * 1.2;
        const sum = window.servicesState[index].qty * price;
        const sumCell = document.getElementById(`sum-${index}`);
        if (sumCell) sumCell.textContent = sum.toLocaleString('ru-RU') + ' ₽';

        calculateTotals();
    }

    /**
     * Добавление строки пользовательской работы
     */
    function addCustomWorkRow(name = '', price = '', qty = 1, unit = 'шт.', isComplex = false, shouldFocus = true) {
        const tbody = document.getElementById('services-body');
        if (!tbody) return;
        const row = document.createElement('tr');
        row.classList.add('custom-work-row');
        const uniqueId = 'custom-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const priceVal = (price !== '' && price !== 0 && price !== null && price !== undefined) ? price : '';
        const qtyVal = (qty !== '' && qty !== null && qty !== undefined) ? qty : 1;

        row.innerHTML = `
            <td>
                <input type="text" class="form-input name-input" value="${escapeHtml(name)}" placeholder="Название работы..." style="padding: 7px 10px;" maxlength="150" oninput="calculateTotals()" onkeydown="handleInputKeyNav(event, this, 'price')">
            </td>
            <td>
                <input type="text" class="form-input mat-unit" value="${escapeHtml(unit || 'шт.')}" style="width:50px; padding: 7px;" maxlength="20">
            </td>
            <td>
                <input type="number" class="form-input mat-price" value="${priceVal}" placeholder="0" min="0" oninput="calculateTotals()" onfocus="this.select()" onkeydown="handleInputKeyNav(event, this, 'qty')" style="width:85px; padding: 7px;">
            </td>
            <td>
                <div class="qty-wrapper">
                  <button class="qty-btn" type="button" aria-label="Уменьшить количество" onclick="changeCustomQty(this, -1)">−</button>
                  <input type="number" class="qty-input-stepper custom-qty-input" id="${uniqueId}" value="${qtyVal}" placeholder="1" min="0" step="0.5" oninput="calculateTotals()" onfocus="this.select()">
                  <button class="qty-btn" type="button" aria-label="Увеличить количество" onclick="changeCustomQty(this, 1)">+</button>
                </div>
            </td>
            <td style="text-align:center; font-weight:700; color: var(--primary-install); white-space: nowrap;">0 ₽</td>
            <td>
                <label class="complexity-check">
                  <input type="checkbox" class="custom-complex" ${isComplex ? 'checked' : ''} onchange="calculateTotals()">
                  <span>Сложно</span>
                  <span class="complexity-badge">+20%</span>
                </label>
            </td>
            <td style="text-align:center;"><button class="btn-remove" type="button" title="Удалить строку" onclick="this.closest('tr').remove(); calculateTotals()">✕</button></td>
        `;
        tbody.appendChild(row);

        if (shouldFocus) {
            const input = row.querySelector('.name-input');
            if (input) {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        calculateTotals();
    }

    /**
     * Изменение количества в кастомной строке
     */
    function changeCustomQty(btn, delta) {
        const wrapper = btn.parentElement;
        const input = wrapper.querySelector('.custom-qty-input');
        if (!input) return;
        let currentVal = parseFloat(input.value) || 0;
        let step = currentVal % 1 !== 0 ? 0.5 : 1;
        input.value = Math.max(0, currentVal + (delta * step));
        calculateTotals();
    }

    /**
     * Добавление строки материала
     */
    function addMaterialRow(name = '', price = '', qty = 1, unit = 'шт.', shouldFocus = true) {
        const matBody = document.getElementById('materials-body');
        if (!matBody) return;
        const row = document.createElement('tr');
        const priceVal = (price !== '' && price !== 0 && price !== null && price !== undefined) ? price : '';
        const qtyVal = (qty !== '' && qty !== null && qty !== undefined) ? qty : 1;

        row.innerHTML = `
            <td>
                <input type="text" class="form-input mat-name" value="${escapeHtml(name)}" placeholder="Наименование материала..." style="padding: 7px 10px;" maxlength="150" oninput="calculateTotals()" onkeydown="handleInputKeyNav(event, this, 'price')">
            </td>
            <td>
                <input type="text" class="form-input mat-unit" value="${escapeHtml(unit || 'шт.')}" style="width:50px; padding: 7px;" maxlength="20">
            </td>
            <td>
                <input type="number" class="form-input mat-price" value="${priceVal}" placeholder="0" min="0" oninput="calculateTotals()" onfocus="this.select()" onkeydown="handleInputKeyNav(event, this, 'qty')" style="width:85px; padding: 7px;">
            </td>
            <td>
                <input type="number" class="form-input mat-qty" value="${qtyVal}" placeholder="1" min="0" step="0.5" oninput="calculateTotals()" onfocus="this.select()" style="width:65px; padding: 7px;">
            </td>
            <td style="text-align:center; font-weight:700; color: var(--primary-install); white-space: nowrap;">0 ₽</td>
            <td style="text-align:center;"><button class="btn-remove" type="button" title="Удалить строку" onclick="this.closest('tr').remove(); calculateTotals()">✕</button></td>
        `;
        matBody.appendChild(row);

        if (shouldFocus) {
            const input = row.querySelector('.mat-name');
            if (input) {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        calculateTotals();
    }

    /**
     * Быстрая навигация клавишей Enter между полями ввода
     */
    function handleInputKeyNav(e, currentInput, targetType) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const row = currentInput.closest('tr');
            if (!row) return;
            if (targetType === 'price') {
                const priceEl = row.querySelector('.mat-price');
                if (priceEl) { priceEl.focus(); priceEl.select(); }
            } else if (targetType === 'qty') {
                const qtyEl = row.querySelector('.custom-qty-input') || row.querySelector('.mat-qty');
                if (qtyEl) { qtyEl.focus(); qtyEl.select(); }
            }
        }
    }

    /**
     * Расчёт сумм и итогов сметы
     */
    function calculateTotals() {
        let servicesTotal = 0;
        window.allServices.forEach((s, index) => {
            const state = window.servicesState[index] || { qty: 0, isComplex: false };
            let price = s.price;
            if (state.isComplex) price = price * 1.2;
            servicesTotal += state.qty * price;
        });

        document.querySelectorAll('.custom-work-row').forEach(row => {
            const priceBase = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.custom-qty-input')?.value) || 0;
            const complexCheck = row.querySelector('.custom-complex');
            const sumCell = row.querySelector('td:nth-child(5)');
            let finalPrice = (complexCheck && complexCheck.checked) ? priceBase * 1.2 : priceBase;
            const sum = qty * finalPrice;
            if (sumCell) sumCell.textContent = sum.toLocaleString('ru-RU') + ' ₽';
            servicesTotal += sum;
        });

        const discountInput = document.getElementById('discount-input')?.value.trim() || '';
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

        let materialsTotal = 0;
        document.querySelectorAll('#materials-body tr').forEach(row => {
            const price = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.mat-qty')?.value) || 0;
            const sum = price * qty;
            const sumCell = row.querySelector('td:nth-child(5)');
            if (sumCell) sumCell.textContent = sum.toLocaleString('ru-RU') + ' ₽';
            materialsTotal += sum;
        });

        const masterBuys = document.getElementById('master-buys-materials')?.checked || false;
        const materialsToPay = masterBuys ? materialsTotal : 0;
        const grandTotal = worksFinal + materialsToPay;

        const sTotEl = document.getElementById('services-total-display');
        if (sTotEl) sTotEl.textContent = servicesTotal.toLocaleString('ru-RU') + ' ₽';

        const dValEl = document.getElementById('discount-value-display');
        if (dValEl) {
            dValEl.textContent = discountPercent > 0
                ? `${discountPercent}% (-${discountAmount.toLocaleString('ru-RU')} ₽)`
                : `-${discountAmount.toLocaleString('ru-RU')} ₽`;
        }

        const wSubEl = document.getElementById('works-subtotal-display');
        if (wSubEl) wSubEl.textContent = worksFinal.toLocaleString('ru-RU') + ' ₽';

        const mTotEl = document.getElementById('materials-total-display');
        if (mTotEl) mTotEl.textContent = materialsTotal.toLocaleString('ru-RU') + ' ₽';

        const gTotEl = document.getElementById('grand-total');
        if (gTotEl) gTotEl.textContent = grandTotal.toLocaleString('ru-RU') + ' ₽';

        const matRow = document.getElementById('materials-summary-row');
        if (matRow) {
            matRow.style.opacity = masterBuys ? '1' : '0.5';
            matRow.style.textDecoration = masterBuys ? 'none' : 'line-through';
        }

        updateSelectedBadge();

        return { servicesTotal, discountAmount, discountPercent, worksFinal, materialsTotal, materialsToPay, grandTotal };
    }

    /**
     * Сбор всех данных формы для сохранения в черновик
     */
    function getFormData() {
        calculateTotals();
        return {
            clientName: document.getElementById('client-name')?.value || '',
            clientPhone: document.getElementById('client-phone')?.value || '',
            clientAddress: document.getElementById('client-address')?.value || '',
            date: document.getElementById('estimate-date')?.value || '',
            invoiceNum: document.getElementById('invoice-number')?.value || '',
            masterBuys: document.getElementById('master-buys-materials')?.checked,
            discount: document.getElementById('discount-input')?.value || '',
            servicesState: window.servicesState,
            currentSection: window.currentSection,
            currentCategory: window.currentCategory,
            customWorks: Array.from(document.querySelectorAll('.custom-work-row')).map(row => ({
                name: row.querySelector('.name-input')?.value || '',
                unit: row.querySelector('.mat-unit')?.value || '',
                price: row.querySelector('.mat-price')?.value || '',
                qty: row.querySelector('.custom-qty-input')?.value || '',
                complex: row.querySelector('.custom-complex')?.checked || false
            })),
            materials: Array.from(document.querySelectorAll('#materials-body tr')).map(row => ({
                name: row.querySelector('.mat-name')?.value || '',
                unit: row.querySelector('.mat-unit')?.value || '',
                price: row.querySelector('.mat-price')?.value || '',
                qty: row.querySelector('.mat-qty')?.value || ''
            }))
        };
    }

    /**
     * Сохранение черновика в localStorage
     */
    function saveDraft() {
        const name = (document.getElementById('draft-name')?.value || '').trim();
        if (!name) { alert('Введите название черновика'); return; }
        localStorage.setItem(`vg_draft_${name}`, JSON.stringify(getFormData()));
        updateDraftList();
        alert(`Черновик "${name}" сохранен!`);
    }

    /**
     * Загрузка черновика из localStorage
     */
    function loadDraft() {
        const select = document.getElementById('draft-select');
        const name = select ? select.value : '';
        if (!name) return;
        const data = JSON.parse(localStorage.getItem(`vg_draft_${name}`));
        if (!data) return;

        if (document.getElementById('client-name')) document.getElementById('client-name').value = data.clientName || '';
        if (document.getElementById('client-phone')) document.getElementById('client-phone').value = data.clientPhone || '';
        if (document.getElementById('client-address')) document.getElementById('client-address').value = data.clientAddress || '';
        if (document.getElementById('estimate-date')) document.getElementById('estimate-date').value = data.date || '';
        if (document.getElementById('invoice-number')) document.getElementById('invoice-number').value = data.invoiceNum || '';
        if (document.getElementById('master-buys-materials')) document.getElementById('master-buys-materials').checked = data.masterBuys !== false;
        if (document.getElementById('discount-input')) document.getElementById('discount-input').value = data.discount || '';

        window.servicesState = data.servicesState || {};
        if (data.currentSection) switchSection(data.currentSection);
        if (document.getElementById('category-select')) document.getElementById('category-select').value = data.currentCategory || 'all';
        window.currentCategory = data.currentCategory || 'all';

        renderServices(false);

        document.querySelectorAll('.custom-work-row').forEach(r => r.remove());
        if (data.customWorks && Array.isArray(data.customWorks)) {
            data.customWorks.forEach(w => {
                addCustomWorkRow(w.name, w.price, w.qty, w.unit, w.complex, false);
            });
        }

        const matBody = document.getElementById('materials-body');
        if (matBody) {
            matBody.textContent = '';
            if (data.materials && Array.isArray(data.materials)) {
                data.materials.forEach(m => addMaterialRow(m.name, m.price, m.qty, m.unit, false));
            }
        }

        calculateTotals();
    }

    /**
     * Удаление черновика из localStorage
     */
    function deleteDraft() {
        const select = document.getElementById('draft-select');
        const name = select ? select.value : '';
        if (!name) return;
        if (confirm(`Удалить черновик "${name}"?`)) {
            localStorage.removeItem(`vg_draft_${name}`);
            updateDraftList();
            if (select) select.value = '';
        }
    }

    /**
     * Обновление списка сохранённых черновиков
     */
    function updateDraftList() {
        const select = document.getElementById('draft-select');
        if (!select) return;
        select.textContent = '';

        const optDefault = document.createElement('option');
        optDefault.value = '';
        optDefault.textContent = '📂 Загрузить...';
        select.appendChild(optDefault);

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('vg_draft_')) {
                const draftName = key.replace('vg_draft_', '');
                const opt = document.createElement('option');
                opt.value = draftName;
                opt.textContent = draftName;
                select.appendChild(opt);
            }
        }
    }

    /**
     * Полная очистка калькулятора
     */
    function clearForm() {
        if (!confirm('Очистить все поля?')) return;
        window.servicesState = {};
        if (document.getElementById('client-name')) document.getElementById('client-name').value = '';
        if (document.getElementById('client-phone')) document.getElementById('client-phone').value = '';
        if (document.getElementById('client-address')) document.getElementById('client-address').value = '';
        if (document.getElementById('estimate-date')) document.getElementById('estimate-date').valueAsDate = new Date();
        if (document.getElementById('invoice-number')) document.getElementById('invoice-number').value = '';
        if (document.getElementById('master-buys-materials')) document.getElementById('master-buys-materials').checked = true;
        if (document.getElementById('discount-input')) document.getElementById('discount-input').value = '';
        document.querySelectorAll('.custom-work-row').forEach(r => r.remove());
        const matBody = document.getElementById('materials-body');
        if (matBody) matBody.textContent = '';
        renderServices(false);
        calculateTotals();
    }

    /**
     * Экспорт черновика в JSON-файл
     */
    function exportDraftToFile() {
        const draftName = (document.getElementById('draft-name')?.value || '').trim() || 'Смета_VoltGroup';
        const safeName = draftName.replace(/[^a-z0-9а-яё]/gi, '_');
        const data = getFormData();

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    /**
     * Импорт черновика из JSON-файла
     */
    function importDraftFromFile(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (document.getElementById('client-name')) document.getElementById('client-name').value = data.clientName || '';
                if (document.getElementById('client-phone')) document.getElementById('client-phone').value = data.clientPhone || '';
                if (document.getElementById('client-address')) document.getElementById('client-address').value = data.clientAddress || '';
                if (document.getElementById('estimate-date')) document.getElementById('estimate-date').value = data.date || '';
                if (document.getElementById('invoice-number')) document.getElementById('invoice-number').value = data.invoiceNum || '';
                if (document.getElementById('master-buys-materials')) document.getElementById('master-buys-materials').checked = data.masterBuys !== false;
                if (document.getElementById('discount-input')) document.getElementById('discount-input').value = data.discount || '';
                window.servicesState = data.servicesState || {};
                if (data.currentSection) switchSection(data.currentSection);
                if (document.getElementById('category-select')) document.getElementById('category-select').value = data.currentCategory || 'all';
                window.currentCategory = data.currentCategory || 'all';
                renderServices(false);

                document.querySelectorAll('.custom-work-row').forEach(r => r.remove());
                if (data.customWorks && Array.isArray(data.customWorks)) {
                    data.customWorks.forEach(w => {
                        addCustomWorkRow(w.name, w.price, w.qty, w.unit, w.complex, false);
                    });
                }
                const matBody = document.getElementById('materials-body');
                if (matBody) {
                    matBody.textContent = '';
                    if (data.materials && Array.isArray(data.materials)) {
                        data.materials.forEach(m => addMaterialRow(m.name, m.price, m.qty, m.unit, false));
                    }
                }
                calculateTotals();
                alert('✅ Черновик успешно загружен!');
            } catch (err) {
                console.error(err);
                alert('❌ Ошибка при чтении файла. Убедитесь, что это корректный JSON.');
            }
        };
        reader.readAsText(file);
        input.value = '';
    }

    /**
     * Всплывающее уведомление (toast)
     */
    function showToast(message) {
        let toast = document.getElementById('calc-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'calc-toast';
            toast.className = 'toast-notify';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2600);
    }

    /**
     * Копирование сметы для мессенджера (текстовый формат)
     */
    function copyEstimateToClipboard() {
        const totals = calculateTotals();
        if (totals.grandTotal === 0 && totals.materialsTotal === 0) {
            alert('Смета пуста! Укажите хотя бы одну работу или материал.');
            return;
        }

        const clientName = (document.getElementById('client-name')?.value || '').trim();
        const clientAddr = (document.getElementById('client-address')?.value || '').trim();
        const invoiceNum = (document.getElementById('invoice-number')?.value || '').trim();
        const dateRaw = document.getElementById('estimate-date')?.value;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');
        const masterBuys = document.getElementById('master-buys-materials')?.checked || false;

        let lines = [];
        lines.push('⚡ *Смета VoltGroup*');
        if (invoiceNum) lines.push(`📄 Номер: №${invoiceNum}`);
        if (date) lines.push(`📅 Дата: ${date}`);
        if (clientName) lines.push(`👤 Заказчик: ${clientName}`);
        if (clientAddr) lines.push(`📍 Объект: ${clientAddr}`);
        lines.push('');
        lines.push('🛠 *ВЫПОЛНЯЕМЫЕ РАБОТЫ:*');

        let num = 1;
        window.allServices.forEach((s, index) => {
            const state = window.servicesState[index] || { qty: 0, isComplex: false };
            if (state.qty > 0) {
                let price = s.price;
                let note = state.isComplex ? ' (+20% сложн.)' : '';
                let finalPrice = state.isComplex ? price * 1.2 : price;
                let sum = state.qty * finalPrice;
                lines.push(`${num++}. ${s.name}${note} — ${state.qty} ${s.unit} × ${Math.round(finalPrice).toLocaleString('ru-RU')} ₽ = ${Math.round(sum).toLocaleString('ru-RU')} ₽`);
            }
        });

        document.querySelectorAll('.custom-work-row').forEach(row => {
            const name = (row.querySelector('.name-input')?.value || 'Доп. работа').trim();
            const unit = (row.querySelector('.mat-unit')?.value || 'шт.').trim();
            const priceBase = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.custom-qty-input')?.value) || 0;
            const complexCheck = row.querySelector('.custom-complex');
            if (qty > 0 || priceBase > 0) {
                let finalPrice = (complexCheck && complexCheck.checked) ? priceBase * 1.2 : priceBase;
                let note = (complexCheck && complexCheck.checked) ? ' (+20% сложн.)' : '';
                let sum = qty * finalPrice;
                lines.push(`${num++}. ${name}${note} — ${qty} ${unit} × ${Math.round(finalPrice).toLocaleString('ru-RU')} ₽ = ${Math.round(sum).toLocaleString('ru-RU')} ₽`);
            }
        });

        let hasMaterials = false;
        let matLines = [];
        let matNum = 1;
        document.querySelectorAll('#materials-body tr').forEach(r => {
            const name = (r.querySelector('.mat-name')?.value || 'Материал').trim();
            const unit = (r.querySelector('.mat-unit')?.value || 'шт.').trim();
            const price = parseFloat(r.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(r.querySelector('.mat-qty')?.value) || 0;
            if (qty > 0 || price > 0) {
                hasMaterials = true;
                matLines.push(`${matNum++}. ${name} — ${qty} ${unit} × ${Math.round(price).toLocaleString('ru-RU')} ₽ = ${Math.round(price * qty).toLocaleString('ru-RU')} ₽`);
            }
        });

        if (hasMaterials) {
            lines.push('');
            lines.push(`📦 *МАТЕРИАЛЫ (${masterBuys ? 'закупка мастером' : 'закупка заказчиком'}):*`);
            lines.push(...matLines);
        }

        lines.push('');
        lines.push('💰 *ИТОГИ:*');
        lines.push(`Работы: ${totals.worksFinal.toLocaleString('ru-RU')} ₽`);
        if (totals.discountAmount > 0) {
            lines.push(`🎁 Скидка: -${totals.discountAmount.toLocaleString('ru-RU')} ₽`);
        }
        if (totals.materialsTotal > 0) {
            lines.push(`📦 Материалы: ${totals.materialsTotal.toLocaleString('ru-RU')} ₽${!masterBuys ? ' (закупка заказчиком)' : ''}`);
        }
        lines.push(`ИТОГО К ОПЛАТЕ: ${totals.grandTotal.toLocaleString('ru-RU')} ₽`);
        lines.push('');
        const comp = (typeof window !== 'undefined' && window.VG_COMPANY) ? window.VG_COMPANY : {};
        const compPhone = comp.phone || '+7 (905) 208-42-84';
        const compBrand = comp.brandName || 'VoltGroup';
        const compSite = comp.siteUrl || 'https://voltgroup-spb.ru';
        lines.push(`📞 Контакты: ${compPhone} (Матвей, ${compBrand})`);
        lines.push(`🌐 Сайт: ${compSite}`);

        const textToCopy = lines.join('\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showToast('📋 Смета скопирована в буфер обмена!');
            }).catch(() => {
                fallbackCopy(textToCopy);
            });
        } else {
            fallbackCopy(textToCopy);
        }
    }

    /**
     * Резервное копирование через временный textarea
     */
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('📋 Смета скопирована в буфер обмена!');
        } catch (err) {
            alert('Не удалось скопировать. Пожалуйста, скопируйте вручную.');
        }
        document.body.removeChild(ta);
    }

    /**
     * Формирование компактной сводки сметы для отправки мастера (Telegram)
     */
    function buildEstimateSummaryForLead(options = {}) {
        const maxItems = options.maxItems || 15;
        const totals = calculateTotals();
        const clientAddr = (document.getElementById('client-address')?.value || '').trim();
        const invoiceNum = (document.getElementById('invoice-number')?.value || '').trim();
        const dateRaw = document.getElementById('estimate-date')?.value;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : '';
        const masterBuys = document.getElementById('master-buys-materials')?.checked ?? true;

        let lines = [];
        if (clientAddr) lines.push(`📍 Адрес: ${clientAddr}`);
        if (invoiceNum) lines.push(`📄 Смета: №${invoiceNum}`);
        if (date) lines.push(`📅 Дата: ${date}`);
        if (lines.length > 0) lines.push('');

        // Собираем все выбранные работы
        let selectedWorks = [];
        (window.allServices || []).forEach((s, index) => {
            const state = (window.servicesState && window.servicesState[index]) || { qty: 0, isComplex: false };
            if (state.qty > 0) {
                let price = s.price;
                let note = state.isComplex ? ' (+20% сложн.)' : '';
                let finalPrice = state.isComplex ? price * 1.2 : price;
                let sum = state.qty * finalPrice;
                selectedWorks.push(`${s.name}${note} — ${state.qty} ${s.unit} × ${Math.round(finalPrice).toLocaleString('ru-RU')} ₽ = ${Math.round(sum).toLocaleString('ru-RU')} ₽`);
            }
        });

        document.querySelectorAll('.custom-work-row').forEach(row => {
            const name = (row.querySelector('.name-input')?.value || 'Доп. работа').trim();
            const unit = (row.querySelector('.mat-unit')?.value || 'шт.').trim();
            const priceBase = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.custom-qty-input')?.value) || 0;
            const complexCheck = row.querySelector('.custom-complex');
            if (qty > 0 || priceBase > 0) {
                let finalPrice = (complexCheck && complexCheck.checked) ? priceBase * 1.2 : priceBase;
                let note = (complexCheck && complexCheck.checked) ? ' (+20% сложн.)' : '';
                let sum = qty * finalPrice;
                selectedWorks.push(`${name}${note} — ${qty} ${unit} × ${Math.round(finalPrice).toLocaleString('ru-RU')} ₽ = ${Math.round(sum).toLocaleString('ru-RU')} ₽`);
            }
        });

        const totalWorksCount = selectedWorks.length;
        if (totalWorksCount > 0) {
            lines.push(`🛠 Работы (${totalWorksCount} поз.):`);
            const displayedWorks = selectedWorks.slice(0, maxItems);
            displayedWorks.forEach((item, idx) => {
                lines.push(`${idx + 1}. ${item}`);
            });
            if (totalWorksCount > maxItems) {
                lines.push(`… и ещё ${totalWorksCount - maxItems} позиций`);
            }
            lines.push('');
        }

        // Собираем материалы
        let materialItems = [];
        document.querySelectorAll('#materials-body tr').forEach(r => {
            const name = (r.querySelector('.mat-name')?.value || 'Материал').trim();
            const unit = (r.querySelector('.mat-unit')?.value || 'шт.').trim();
            const price = parseFloat(r.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(r.querySelector('.mat-qty')?.value) || 0;
            if (qty > 0 || price > 0) {
                materialItems.push(`${name} — ${qty} ${unit} × ${Math.round(price).toLocaleString('ru-RU')} ₽ = ${Math.round(price * qty).toLocaleString('ru-RU')} ₽`);
            }
        });

        if (materialItems.length > 0) {
            lines.push(`📦 Материалы (${masterBuys ? 'закупка мастером' : 'закупка заказчиком'}, ${materialItems.length} поз.):`);
            if (materialItems.length <= 5) {
                materialItems.forEach((m, idx) => lines.push(`${idx + 1}. ${m}`));
            } else {
                materialItems.slice(0, 5).forEach((m, idx) => lines.push(`${idx + 1}. ${m}`));
                lines.push(`… и ещё ${materialItems.length - 5} материалов`);
            }
            lines.push('');
        }

        lines.push('💰 Итоговый расчёт:');
        lines.push(`• Работы: ${totals.worksFinal.toLocaleString('ru-RU')} ₽`);
        if (totals.discountAmount > 0) {
            lines.push(`• Скидка: -${totals.discountAmount.toLocaleString('ru-RU')} ₽`);
        }
        if (totals.materialsTotal > 0) {
            lines.push(`• Материалы: ${totals.materialsTotal.toLocaleString('ru-RU')} ₽${!masterBuys ? ' (заказчик)' : ''}`);
        }
        lines.push(`• ИТОГО К ОПЛАТЕ: ${totals.grandTotal.toLocaleString('ru-RU')} ₽`);

        return {
            text: lines.join('\n'),
            totalWorksCount,
            materialsCount: materialItems.length,
            grandTotal: totals.grandTotal,
            materialsTotal: totals.materialsTotal
        };
    }

    /**
     * Отправка сметы мастеру из калькулятора (задача 046)
     */
    async function sendEstimateToMaster() {
        const statusEl = document.getElementById('estimate-send-status');
        const sendBtn = document.getElementById('btn-send-estimate');
        const phoneEl = document.getElementById('client-phone');
        const nameEl = document.getElementById('client-name');

        function showStatus(html, type) {
            if (!statusEl) return;
            statusEl.style.display = 'block';
            if (type === 'success') {
                statusEl.style.background = 'rgba(16, 185, 129, 0.12)';
                statusEl.style.borderColor = '#10B981';
                statusEl.style.color = '#10B981';
            } else if (type === 'warning') {
                statusEl.style.background = 'rgba(245, 158, 11, 0.12)';
                statusEl.style.borderColor = '#F59E0B';
                statusEl.style.color = '#F59E0B';
            } else if (type === 'error') {
                statusEl.style.background = 'rgba(239, 68, 68, 0.12)';
                statusEl.style.borderColor = '#EF4444';
                statusEl.style.color = '#EF4444';
            } else {
                statusEl.style.background = 'rgba(255, 255, 255, 0.04)';
                statusEl.style.borderColor = 'var(--border-light)';
                statusEl.style.color = 'var(--text-main)';
            }
            statusEl.innerHTML = html;
            try {
                statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (e) {}
        }

        const comp = (typeof window !== 'undefined' && window.VG_COMPANY) ? window.VG_COMPANY : {};
        const compPhone = comp.phone || '+7 (905) 208-42-84';
        const compPhoneClean = compPhone.replace(/[^\d+]/g, '');
        const compTg = comp.telegram || 'https://t.me/voltgroup_spb';
        const compVk = comp.vk || 'https://vk.com/voltgroup_spb';

        const summary = buildEstimateSummaryForLead({ maxItems: 15 });
        if (summary.totalWorksCount === 0 && summary.materialsCount === 0 && summary.grandTotal === 0) {
            showStatus('⚠️ <b>Смета пуста!</b> Добавьте хотя бы одну работу или материал в калькулятор перед отправкой.', 'warning');
            return;
        }

        const phoneVal = (phoneEl?.value || '').trim();
        const digits = phoneVal.replace(/\D/g, '');
        if (digits.length !== 11) {
            if (phoneEl) {
                phoneEl.classList.add('is-invalid');
                phoneEl.focus();
            }
            showStatus('⚠️ <b>Укажите телефон для связи:</b> +7 (XXX) XXX-XX-XX, чтобы мастер мог ответить по смете.', 'warning');
            return;
        }
        if (phoneEl) phoneEl.classList.remove('is-invalid');

        const clientName = (nameEl?.value || '').trim();

        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = '⏳ Отправляем смету...';
        }
        showStatus('⏳ Передаём смету мастеру VoltGroup...', 'info');

        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        let timeoutId = null;
        if (controller) {
            timeoutId = setTimeout(() => controller.abort(), 15000);
        }

        const payload = {
            name: clientName || 'Заказчик (из калькулятора)',
            phone: phoneVal,
            service: summary.text,
            source: 'Калькулятор сметы'
        };

        try {
            const apiUrl = (typeof window !== 'undefined' && window.VG_API) ? window.VG_API : 'https://voltgroup-bot.onrender.com';
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            };
            if (controller) {
                fetchOptions.signal = controller.signal;
            }

            const res = await fetch(`${apiUrl}/send-message`, fetchOptions);
            if (timeoutId) clearTimeout(timeoutId);

            if (res.ok) {
                showStatus(
                    `✅ <b>Смета успешно передана мастеру!</b><br>` +
                    `Мы изучим расчёт и свяжемся с вами в ближайшее время по номеру <b>${escapeHtml(phoneVal)}</b>.<br>` +
                    `При необходимости напишите напрямую мастеру в <a href="${compTg}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">Telegram</a>, ` +
                    `<a href="${compVk}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">ВКонтакте</a> или ` +
                    `позвоните <a href="tel:${compPhoneClean}" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">${compPhone}</a>.`,
                    'success'
                );
            } else if (res.status === 429) {
                const errData = await res.json().catch(() => ({}));
                const limitMsg = errData.msg || 'Слишком много запросов. Пожалуйста, подождите минуту.';
                showStatus(
                    `⚠️ <b>${escapeHtml(limitMsg)}</b><br>` +
                    `Свяжитесь с мастером напрямую: <a href="${compTg}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">Telegram</a> · ` +
                    `<a href="${compVk}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">ВКонтакте</a> · ` +
                    `<a href="tel:${compPhoneClean}" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">${compPhone}</a>`,
                    'warning'
                );
            } else {
                throw new Error(`Код ответа: ${res.status}`);
            }
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (err && err.name === 'AbortError') {
                showStatus(
                    `⏳ <b>Сервер просыпается</b> (холодный старт Render может занять до минуты).<br>` +
                    `Вы можете подождать немного и нажать повторно, либо связаться напрямую: ` +
                    `<a href="${compTg}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">Telegram</a> · ` +
                    `<a href="${compVk}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">ВКонтакте</a> · ` +
                    `<a href="tel:${compPhoneClean}" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">${compPhone}</a>`,
                    'warning'
                );
            } else {
                showStatus(
                    `❌ <b>Не удалось отправить смету автоматически.</b><br>` +
                    `Пожалуйста, свяжитесь с мастером напрямую: ` +
                    `<a href="${compTg}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">Telegram</a> · ` +
                    `<a href="${compVk}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">ВКонтакте</a> · ` +
                    `<a href="tel:${compPhoneClean}" style="color:var(--primary-install);text-decoration:underline;font-weight:600;">${compPhone}</a>`,
                    'error'
                );
            }
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = '⚡ Передать смету мастеру';
            }
        }
    }

    /**
     * Переключение выпадающего меню документов
     */
    function toggleDocsMenu(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('dropdownDocsMenu');
        if (menu) {
            menu.classList.toggle('show');
        }
    }

    /**
     * Закрытие меню документов при клике вне него
     */
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('dropdownDocsMenu');
        if (menu && menu.classList.contains('show')) {
            if (!e.target.closest('#docsDropdownContainer')) {
                menu.classList.remove('show');
            }
        }
    });

    /**
     * Форматирование ячейки для экспорта в CSV (экранирование ';' и '"')
     */
    function csvCell(val) {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    }

    /**
     * Формирование содержимого CSV-файла для экспорта сметы
     */
    function buildCsvData(totals) {
        const clientName = document.getElementById('client-name')?.value.trim() || 'Заказчик';
        const clientAddr = document.getElementById('client-address')?.value.trim() || 'г. Санкт-Петербург';
        const invoiceNum = document.getElementById('invoice-number')?.value.trim() || 'Смета-' + new Date().getFullYear();
        const dateRaw = document.getElementById('estimate-date')?.value;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');

        let csv = '\uFEFF';
        csv += `Смета VoltGroup;№ ${csvCell(invoiceNum)};Дата:;${csvCell(date)}\r\n`;
        csv += `Заказчик:;${csvCell(clientName)};Объект:;${csvCell(clientAddr)}\r\n\r\n`;
        csv += `№;Наименование работ / услуг;Ед. изм.;Кол-во;Цена, руб.;Сложность;Сумма, руб.\r\n`;

        let rowIdx = 1;
        window.allServices.forEach((s, index) => {
            const state = window.servicesState[index] || { qty: 0, isComplex: false };
            if (state.qty > 0) {
                let price = state.isComplex ? s.price * 1.2 : s.price;
                csv += `${rowIdx++};${csvCell(s.name)};${csvCell(s.unit)};${state.qty};${Math.round(price)};${state.isComplex ? '+20%' : 'Базовая'};${Math.round(state.qty * price)}\r\n`;
            }
        });

        document.querySelectorAll('.custom-work-row').forEach(row => {
            const name = (row.querySelector('.name-input')?.value || 'Доп. работа').trim();
            const unit = (row.querySelector('.mat-unit')?.value || 'шт.').trim();
            const priceBase = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.custom-qty-input')?.value) || 0;
            const complexCheck = row.querySelector('.custom-complex');
            if (qty > 0 || priceBase > 0) {
                let finalPrice = (complexCheck && complexCheck.checked) ? priceBase * 1.2 : priceBase;
                csv += `${rowIdx++};${csvCell(name)};${csvCell(unit)};${qty};${Math.round(finalPrice)};${(complexCheck && complexCheck.checked) ? '+20%' : 'Базовая'};${Math.round(qty * finalPrice)}\r\n`;
            }
        });

        let hasMaterials = false;
        let matRows = [];
        let mIdx = 1;
        document.querySelectorAll('#materials-body tr').forEach(row => {
            const name = (row.querySelector('.mat-name')?.value || 'Материал').trim();
            const unit = (row.querySelector('.mat-unit')?.value || 'шт.').trim();
            const price = parseFloat(row.querySelector('.mat-price')?.value) || 0;
            const qty = parseFloat(row.querySelector('.mat-qty')?.value) || 0;
            if (qty > 0 || price > 0) {
                hasMaterials = true;
                matRows.push(`${mIdx++};${csvCell(name)};${csvCell(unit)};${qty};${Math.round(price)};${Math.round(price * qty)}\r\n`);
            }
        });

        if (hasMaterials) {
            csv += `\r\nМАТЕРИАЛЫ И КОМПЛЕКТУЮЩИЕ\r\n`;
            csv += `№;Наименование материала;Ед. изм.;Кол-во;Цена, руб.;Сумма, руб.\r\n`;
            csv += matRows.join('');
        }

        csv += `\r\nИТОГИ\r\n`;
        csv += `Стоимость электромонтажных работ;${totals.worksFinal} руб.\r\n`;
        if (totals.discountAmount > 0) {
            csv += `Скидка;-${totals.discountAmount} руб.\r\n`;
        }
        if (totals.materialsTotal > 0) {
            const masterBuys = document.getElementById('master-buys-materials')?.checked;
            csv += `Стоимость материалов (${masterBuys ? 'закупка мастером' : 'закупка заказчиком'});${totals.materialsTotal} руб.\r\n`;
        }
        csv += `ИТОГО К ОПЛАТЕ;${totals.grandTotal} руб.\r\n`;

        return csv;
    }

    /**
     * Выгрузка сметы в файл Excel / CSV
     */
    function exportToExcel() {
        const totals = calculateTotals();
        if (totals.grandTotal === 0 && totals.materialsTotal === 0) {
            alert('Смета пуста! Укажите хотя бы одну работу или материал.');
            return null;
        }
        const invoiceNum = document.getElementById('invoice-number')?.value.trim() || 'Смета-' + new Date().getFullYear();
        const dateRaw = document.getElementById('estimate-date')?.value;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');

        const csv = buildCsvData(totals);

        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            const fileDate = date.replace(/[^\d.]/g, '').replace(/\./g, '-');
            const fileInvoice = invoiceNum.replace(/[/\\?%*:|"<>]/g, '-');
            a.download = `Смета_VoltGroup_${fileInvoice}_${fileDate}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            showToast('📊 Смета выгружена в Excel (.csv)!');
        }
        return csv;
    }

    // Экспорт в глобальную область видимости
    window.escapeHtml = escapeHtml;
    window.csvCell = csvCell;
    window.buildCsvData = buildCsvData;
    window.toggleOnlySelected = toggleOnlySelected;
    window.updateSelectedBadge = updateSelectedBadge;
    window.loadPrices = loadPrices;
    window.initApp = initApp;
    window.updateCategoryOptions = updateCategoryOptions;
    window.switchSection = switchSection;
    window.renderServices = renderServices;
    window.changeQty = changeQty;
    window.handleServiceChange = handleServiceChange;
    window.addCustomWorkRow = addCustomWorkRow;
    window.changeCustomQty = changeCustomQty;
    window.addMaterialRow = addMaterialRow;
    window.handleInputKeyNav = handleInputKeyNav;
    window.calculateTotals = calculateTotals;
    window.getFormData = getFormData;
    window.saveDraft = saveDraft;
    window.loadDraft = loadDraft;
    window.deleteDraft = deleteDraft;
    window.updateDraftList = updateDraftList;
    window.clearForm = clearForm;
    window.exportDraftToFile = exportDraftToFile;
    window.importDraftFromFile = importDraftFromFile;
    window.showToast = showToast;
    window.copyEstimateToClipboard = copyEstimateToClipboard;
    window.buildEstimateSummaryForLead = buildEstimateSummaryForLead;
    window.sendEstimateToMaster = sendEstimateToMaster;
    window.toggleDocsMenu = toggleDocsMenu;
    window.exportToExcel = exportToExcel;

})(window);
