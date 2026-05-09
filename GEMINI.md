# Project Overview

This project is a lightweight, dependency-free, and highly customizable JavaScript Web Component for creating data tables. The component is defined in `data-table.js` and an example implementation is in `index.html`.

## Core Features

*   **Web Component:** As a standard Web Component (`<ui-data-table>`), it's easy to use in any front-end framework or pure HTML.
*   **Checkbox State Management:** Supports header select-all, single-row selection, and an API to get selected data.
*   **Two Data Modes:** Supports local array data (`local`) and server-side asynchronous loading (`server`).
*   **Client-side Features:** Provides pagination, sorting, and multi-column filtering for local data.
*   **State Persistence:** Can use `localStorage` to save the table's sorting and page length settings.
*   **Custom Rendering:** Allows for complete customization of cell content (e.g., buttons, badges, images) through a `render` function.
*   **Customizable Styles:** Uses CSS Shadow Parts (`::part`) for flexible styling.
*   **Resizable Columns:** Users can drag the header borders to adjust column widths.

# Building and Running

This is a vanilla JavaScript project with no build process. To run the project, simply open the `index.html` file in a web browser.

# Development Conventions

*   The project is written in plain JavaScript, following modern class-based syntax for the Web Component.
*   The `index.html` file serves as both a demonstration and documentation for the component's features and API.
*   The component is self-contained in `data-table.js` and can be easily integrated into other projects.
