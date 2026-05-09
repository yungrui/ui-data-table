class UiDataTable extends HTMLElement {
    #settings = {
        sortField: "",
        sortOrder: "asc",
        pageLength: 10,
        pageIndex: 1,
        pageLengthList: [5, 10, 20, 50],
        columns: [],
        noDataText: "查無資料",
        filterable: false,
        persistState: false,
        dataSourceType: "local",
        dataIdField: "id",
        pagerFormat: "default",
        pagerPosition: "top",
        textFirst: "最前頁",
        textPrev: "前一頁",
        textNext: "下一頁",
        textLast: "最後頁",
        imgFirst: "",
        imgPrev: "",
        imgNext: "",
        imgLast: "",
        textGoToPage: "第",
        textPage: "頁",
        textOf: "/",
        textTotalRecordsPrefix: "共 ",
        textTotalRecordsSuffix: " 筆",
        textPerPage: "筆/頁",
        serverDataField: "data",
        serverTotalField: "totalCount",
        serverSortKey: "_sort",
        serverOrderKey: "_order",
        serverPageKey: "_page",
        serverLimitKey: "_limit",
        loading: false,
        stickyHeader: false,
        resizable: false,
        virtualScroll: false,
        itemSize: 46,
    };
    #pagerInfo = { totalRecords: 0, totalPages: 0 };
    #localData = [];
    #processedLocalData = []; // Full filtered/sorted local data
    #serverDataCache = []; // Sparse array for virtual scroll server mode
    #fetchingPages = new Set(); // Track pages currently being fetched
    #currentPageData = [];
    #lastRequestData = {};
    #filterState = {};
    #checkedState = new Set();
    #debounceTimer = null;
    #table;
    #pagerTop;
    #pagerBottom;
    #container;
    #shadow;
    #renderPromise = null;
    #isInitialized = false;
    #lastHeaders = {};
    #onBeforeRender = null;
    #abortController = null;
    #isResizing = false;
    #virtualState = { startIndex: 0, endIndex: 20 };

    constructor() {
        super();
        this.#shadow = this.attachShadow({ mode: "open" });
    }

    #escapeHTML(str) {
        if (!str) return "";
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, m => map[m]);
    }

    connectedCallback() {
        this.#renderBase();
        this.#initializeAndRender();
        this.#container = this.#shadow.querySelector('.ui-dt-container');
        this.#container.addEventListener('scroll', this.#handleScroll.bind(this), { passive: true });
    }

    disconnectedCallback() {
        if (this.#container) {
            this.#container.removeEventListener('scroll', this.#handleScroll.bind(this));
        }
    }

    static get observedAttributes() {
        return [
            "sort-field", "sort-order", "page-length", "filterable", "persist-state",
            "pager-format", "pager-position", "no-data-text", "text-first", "text-prev", "text-next", "text-last",
            "img-first", "img-prev", "img-next", "img-last",
            "data-source-type", "fetch-data-url", "text-go-to-page", "text-page", "text-of",
            "text-total-records-prefix", "text-total-records-suffix", "text-per-page",
            "server-data-field", "server-total-field",
            "server-sort-key", "server-order-key", "server-page-key", "server-limit-key",
            "loading", "sticky-header", "resizable", "virtual-scroll", "item-size"
        ];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        const key = name.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        let value = newValue;

        switch (name) {
            case "page-length":
            case "item-size":
                value = Number(newValue);
                break;
            case "filterable":
            case "persist-state":
            case "loading":
            case "sticky-header":
            case "resizable":
            case "virtual-scroll":
                value = newValue === "true";
                break;
            default:
                value = newValue;
                break;
        }

        this.#settings[key] = value;
        if (this.#isInitialized) this.#scheduleRender();
    }

    set columns(value) {
        if (Array.isArray(value)) {
            this.#settings.columns = value;
            if (this.isConnected && this.#isInitialized) this.#createHeader();
            this.#scheduleRender();
        }
    }
    get columns() {
        return this.#settings.columns;
    }
    set pageLengthList(value) {
        if (Array.isArray(value)) {
            this.#settings.pageLengthList = value;
            if (this.#isInitialized) this.#scheduleRender();
        }
    }

    set onBeforeRender(value) {
        if (typeof value === 'function' || value === null) {
            this.#onBeforeRender = value;
        }
    }
    get onBeforeRender() {
        return this.#onBeforeRender;
    }

    async setData(data, method = "get", requestData = null, headers = null, keepHeaders = false) {
        this.#serverDataCache = [];
        this.#fetchingPages.clear();
        this.#virtualState = { startIndex: 0, endIndex: 20 };
        if (this.#container) this.#container.scrollTop = 0;

        if (this.#settings.dataSourceType === "local") {
            if (!Array.isArray(data)) {
                console.error("setData expects an array for local data.");
                return;
            }
            this.#localData = [...data];
            this.#settings.pageIndex = 1;
            this.#checkedState.clear();
        } else if (this.#settings.dataSourceType === "server") {
            if (requestData !== null && (typeof requestData !== "object" || requestData.constructor !== Object)) {
                console.error("requestData must be a plain object.");
                return;
            }
            if (headers !== null && (typeof headers !== "object" || headers.constructor !== Object)) {
                console.error("headers must be a plain object.");
                return;
            }

            this.#lastRequestData = { ...(requestData || {}), _method: method };
            
            if (keepHeaders) {
                this.#lastHeaders = { ...this.#lastHeaders, ...(headers || {}) };
            } else {
                this.#lastHeaders = { ...(headers || {}) };
            }

            this.#settings.pageIndex = 1;
            this.#checkedState.clear();
        }

        if (this.#isInitialized) {
            return await this.#scheduleRender();
        }
        return [];
    }

    updateHeaders(headers) {
        if (headers !== null && (typeof headers !== "object" || headers.constructor !== Object)) {
            console.error("headers must be a plain object.");
            return;
        }
        this.#lastHeaders = { ...this.#lastHeaders, ...(headers || {}) };
    }

    getSelectedRowsData() {
        return this.#currentPageData.filter((row) => this.#checkedState.has(row[this.#settings.dataIdField]));
    }
    clearState() {
        if (this.id && this.#settings.persistState) localStorage.removeItem(`ui-data-table-state-${this.id}`);
    }

    #initializeAndRender() {
        requestAnimationFrame(() => {
            this.#table = this.#shadow.querySelector("table");
            this.#pagerTop = this.#shadow.querySelector("#pager-top");
            this.#pagerBottom = this.#shadow.querySelector("#pager-bottom");
            this.#bindEvents();

            for (const attr of this.constructor.observedAttributes) {
                if (this.hasAttribute(attr)) {
                    this.attributeChangedCallback(attr, null, this.getAttribute(attr));
                }
            }
            this.#isInitialized = true;
            this.#createHeader();
            this.#doRender();
        });
    }

    #scheduleRender() {
        if (!this.isConnected || !this.#isInitialized) return Promise.resolve([]);
        if (this.#renderPromise) return this.#renderPromise;

        this.#renderPromise = new Promise((resolve, reject) => {
            requestAnimationFrame(async () => {
                try {
                    await this.#doRender();
                    resolve(this.#currentPageData);
                } catch (error) {
                    reject(error);
                } finally {
                    this.#renderPromise = null;
                }
            });
        });
        return this.#renderPromise;
    }

    #renderBase() {
        const html = `
            <style>
                :host {
                    /* Custom CSS Variables for easier theming and isolation */
                    --ui-dt-primary-color: #0d6efd;
                    --ui-dt-secondary-color: #6c757d;
                    --ui-dt-success-color: #198754;
                    --ui-dt-warning-color: #ffc107;
                    --ui-dt-text-color: #212529;
                    --ui-dt-border-color: #dee2e6;
                    --ui-dt-border-radius: .25rem;
                    --ui-dt-hover-bg: rgba(0,0,0,.075);
                    --ui-dt-striped-bg: rgba(0,0,0,.05);
                    --ui-dt-header-bg: #f8f9fa;
                    --ui-dt-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                }

                /* Table */
                .ui-dt-container { position: relative; overflow: auto; flex: 1; }
                .ui-dt-table { width: 100%; margin-bottom: 1rem; color: var(--ui-dt-text-color); vertical-align: top; border-color: var(--ui-dt-border-color); border-collapse: collapse; table-layout: fixed; font-family: var(--ui-dt-font-family); }
                .ui-dt-table > :not(caption) > * > * { padding: .75rem; background-color: transparent; border: 1px solid var(--ui-dt-border-color); }
                .ui-dt-table > tbody { vertical-align: inherit; } .ui-dt-table > thead { vertical-align: bottom; }
                .ui-dt-table-striped > tbody > tr:nth-of-type(odd) > * { background-color: var(--ui-dt-striped-bg); }
                .ui-dt-table-hover > tbody > tr:hover > * { background-color: var(--ui-dt-hover-bg); }
                .ui-dt-table th, .ui-dt-table td { text-align: center; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; position: relative; }
                .ui-dt-table thead th { font-weight: bold; background-color: var(--ui-dt-header-bg); }

                :host([sticky-header="true"]) .ui-dt-table thead th { position: sticky; top: 0; z-index: 10; border-bottom: 2px solid var(--ui-dt-border-color); }

                /* Loading Overlay */
                .ui-dt-loading-overlay {
                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(255, 255, 255, 0.7);
                    display: none; flex-direction: column; align-items: center; justify-content: center;
                    z-index: 100; font-family: var(--ui-dt-font-family);
                }
                :host([loading="true"]) .ui-dt-loading-overlay { display: flex; }
                .ui-dt-spinner {
                    width: 3rem; height: 3rem; border: 0.35em solid var(--ui-dt-border-color);
                    border-right-color: var(--ui-dt-primary-color); border-radius: 50%;
                    animation: ui-dt-spin 0.75s linear infinite; margin-bottom: 0.5rem;
                }
                @keyframes ui-dt-spin { to { transform: rotate(360deg); } }

                /* Resizer */
                .ui-dt-resizer {
                    position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
                    cursor: col-resize; user-select: none; z-index: 1;
                }
                .ui-dt-resizer:hover { background: var(--ui-dt-primary-color); }

                /* Form controls */
                .ui-dt-input, .ui-dt-select { display: block; width: 100%; padding: .375rem .75rem; font-size: 1rem; font-weight: 400; line-height: 1.5; color: var(--ui-dt-text-color); background-color: #fff; border: 1px solid var(--ui-dt-border-color); border-radius: var(--ui-dt-border-radius); appearance: none; }
                .ui-dt-select { padding-right: 2.25rem; background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23343a40' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right .75rem center; background-size: 16px 12px; }
                .ui-dt-input-sm, .ui-dt-select-sm { padding: .25rem .5rem; font-size: .875rem; border-radius: .2rem; min-height: calc(1.5em + .5rem + 2px); vertical-align: middle; min-width: 60px; /* Ensure minimum width */ }

                /* Pager */
                .ui-dt-pager-container { display: none; flex-wrap: wrap; justify-content: space-between; align-items: center; padding: .5rem .75rem; gap: .75rem; font-family: var(--ui-dt-font-family); font-size: .875rem; }
                :host(:not([pager-position])) #pager-top,
                :host([pager-position="top"]) #pager-top,
                :host([pager-position="both"]) #pager-top { display: flex; }
                :host([pager-position="bottom"]) #pager-bottom,
                :host([pager-position="both"]) #pager-bottom { display: flex; }
                :host([virtual-scroll="true"]) .ui-dt-pager-container { display: none !important; }
                .ui-dt-page-link-group { display: flex; align-items: center; gap: .25rem; white-space: nowrap; }

                .ui-dt-pagination { display: flex; padding-left: 0; list-style: none; border-radius: var(--ui-dt-border-radius); margin: 0; }
                .ui-dt-page-item { margin: 0; }
                .ui-dt-page-link { position: relative; display: flex; align-items: center; justify-content: center; padding: .25rem .5rem; color: var(--ui-dt-primary-color); text-decoration: none; background-color: #fff; border: 1px solid var(--ui-dt-border-color); transition: color .15s ease-in-out, background-color .15s ease-in-out, border-color .15s ease-in-out; min-height: 31px; }
                .ui-dt-page-link img { max-height: 1.2em; width: auto; display: block; }
                .ui-dt-page-item:first-child .ui-dt-page-link { border-top-left-radius: var(--ui-dt-border-radius); border-bottom-left-radius: var(--ui-dt-border-radius); }
                .ui-dt-page-item:last-child .ui-dt-page-link { border-top-right-radius: var(--ui-dt-border-radius); border-bottom-right-radius: var(--ui-dt-border-radius); }
                .ui-dt-page-link:hover { z-index: 2; color: #0a58ca; background-color: #e9ecef; border-color: #dee2e6; }
                .ui-dt-page-item.active .ui-dt-page-link { z-index: 3; color: #fff; background-color: var(--ui-dt-primary-color); border-color: var(--ui-dt-primary-color); }
                .ui-dt-page-item.disabled .ui-dt-page-link { color: var(--ui-dt-secondary-color); pointer-events: none; background-color: #fff; border-color: var(--ui-dt-border-color); }
                
                /* Pager Formats & Filter Row */
                .ui-dt-pager-format-default, .ui-dt-pager-format-numbers { display: inline-flex; align-items: center; gap: .25rem; white-space: nowrap; }
                :host([pager-format="numbers"]) .ui-dt-pager-format-default { display: none; } :host(:not([pager-format="numbers"])) .ui-dt-pager-format-numbers { display: flex; }
                .ui-dt-filter-row { display: none; } :host([filterable="true"]) .ui-dt-filter-row { display: table-row; }
                :host([virtual-scroll="true"]) .ui-dt-pager-container { display: none !important; }

                /* Skeleton for Virtual Scroll */
                .ui-dt-skeleton { height: 1.2em; background: linear-gradient(90deg, #f2f2f2 25%, #e6e6e6 50%, #f2f2f2 75%); background-size: 200% 100%; animation: ui-dt-skeleton-loading 1.5s infinite; border-radius: 4px; width: 100%; }
                @keyframes ui-dt-skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

                /* Other custom styles */
                .ui-dt-sortable-btn { border: none; background: none; cursor: pointer; font-weight: bold; padding: 0; color: inherit; font-size: inherit; width: 100%; text-align: center;}
                .ui-dt-sort-arrow.up::after { content: ' ▲'; } .ui-dt-sort-arrow.down::after { content: ' ▼'; } .ui-dt-sort-arrow.both::after { content: ' ↕'; }
                .ui-dt-check-input { width: 1em; height: 1em; margin-top: .25em; vertical-align: top; background-color: #fff; border: 1px solid rgba(0,0,0,.25); border-radius: .25em; appearance: none; }
                .ui-dt-check-input:checked { background-color: var(--ui-dt-primary-color); border-color: var(--ui-dt-primary-color); background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3e%3cpath fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='3' d='M6 10l3 3l6-6'/%3e%3c/svg%3e"); background-size: 100% 100%; }

                .ui-dt-badge { display: inline-block; padding: .35em .65em; font-size: .75em; font-weight: 700; line-height: 1; color: #fff; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: .25rem; }
                .ui-dt-bg-success { background-color: var(--ui-dt-success-color) !important; } .ui-dt-bg-warning { background-color: var(--ui-dt-warning-color) !important; color: #000 !important; }

                /* Utility/Helper Classes (for internal use) */
                .ui-dt-d-flex { display: flex !important; }
                .ui-dt-align-items-center { align-items: center !important; }
                .ui-dt-gap-1 { gap: .25rem !important; }
                .ui-dt-m-0 { margin: 0 !important; }
                .ui-dt-text-secondary { color: var(--ui-dt-secondary-color) !important; }
            </style>
            <div id="pager-top" class="ui-dt-pager-container" part="pager-container-top"></div>
            <div class="ui-dt-container ui-dt-table-responsive" part="table-container">
                <div class="ui-dt-loading-overlay" part="loading-overlay"><div class="ui-dt-spinner" part="loading-spinner"></div></div>
                <table part="table" class="ui-dt-table ui-dt-table-striped ui-dt-table-hover">
                    <thead part="table-header"></thead>
                    <tbody part="table-body"></tbody>
                </table>
            </div>
            <div id="pager-bottom" class="ui-dt-pager-container" part="pager-container-bottom"></div>`;
        this.#shadow.innerHTML = html;
    }

    async #doRender() {
        if (!this.isConnected) return;
        this.#loadState();
        this.#createHeader();
        this.#updateSortArrows();

        const wasLoading = this.#settings.loading;
        if (!wasLoading) {
            this.#settings.loading = true;
            this.setAttribute('loading', 'true');
        }

        try {
            if (this.#settings.dataSourceType === 'server') {
                await this.#fetchAndRenderServerSide();
            } else {
                this.#processLocalData();
            }

            // Execute onBeforeRender hook if defined
            if (typeof this.#onBeforeRender === 'function') {
                const result = this.#onBeforeRender(this.#currentPageData);
                if (Array.isArray(result)) {
                    this.#currentPageData = result;
                }
            }

            this.#renderBody();
            this.#renderPager();
        } catch (error) {
            if (error.name === 'AbortError') return; // Ignore aborts
            console.error("Data rendering failed:", error);
            this.#currentPageData = [];
            this.#renderBody();
            this.#renderPager();
            throw error;
        } finally {
            if (!wasLoading) {
                this.#settings.loading = false;
                this.removeAttribute('loading');
            }
        }
    }

    async #fetchAndRenderServerSide() {
        if (!this.#settings.fetchDataUrl) {
            this.#currentPageData = [];
            this.#renderBody();
            this.#renderPager();
            return;
        }

        const { virtualScroll } = this.#settings;

        if (virtualScroll) {
            await this.#fetchRequiredPagesForVirtual();
            return;
        }

        if (this.#abortController) {
            this.#abortController.abort();
        }
        this.#abortController = new AbortController();

        const { sortField, sortOrder, pageIndex, pageLength, serverSortKey, serverOrderKey, serverPageKey, serverLimitKey } = this.#settings;
        const serverParams = {
            [serverSortKey]: sortField,
            [serverOrderKey]: sortOrder,
            [serverPageKey]: pageIndex,
            [serverLimitKey]: pageLength,
            ...this.#filterState
        };
        Object.keys(serverParams).forEach(key => (serverParams[key] === undefined || serverParams[key] === "") && delete serverParams[key]);

        let url = this.#settings.fetchDataUrl;
        const method = (this.#lastRequestData._method || "get").toUpperCase();
        const requestBody = { ...this.#lastRequestData, ...serverParams };
        delete requestBody._method;

        const fetchOptions = { 
            method,
            headers: { ...this.#lastHeaders },
            signal: this.#abortController.signal
        };

        if (method === "GET") {
            const params = new URLSearchParams(requestBody);
            url += (url.includes("?") ? "&" : "?") + params.toString();
        } else if (method === "POST") {
            fetchOptions.headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(requestBody);
        }

        const response = await fetch(url, fetchOptions);
        if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);

        const headerTotal = parseInt(response.headers.get('X-Total-Count'), 10);
        const jsonResponse = await response.json();

        let serverData = [];
        let totalRecords = isNaN(headerTotal) ? 0 : headerTotal;

        if (Array.isArray(jsonResponse)) {
            serverData = jsonResponse;
        } else if (jsonResponse && typeof jsonResponse === 'object') {
            serverData = this.#getNestedValue(jsonResponse, this.#settings.serverDataField) || [];
            const total = this.#getNestedValue(jsonResponse, this.#settings.serverTotalField);
            if (total !== undefined) {
                totalRecords = parseInt(total, 10);
            }
        }

        if (!Array.isArray(serverData)) throw new Error("Fetched data is not an array.");

        this.#pagerInfo.totalRecords = isNaN(totalRecords) ? 0 : totalRecords;
        this.#pagerInfo.totalPages = Math.ceil(this.#pagerInfo.totalRecords / pageLength) || 1;

        this.#currentPageData = serverData;

        this.#renderBody();
        this.#renderPager();
    }

    async #fetchRequiredPagesForVirtual() {
        const { startIndex, endIndex } = this.#virtualState;
        const { pageLength } = this.#settings;
        
        const startPage = Math.floor(startIndex / pageLength) + 1;
        const endPage = Math.floor(endIndex / pageLength) + 1;

        const pagesToFetch = [];
        for (let p = startPage; p <= endPage; p++) {
            const blockStart = (p - 1) * pageLength;
            if (this.#serverDataCache[blockStart] === undefined && !this.#fetchingPages.has(p)) {
                pagesToFetch.push(p);
            }
        }

        if (pagesToFetch.length === 0) {
            this.#renderBody();
            return;
        }

        await Promise.all(pagesToFetch.map(page => this.#fetchSpecificPage(page)));
        this.#renderBody();
    }

    async #fetchSpecificPage(page) {
        this.#fetchingPages.add(page);
        const { sortField, sortOrder, pageLength, serverSortKey, serverOrderKey, serverPageKey, serverLimitKey } = this.#settings;
        const serverParams = {
            [serverSortKey]: sortField,
            [serverOrderKey]: sortOrder,
            [serverPageKey]: page,
            [serverLimitKey]: pageLength,
            ...this.#filterState
        };
        Object.keys(serverParams).forEach(key => (serverParams[key] === undefined || serverParams[key] === "") && delete serverParams[key]);

        let url = this.#settings.fetchDataUrl;
        const method = (this.#lastRequestData._method || "get").toUpperCase();
        const requestBody = { ...this.#lastRequestData, ...serverParams };
        delete requestBody._method;

        const fetchOptions = { 
            method,
            headers: { ...this.#lastHeaders }
        };

        if (method === "GET") {
            const params = new URLSearchParams(requestBody);
            url += (url.includes("?") ? "&" : "?") + params.toString();
        } else if (method === "POST") {
            fetchOptions.headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(requestBody);
        }

        try {
            const response = await fetch(url, fetchOptions);
            if (!response.ok) throw new Error(`Fetch failed`);
            
            const headerTotal = parseInt(response.headers.get('X-Total-Count'), 10);
            const jsonResponse = await response.json();
            
            let serverData = [];
            let totalRecords = isNaN(headerTotal) ? 0 : headerTotal;

            if (Array.isArray(jsonResponse)) {
                serverData = jsonResponse;
            } else if (jsonResponse && typeof jsonResponse === 'object') {
                serverData = this.#getNestedValue(jsonResponse, this.#settings.serverDataField) || [];
                const total = this.#getNestedValue(jsonResponse, this.#settings.serverTotalField);
                if (total !== undefined) totalRecords = parseInt(total, 10);
            }

            if (isNaN(this.#pagerInfo.totalRecords) || this.#pagerInfo.totalRecords === 0) {
                this.#pagerInfo.totalRecords = totalRecords;
            }

            const startIndex = (page - 1) * pageLength;
            serverData.forEach((row, i) => {
                this.#serverDataCache[startIndex + i] = row;
            });

        } catch (e) {
            console.error(e);
        } finally {
            this.#fetchingPages.delete(page);
        }
    }

    #handleScroll() {
        if (!this.#settings.virtualScroll) return;
        
        const { scrollTop, clientHeight } = this.#container;
        const { itemSize } = this.#settings;
        
        const buffer = 5;
        const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - buffer);
        const endIndex = Math.min(this.#pagerInfo.totalRecords, Math.ceil((scrollTop + clientHeight) / itemSize) + buffer);

        if (startIndex !== this.#virtualState.startIndex || endIndex !== this.#virtualState.endIndex) {
            this.#virtualState = { startIndex, endIndex };
            if (this.#settings.dataSourceType === 'server') {
                this.#fetchRequiredPagesForVirtual();
            } else {
                this.#renderBody();
            }
        }
    }

    #getNestedValue(obj, path) {
        if (!path || !obj) return undefined;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    #processLocalData() {
        let data = [...this.#localData];
        const { filterable, sortField, sortOrder, pageIndex, pageLength, virtualScroll } = this.#settings;

        if (filterable) {
            const activeFilters = Object.entries(this.#filterState).filter(([, val]) => val);
            if (activeFilters.length > 0) {
                data = data.filter((row) =>
                    activeFilters.every(([field, val]) =>
                        String(row[field] ?? "").toLowerCase().includes(val.toLowerCase())
                    )
                );
            }
        }
        if (sortField) {
            data.sort((a, b) => {
                const valA = String(a[sortField] ?? '');
                const valB = String(b[sortField] ?? '');
                return valA.localeCompare(valB, undefined, { numeric: true }) * (sortOrder === "asc" ? 1 : -1);
            });
        }
        this.#pagerInfo.totalRecords = data.length;
        this.#pagerInfo.totalPages = Math.ceil(data.length / pageLength) || 1;
        
        if (virtualScroll) {
            this.#processedLocalData = data;
            this.#currentPageData = []; 
        } else {
            const startIndex = (pageIndex - 1) * pageLength;
            this.#currentPageData = data.slice(startIndex, startIndex + pageLength);
        }
    }

    #createHeader() {
        const thead = this.#table?.querySelector("thead");
        if (!thead) return;
        thead.innerHTML = "";

        const headerRow = document.createElement("tr");
        const filterRow = document.createElement("tr");
        filterRow.className = "ui-dt-filter-row";

        (this.#settings.columns || []).forEach((col) => {
            const th = document.createElement("th");
            th.setAttribute("aria-sort", "none");
            th.setAttribute("part", "table-header-cell");

            const contentWrapper = document.createElement("div");
            contentWrapper.style.display = "inline-flex";
            contentWrapper.style.alignItems = "center";
            contentWrapper.style.justifyContent = "center";
            contentWrapper.style.width = "100%";

            if (col.isCheckbox) {
                const checkAll = document.createElement("input");
                checkAll.type = "checkbox";
                checkAll.className = "ui-dt-check-all ui-dt-form-check-input";
                contentWrapper.appendChild(checkAll);
            } else if (col.sortable) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ui-dt-sortable-btn";
                btn.dataset.sortField = col.field;
                btn.textContent = col.title || "";
                const arrow = document.createElement("span");
                arrow.className = "ui-dt-sort-arrow both";
                btn.appendChild(arrow);
                contentWrapper.appendChild(btn);
            } else {
                contentWrapper.textContent = col.title || "";
            }
            th.appendChild(contentWrapper);

            if (this.#settings.resizable) {
                const resizer = document.createElement("div");
                resizer.className = "ui-dt-resizer";
                th.appendChild(resizer);
                this.#bindResizerEvents(resizer, th);
            }

            headerRow.appendChild(th);

            const filterTh = document.createElement("th");
            filterTh.setAttribute("part", "table-header-cell");
            if (!col.isCheckbox && this.#settings.dataSourceType === 'local' && this.#settings.filterable && col.filterable !== false) {
                const input = document.createElement("input");
                input.type = "text";
                input.className = "ui-dt-filter-input ui-dt-input ui-dt-input-sm";
                input.dataset.filterField = col.field;
                input.value = this.#filterState[col.field] || "";
                input.addEventListener("input", (e) => this.#handleFilter(e.target));
                filterTh.appendChild(input);
            }
            filterRow.appendChild(filterTh);
        });

        thead.appendChild(headerRow);
        thead.appendChild(filterRow);
    }

    #renderBody() {
        const tbody = this.#table?.querySelector("tbody");
        if (!tbody) return;

        const { virtualScroll, itemSize, columns, dataSourceType } = this.#settings;
        const totalRecords = this.#pagerInfo.totalRecords;
        
        tbody.innerHTML = "";

        if (totalRecords === 0 || !columns || columns.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = (columns || []).length || 1;
            td.style.textAlign = "center";
            td.setAttribute("part", "table-cell");

            const emptySlot = this.querySelector('[slot="empty"]');
            if (emptySlot) {
                const slot = document.createElement('slot');
                slot.name = 'empty';
                td.appendChild(slot);
            } else {
                td.textContent = this.#settings.noDataText;
            }

            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        let renderStartIndex = 0;
        let renderEndIndex = 0;

        if (virtualScroll) {
            renderStartIndex = this.#virtualState.startIndex;
            renderEndIndex = Math.min(totalRecords, this.#virtualState.endIndex);
            
            const topPadding = renderStartIndex * itemSize;
            const bottomPadding = Math.max(0, (totalRecords - renderEndIndex) * itemSize);

            // Top spacer
            if (topPadding > 0) {
                const spacer = document.createElement('tr');
                spacer.style.height = `${topPadding}px`;
                spacer.innerHTML = `<td colspan="${columns.length}" style="padding:0; border:0; height:${topPadding}px"></td>`;
                tbody.appendChild(spacer);
            }

            for (let i = renderStartIndex; i < renderEndIndex; i++) {
                let rowData = null;
                if (dataSourceType === 'local') {
                    rowData = this.#processedLocalData[i];
                } else {
                    rowData = this.#serverDataCache[i];
                }

                const tr = document.createElement("tr");
                tr.setAttribute("part", "table-row");
                if (rowData) {
                    this.#renderRow(tr, rowData);
                } else {
                    this.#renderSkeletonRow(tr);
                }
                tbody.appendChild(tr);
            }

            // Bottom spacer
            if (bottomPadding > 0) {
                const spacer = document.createElement('tr');
                spacer.style.height = `${bottomPadding}px`;
                spacer.innerHTML = `<td colspan="${columns.length}" style="padding:0; border:0; height:${bottomPadding}px"></td>`;
                tbody.appendChild(spacer);
            }
        } else {
            renderEndIndex = this.#currentPageData.length;
            this.#currentPageData.forEach((rowData) => {
                const tr = document.createElement("tr");
                this.#renderRow(tr, rowData);
                tbody.appendChild(tr);
            });
        }
        this.#updateHeaderCheckboxState();
    }

    #renderRow(tr, rowData) {
        const rowId = rowData[this.#settings.dataIdField];
        tr.style.cursor = "pointer";
        tr.addEventListener("click", (e) => {
            if (e.target.type === "checkbox" || e.target.closest("button") || e.target.closest("a")) return;
            this.#dispatchEvent("row-click", { rowData, rowId });
        });

        (this.#settings.columns || []).forEach((col) => {
            const td = document.createElement("td");
            td.setAttribute("part", "table-cell");
            if (col.isCheckbox) {
                const chk = document.createElement("input");
                chk.type = "checkbox";
                chk.dataset.rowId = rowId;
                chk.checked = this.#checkedState.has(rowId);
                chk.className = "ui-dt-check-input";
                td.appendChild(chk);
            } else if (typeof col.render === "function") {
                const html = col.render(rowData);
                if (typeof html === 'string') {
                    const temp = document.createElement('div');
                    temp.innerHTML = html; 
                    while (temp.firstChild) td.appendChild(temp.firstChild);
                } else if (html instanceof HTMLElement || html instanceof DocumentFragment) {
                    td.appendChild(html);
                }
            } else if (col.field) {
                td.textContent = rowData[col.field] ?? "";
            }
            tr.appendChild(td);
        });
    }

    #renderSkeletonRow(tr) {
        (this.#settings.columns || []).forEach(() => {
            const td = document.createElement("td");
            td.setAttribute("part", "table-cell");
            const skeleton = document.createElement('div');
            skeleton.className = "ui-dt-skeleton";
            td.appendChild(skeleton);
            tr.appendChild(td);
        });
    }

    #bindResizerEvents(resizer, th) {
        let startX, startWidth;

        const onMouseMove = (e) => {
            if (!this.#isResizing) return;
            const width = startWidth + (e.pageX - startX);
            if (width > 30) {
                th.style.width = `${width}px`;
            }
        };

        const onMouseUp = () => {
            this.#isResizing = false;
            resizer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', (e) => {
            startX = e.pageX;
            startWidth = th.offsetWidth;
            this.#isResizing = true;
            resizer.classList.add('resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });
    }

    #dispatchEvent(name, detail) {
        this.dispatchEvent(new CustomEvent(name, {
            detail,
            bubbles: true,
            composed: true
        }));
    }

    #bindEvents() {
        this.#shadow.addEventListener("click", (e) => {
            const target = e.target.closest("[data-pager-action], [data-page-index], .ui-dt-sortable-btn");
            if (!target) return;
            e.preventDefault();

            if (target.matches(".ui-dt-sortable-btn")) this.#sort(target);
            else if (target.matches("[data-page-index]")) this.#gotoPageNum(target);
            else if (target.matches("[data-pager-action]")) this.#gotoPageAction(target);
        });
        this.#shadow.addEventListener("change", (e) => {
            const target = e.target;
            if (target.matches(".ui-dt-check-all")) {
                this.#toggleCheckAll(target.checked);
                this.#renderBody();
                this.#dispatchEvent("selection-change", { selectedRows: this.getSelectedRowsData() });
            } else if (target.matches('tbody input[type="checkbox"]')) {
                this.#toggleCheckRow(target);
                this.#dispatchEvent("selection-change", { selectedRows: this.getSelectedRowsData() });
            } else if (target.matches("select[data-pager-action]")) {
                this.#handlePagerSelect(target);
            }
        });
    }

    #renderPager() {
        const { totalRecords, totalPages } = this.#pagerInfo;
        const { pageIndex, pageLength, pageLengthList, pagerPosition, pagerFormat } = this.#settings;

        const updatePagerContainer = (container) => {
            if (!container) return;
            container.innerHTML = "";
            if (totalRecords === 0) return;

            const isFirst = pageIndex <= 1, isLast = pageIndex >= totalPages;

            // 1. Navigation Group
            const navGroup = document.createElement("div");
            navGroup.className = "ui-dt-page-link-group";

            if (totalPages > 1) {
                const pagination = document.createElement("ul");
                pagination.className = "ui-dt-pagination ui-dt-pagination-sm ui-dt-m-0";

                const createPageItem = (action, content, disabled) => {
                    const li = document.createElement("li");
                    li.className = `ui-dt-page-item ${disabled ? "disabled" : ""}`;
                    const a = document.createElement("a");
                    a.className = "ui-dt-page-link";
                    a.href = "#";
                    a.dataset.pagerAction = action;
                    if (typeof content === 'string' && content.includes('<')) {
                        const temp = document.createElement('div');
                        temp.innerHTML = content;
                        while(temp.firstChild) a.appendChild(temp.firstChild);
                    } else if (content instanceof HTMLElement) {
                        a.appendChild(content);
                    } else {
                        a.textContent = content;
                    }
                    li.appendChild(a);
                    return li;
                };

                const getNavIcon = (type) => {
                    const imgKey = `img${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    const textKey = `text${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    if (this.#settings[imgKey]) {
                        const img = document.createElement("img");
                        img.src = this.#settings[imgKey];
                        img.alt = type;
                        return img;
                    }
                    return this.#settings[textKey];
                };

                pagination.appendChild(createPageItem("first", getNavIcon("first"), isFirst));
                pagination.appendChild(createPageItem("prev", getNavIcon("prev"), isFirst));
                navGroup.appendChild(pagination);

                // Default Format (Jump Select)
                if (pagerFormat === "default") {
                    const jumpContainer = document.createElement("div");
                    jumpContainer.className = "ui-dt-pager-format-default ui-dt-d-flex ui-dt-align-items-center ui-dt-gap-1";
                    const spanPrefix = document.createElement("span");
                    spanPrefix.className = "ui-dt-text-secondary";
                    spanPrefix.textContent = this.#settings.textGoToPage;
                    const select = document.createElement("select");
                    select.className = "ui-dt-select ui-dt-select-sm";
                    select.style.width = "auto";
                    select.dataset.pagerAction = "page-jump";
                    for (let i = 1; i <= totalPages; i++) {
                        const opt = new Option(i, i);
                        if (i === pageIndex) opt.selected = true;
                        select.add(opt);
                    }
                    const spanSuffix = document.createElement("span");
                    spanSuffix.className = "ui-dt-text-secondary";
                    spanSuffix.textContent = ` ${this.#settings.textOf} ${totalPages} ${this.#settings.textPage}`;
                    
                    jumpContainer.append(spanPrefix, select, spanSuffix);
                    navGroup.appendChild(jumpContainer);
                }

                // Numbers Format
                if (pagerFormat === "numbers") {
                    const numNav = document.createElement("nav");
                    numNav.className = "ui-dt-pager-format-numbers";
                    const numUl = document.createElement("ul");
                    numUl.className = "ui-dt-pagination ui-dt-pagination-sm ui-dt-m-0";

                    const pagesToShow = new Set();
                    for (let i = 1; i <= Math.min(2, totalPages); i++) pagesToShow.add(i);
                    for (let i = pageIndex - 1; i <= pageIndex + 1; i++) if (i > 0 && i <= totalPages) pagesToShow.add(i);
                    for (let i = totalPages - 1; i <= totalPages; i++) if (i > 0) pagesToShow.add(i);

                    const sortedPages = [...pagesToShow].sort((a, b) => a - b);
                    let lastPage = 0;
                    sortedPages.forEach((p) => {
                        if (lastPage > 0 && p - lastPage > 1) {
                            const li = document.createElement("li");
                            li.className = "ui-dt-page-item disabled";
                            const span = document.createElement("span");
                            span.className = "ui-dt-page-link";
                            span.textContent = "...";
                            li.appendChild(span);
                            numUl.appendChild(li);
                        }
                        const li = document.createElement("li");
                        li.className = `ui-dt-page-item ${p === pageIndex ? "active" : ""}`;
                        const a = document.createElement("a");
                        a.className = "ui-dt-page-link";
                        a.href = "#";
                        a.dataset.pageIndex = p;
                        a.textContent = p;
                        li.appendChild(a);
                        numUl.appendChild(li);
                        lastPage = p;
                    });
                    numNav.appendChild(numUl);
                    navGroup.appendChild(numNav);
                }

                const paginationRight = document.createElement("ul");
                paginationRight.className = "ui-dt-pagination ui-dt-pagination-sm ui-dt-m-0";
                paginationRight.appendChild(createPageItem("next", getNavIcon("next"), isLast));
                paginationRight.appendChild(createPageItem("last", getNavIcon("last"), isLast));
                navGroup.appendChild(paginationRight);
            }

            // 2. Info Group
            const infoGroup = document.createElement("div");
            infoGroup.className = "ui-dt-page-link-group";
            const totalSpan = document.createElement("span");
            totalSpan.className = "ui-dt-text-secondary";
            totalSpan.textContent = `${this.#settings.textTotalRecordsPrefix}${totalRecords}${this.#settings.textTotalRecordsSuffix}`;
            
            const lenContainer = document.createElement("div");
            lenContainer.className = "ui-dt-d-flex ui-dt-align-items-center ui-dt-gap-1";
            const lenSelect = document.createElement("select");
            lenSelect.className = "ui-dt-select ui-dt-select-sm";
            lenSelect.style.width = "auto";
            lenSelect.dataset.pagerAction = "pageLength";
            [...new Set([...pageLengthList, pageLength])].sort((a, b) => a - b).forEach((len) => {
                const opt = new Option(len, len);
                if (len === pageLength) opt.selected = true;
                lenSelect.add(opt);
            });
            const lenLabel = document.createElement("label");
            lenLabel.className = "ui-dt-text-secondary";
            lenLabel.textContent = this.#settings.textPerPage;

            lenContainer.append(lenSelect, lenLabel);
            infoGroup.append(totalSpan, lenContainer);

            container.append(navGroup, infoGroup);
        };

        if (this.#pagerTop) updatePagerContainer(pagerPosition === "top" || pagerPosition === "both" ? this.#pagerTop : null);
        if (this.#pagerBottom) updatePagerContainer(pagerPosition === "bottom" || pagerPosition === "both" ? this.#pagerBottom : null);
    }

    #sort(btn) {
        const field = btn.dataset.sortField;
        this.#settings.sortOrder = this.#settings.sortField === field && this.#settings.sortOrder === "asc" ? "desc" : "asc";
        this.#settings.sortField = field;
        this.#settings.pageIndex = 1;
        this.#saveState();
        this.#dispatchEvent("sort-change", { field: this.#settings.sortField, order: this.#settings.sortOrder });
        this.#scheduleRender();
    }
    #gotoPageNum(btn) {
        const pageIndex = Number(btn.dataset.pageIndex);
        if (!btn.parentElement.classList.contains("disabled") && this.#settings.pageIndex !== pageIndex) {
            this.#settings.pageIndex = pageIndex;
            this.#dispatchEvent("page-change", { pageIndex: this.#settings.pageIndex });
            this.#scheduleRender();
        }
    }
    #gotoPageAction(btn) {
        if (btn.parentElement.classList.contains("disabled")) return;
        const p = this.#settings.pageIndex, t = this.#pagerInfo.totalPages;
        switch (btn.dataset.pagerAction) {
            case "first": this.#settings.pageIndex = 1; break;
            case "prev": if (p > 1) this.#settings.pageIndex--; break;
            case "next": if (p < t) this.#settings.pageIndex++; break;
            case "last": this.#settings.pageIndex = t; break;
        }
        if (this.#settings.pageIndex !== p) {
            this.#dispatchEvent("page-change", { pageIndex: this.#settings.pageIndex });
            this.#scheduleRender();
        }
    }
    #handlePagerSelect(sel) {
        const act = sel.dataset.pagerAction;
        const value = Number(sel.value);
        if (act === "pageLength") {
            if (this.#settings.pageLength !== value) {
                this.#settings.pageLength = value;
                this.#settings.pageIndex = 1;
                this.#saveState();
                this.#dispatchEvent("page-change", { pageIndex: 1, pageLength: value });
                this.#scheduleRender();
            }
        }
        if (act === "page-jump") {
            if (this.#settings.pageIndex !== value) {
                this.#settings.pageIndex = value;
                this.#dispatchEvent("page-change", { pageIndex: value });
                this.#scheduleRender();
            }
        }
    }
    #toggleCheckAll(checked) {
        this.#currentPageData.forEach((row) => (checked ? this.#checkedState.add(row[this.#settings.dataIdField]) : this.#checkedState.delete(row[this.#settings.dataIdField])));
        this.#updateHeaderCheckboxState();
    }
    #toggleCheckRow(chk) {
        const id = Number(chk.dataset.rowId) || chk.dataset.rowId;
        chk.checked ? this.#checkedState.add(id) : this.#checkedState.delete(id);
        this.#updateHeaderCheckboxState();
    }
    #handleFilter(input) {
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = setTimeout(() => {
            const field = input.dataset.filterField;
            const value = input.value;
            if (value) this.#filterState[field] = value;
            else delete this.#filterState[field];
            this.#settings.pageIndex = 1;
            this.#scheduleRender();
        }, 300);
    }
    #updateSortArrows() {
        this.#shadow.querySelectorAll("th[aria-sort]").forEach((th) => {
            const btn = th.querySelector(".ui-dt-sortable-btn");
            if (btn) {
                const arrow = btn.querySelector(".ui-dt-sort-arrow");
                arrow.className = "ui-dt-sort-arrow";
                th.setAttribute("aria-sort", "none");
                if (btn.dataset.sortField === this.#settings.sortField) {
                    th.setAttribute("aria-sort", this.#settings.sortOrder === "asc" ? "ascending" : "descending");
                    arrow.classList.add(this.#settings.sortOrder === "asc" ? "up" : "down");
                } else {
                    arrow.classList.add("both");
                }
            }
        });
    }
    #updateHeaderCheckboxState() {
        const checkAll = this.#shadow.querySelector(".ui-dt-check-all");
        if (!checkAll) return;
        const pageIds = this.#currentPageData.map((r) => r[this.#settings.dataIdField]);
        const checkedInPage = pageIds.filter((id) => this.#checkedState.has(id)).length;
        checkAll.checked = checkedInPage === pageIds.length && pageIds.length > 0;
        checkAll.indeterminate = checkedInPage > 0 && checkedInPage < pageIds.length;
    }
    #saveState() {
        if (this.id && this.#settings.persistState) {
            localStorage.setItem(`ui-data-table-state-${this.id}`, JSON.stringify({ sortField: this.#settings.sortField, sortOrder: this.#settings.sortOrder, pageLength: this.#settings.pageLength }));
        }
    }
    #loadState() {
        if (this.id && this.#settings.persistState) {
            const s = localStorage.getItem(`ui-data-table-state-${this.id}`);
            if (s) {
                const state = JSON.parse(s);
                Object.assign(this.#settings, state);
            }
        }
    }
}
customElements.define("ui-data-table", UiDataTable);
