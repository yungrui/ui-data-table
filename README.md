# UI Data Table (`<ui-data-table>`)

[English](#english) | [繁體中文](#traditional-chinese)

---

<a name="english"></a>
## English

A lightweight, zero-dependency, and highly customizable pure JavaScript Web Component for creating data tables. It features built-in, Bootstrap 5-like default styles, ensuring a professional appearance in any project right out of the box.

### Features
- **Zero Dependencies:** Pure Vanilla JavaScript Web Component.
- **Data Modes:** Supports both `local` and `server` side processing.
- **Virtual Scrolling:** Handles 10,000+ rows smoothly with DOM recycling.
- **Modern UX:** Sticky headers, resizable columns, and loading states.
- **Framework Agnostic:** Works in React, Vue, Angular, or plain HTML.

### Documentation & Examples
- **English Demo:** [example.en.html](example.en.html)
- **Chinese Demo:** [example.tc.html](example.tc.html)

---

<a name="traditional-chinese"></a>
## 繁體中文

這是一個輕量、零依賴且高度可客製化的純 JavaScript Web Component 資料表格元件。內建類 Bootstrap 5 預設樣式，確保在任何專案中都能擁有專業的視覺外觀。

### 核心特色
- **零依賴：** 純原生 JavaScript 開發，不需安裝任何框架。
- **雙資料模式：** 支援本地資料 (Local) 與 伺服器端 (Server) 非同步處理。
- **虛擬捲動：** 透過 DOM 回收技術，流暢處理超過 10,000 筆海量資料。
- **進階體驗：** 支援固定表頭 (Sticky)、欄位寬度調整 (Resizable) 與自動載入遮罩。
- **跨框架相容：** 可完美運行於 React, Vue, Angular 或純 HTML 環境。

### 文件與範例
- **英文版範例：** [example.en.html](example.en.html)
- **中文版範例：** [example.tc.html](example.tc.html)

---

## Installation / 安裝方式

Simply include `data-table.js` in your project:
只需將 `data-table.js` 放入您的專案並引用：

```html
<script src="data-table.js"></script>
```

## Quick Start / 快速上手

```html
<ui-data-table id="my-table" filterable="true" page-length="10"></ui-data-table>

<script>
    const table = document.getElementById('my-table');
    table.columns = [
        { field: 'id', title: 'ID', sortable: true },
        { field: 'name', title: 'Name', sortable: true }
    ];
    table.setData([{ id: 1, name: 'Gemini' }]);
</script>
```

## License / 授權條款
MIT License. See [LICENSE](LICENSE) for more information.
