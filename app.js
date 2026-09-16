/* =========================================================
   OFFICE FLOOR MAP NAVIGATOR
   HTML + CSS + JavaScript
   ========================================================= */

/* =========================================================
   PDF.JS CONFIGURATION
   ========================================================= */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";


/* =========================================================
   DATABASE SETTINGS
   ========================================================= */

const DB_NAME = "officeMapNavigatorDB";
const DB_VERSION = 1;
const STORE = "maps";

let db = null;

let currentMap = null;
let pdfDoc = null;
let currentPage = 1;
let zoom = 1;
let rotation = 0;
let activeRenderTask = null;
let zoomRenderTimer = null;
let pinchStartDistance = null;
let pinchStartZoom = null;

const MAX_ZOOM = 5;

let currentTextItems = [];
let currentSearchResults = [];
let pageTextCache = new Map();

let currentObjectUrl = null;


/* =========================================================
   DATABASE
   ========================================================= */

async function initDB() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(
            DB_NAME,
            DB_VERSION
        );

        request.onupgradeneeded = function (event) {

            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE)) {

                database.createObjectStore(
                    STORE,
                    {
                        keyPath: "id"
                    }
                );

            }

        };

        request.onsuccess = function (event) {

            db = event.target.result;

            resolve();

        };

        request.onerror = function () {

            reject(request.error);

        };

    });

}


/* =========================================================
   GET OBJECT STORE
   ========================================================= */

function getStore(mode = "readonly") {

    if (!db) {
        throw new Error("Database is not initialized.");
    }

    return db
        .transaction(STORE, mode)
        .objectStore(STORE);

}


/* =========================================================
   GET ALL MAPS
   ========================================================= */

function getAllMaps() {

    return new Promise((resolve, reject) => {

        const request = getStore().getAll();

        request.onsuccess = function () {

            resolve(request.result || []);

        };

        request.onerror = function () {

            reject(request.error);

        };

    });

}


/* =========================================================
   GET SINGLE MAP
   ========================================================= */

function getMap(id) {

    return new Promise((resolve, reject) => {

        const request = getStore().get(id);

        request.onsuccess = function () {

            resolve(request.result);

        };

        request.onerror = function () {

            reject(request.error);

        };

    });

}


/* =========================================================
   SAVE MAP
   ========================================================= */

function saveMap(map) {

    return new Promise((resolve, reject) => {

        const request = getStore("readwrite").put(map);

        request.onsuccess = function () {

            resolve();

        };

        request.onerror = function () {

            reject(request.error);

        };

    });

}


/* =========================================================
   DELETE MAP
   ========================================================= */

function deleteMap(id) {

    return new Promise((resolve, reject) => {

        const request = getStore("readwrite").delete(id);

        request.onsuccess = function () {

            resolve();

        };

        request.onerror = function () {

            reject(request.error);

        };

    });

}


/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

function showPage(page) {

    document
        .querySelectorAll(".page")
        .forEach(function (element) {

            element.classList.remove("active");

        });

    const targetPage =
        document.getElementById(page + "Page");

    if (targetPage) {

        targetPage.classList.add("active");

    }

    document
        .querySelectorAll(".nav-btn")
        .forEach(function (button) {

            button.classList.toggle(
                "active",
                button.dataset.page === page
            );

        });

    if (page === "home") {

        renderHome();

    }

    if (page === "admin") {

        renderAdmin();

    }

    window.scrollTo(0, 0);

}


/* =========================================================
   TOAST
   ========================================================= */

function toast(message) {

    const element =
        document.getElementById("toast");

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;

    element.classList.add("show");

    clearTimeout(window.toastTimer);

    window.toastTimer =
        setTimeout(function () {

            element.classList.remove("show");

        }, 2500);

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(text) {

    return String(text)
        .replace(
            /[&<>"']/g,
            function (character) {

                const map = {

                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"

                };

                return map[character];

            }
        );

}


/* =========================================================
   FILE SIZE
   ========================================================= */

function formatBytes(bytes) {

    if (!bytes) {
        return "0 B";
    }

    if (bytes < 1024) {

        return bytes + " B";

    }

    if (bytes < 1048576) {

        return (
            bytes / 1024
        ).toFixed(1) + " KB";

    }

    if (bytes < 1073741824) {

        return (
            bytes / 1048576
        ).toFixed(1) + " MB";

    }

    return (
        bytes / 1073741824
    ).toFixed(1) + " GB";

}


/* =========================================================
   HOME PAGE
   ========================================================= */

async function renderHome() {

    try {

        const maps = await getAllMaps();

        const mapCount =
            document.getElementById("mapCount");

        if (mapCount) {

            mapCount.textContent = maps.length;

        }

        const grid =
            document.getElementById("mapGrid");

        const empty =
            document.getElementById("emptyState");

        if (!grid || !empty) {
            return;
        }

        empty.classList.toggle(
            "hidden",
            maps.length > 0
        );

        grid.innerHTML = "";

        maps.sort(function (a, b) {

            return (
                Number(b.createdAt || 0) -
                Number(a.createdAt || 0)
            );

        });

        for (const map of maps) {

            const card =
                document.createElement("article");

            card.className = "map-card";

            let url = "";

            try {

                url = URL.createObjectURL(map.file);

            } catch (error) {

                console.error(
                    "Could not create PDF URL:",
                    error
                );

            }

            card.innerHTML = `

                <div class="map-thumb">

                    ${
                        url
                            ? `
                                <iframe
                                    src="${url}#toolbar=0&navpanes=0&scrollbar=0"
                                    title="${escapeHtml(map.name)}">
                                </iframe>
                              `
                            : `
                                <div class="map-preview-error">
                                    PDF preview unavailable
                                </div>
                              `
                    }

                </div>

                <div class="map-info">

                    <h3>
                        ${escapeHtml(map.name)}
                    </h3>

                    <p>
                        ${formatBytes(map.file.size)}
                        ·
                        ${new Date(
                            map.createdAt
                        ).toLocaleDateString()}
                    </p>

                    <button
                        class="primary"
                        onclick="openMap('${map.id}')">

                        Open Floor Map

                    </button>

                </div>

            `;

            grid.appendChild(card);

        }

    } catch (error) {

        console.error(error);

        toast("Unable to load floor maps.");

    }

}


/* =========================================================
   OPEN MAP
   ========================================================= */

async function openMap(id) {

    try {

        currentMap = await getMap(id);

        if (!currentMap) {

            toast("Map not found.");

            return;

        }

        currentPage = 1;
        zoom = 1;
        rotation = 0;

        currentSearchResults = [];
        currentTextItems = [];
        pageTextCache = new Map();

        const viewerTitle =
            document.getElementById("viewerTitle");

        if (viewerTitle) {

            viewerTitle.textContent =
                currentMap.name;

        }

        const searchInput =
            document.getElementById("placeSearch");

        if (searchInput) {

            searchInput.value = "";

        }

        const results =
            document.getElementById("searchResults");

        if (results) {

            results.classList.add("hidden");
            results.innerHTML = "";

        }

        const markerLayer =
            document.getElementById("markerLayer");

        if (markerLayer) {

            markerLayer.innerHTML = "";

        }

        showPage("viewer");

        if (currentObjectUrl) {

            URL.revokeObjectURL(
                currentObjectUrl
            );

            currentObjectUrl = null;

        }

        currentObjectUrl =
            URL.createObjectURL(
                currentMap.file
            );

        await loadPdf(currentObjectUrl);

    } catch (error) {

        console.error(error);

        toast("Unable to open this floor map.");

    }

}


/* =========================================================
   LOAD PDF
   ========================================================= */

async function loadPdf(url) {

    try {

        if (typeof pdfjsLib === "undefined") {

            toast(
                "PDF.js failed to load. Check index.html."
            );

            return;

        }

        pdfDoc =
            await pdfjsLib
                .getDocument({
                    url: url
                })
                .promise;

        const pageCount =
            document.getElementById("pageCount");

        if (pageCount) {

            pageCount.textContent =
                pdfDoc.numPages;

        }

        await renderPage(currentPage);

    } catch (error) {

        console.error(
            "PDF loading error:",
            error
        );

        toast(
            "Could not load the PDF."
        );

    }

}


/* =========================================================
   RENDER PDF PAGE
   ========================================================= */

async function renderPage(pageNumber) {

    if (!pdfDoc) {
        return;
    }

    try {

        if (activeRenderTask) {

            activeRenderTask.cancel();
            activeRenderTask = null;

        }

        currentPage =
            Math.max(
                1,
                Math.min(
                    pageNumber,
                    pdfDoc.numPages
                )
            );

        const page =
            await pdfDoc.getPage(
                currentPage
            );

        const viewport =
            page.getViewport({
                scale: zoom,
                rotation: rotation
            });

        const canvas =
            document.getElementById(
                "pdfCanvas"
            );

        if (!canvas) {
            return;
        }

        const context =
            canvas.getContext("2d");

        const outputScale =
            Math.min(
                2,
                window.devicePixelRatio || 1
            );

        canvas.width =
            Math.ceil(
                viewport.width * outputScale
            );

        canvas.height =
            Math.ceil(
                viewport.height * outputScale
            );

        canvas.style.width =
            Math.ceil(viewport.width) + "px";

        canvas.style.height =
            Math.ceil(viewport.height) + "px";

        activeRenderTask = page.render({

            canvasContext: context,
            viewport: viewport,
            transform: outputScale !== 1
                ? [
                    outputScale,
                    0,
                    0,
                    outputScale,
                    0,
                    0
                ]
                : null

        });

        await activeRenderTask.promise;

        activeRenderTask = null;

        const pageNumberElement =
            document.getElementById(
                "pageNumber"
            );

        if (pageNumberElement) {

            pageNumberElement.textContent =
                currentPage;

        }

        const zoomLabel =
            document.getElementById(
                "zoomLabel"
            );

        if (zoomLabel) {

            zoomLabel.textContent =
                Math.round(
                    zoom * 100
                ) + "%";

        }

        currentTextItems =
            await getTextItems(
                page,
                viewport
            );

        if (currentSearchResults.length) {

            showMarkerForResult(
                currentSearchResults[0]
            );

        }

    } catch (error) {

        if (error && error.name === "RenderingCancelledException") {
            return;
        }

        activeRenderTask = null;

        console.error(
            "Page render error:",
            error
        );

        toast(
            "Unable to render PDF page."
        );

    }

}


/* =========================================================
   GET PDF TEXT ITEMS
   ========================================================= */

async function getTextItems(
    page,
    viewport
) {

    let contentItems = pageTextCache.get(currentPage);

    if (!contentItems) {

        const content =
            await page.getTextContent();

        contentItems = content.items;
        pageTextCache.set(currentPage, contentItems);

    }

    return contentItems.map(
        function (item) {

            const transform =
                pdfjsLib.Util.transform(
                    viewport.transform,
                    item.transform
                );

            return {

                text: item.str || "",

                x: transform[4],

                y: transform[5],

                width:
                    Math.abs(
                        item.width * zoom
                    ),

                height:
                    Math.abs(
                        item.height * zoom
                    ) || 14

            };

        }
    );

}


/* =========================================================
   ZOOM IN / OUT
   ========================================================= */

function clampZoom(value) {

    return Math.max(
        0.35,
        Math.min(
            MAX_ZOOM,
            value
        )
    );

}

function changeZoom(delta) {

    zoom = clampZoom(
        zoom + delta
    );

    scheduleZoomRender();

}

function scheduleZoomRender() {

    clearTimeout(zoomRenderTimer);

    zoomRenderTimer = setTimeout(function () {

        zoomRenderTimer = null;
        renderPage(currentPage);

    }, 120);

}

function clearPinchPreview() {

    const canvasWrap =
        document.getElementById("canvasWrap");

    if (canvasWrap) {

        canvasWrap.style.transform = "";

    }

}


/* =========================================================
   ROTATE MAP
   ========================================================= */

function rotateMap(delta) {

    rotation =
        (rotation + delta + 360) % 360;

    renderPage(currentPage);

}


/* =========================================================
   MAP FULLSCREEN
   ========================================================= */

function toggleMapFullscreen() {

    const viewer =
        document.querySelector(
            ".viewer-shell"
        );

    if (!viewer) {
        return;
    }

    if (document.fullscreenElement) {

        document.exitFullscreen();

        return;

    }

    if (viewer.requestFullscreen) {

        viewer.requestFullscreen();

    }

}


/* =========================================================
   MAP VISIBILITY
   ========================================================= */

function toggleMapEnhancement() {

    const canvasWrap =
        document.getElementById(
            "canvasWrap"
        );

    const button =
        document.querySelector(
            '[aria-label="Enhance map visibility"]'
        );

    if (!canvasWrap || !button) {
        return;
    }

    const enhanced =
        canvasWrap.classList.toggle(
            "map-enhanced"
        );

    button.title = enhanced
        ? "Turn off map enhancement"
        : "Enhance map visibility";

    button.setAttribute(
        "aria-label",
        button.title
    );

}


document.addEventListener(
    "fullscreenchange",
    function () {

        const button =
            document.querySelector(
                '[aria-label*="fullscreen map"]'
            );

        if (!button) {
            return;
        }

        const isFullscreen =
            Boolean(document.fullscreenElement);

        button.title = isFullscreen
            ? "Exit fullscreen map"
            : "Enter fullscreen map";

        button.setAttribute(
            "aria-label",
            button.title
        );

    }
);


/* =========================================================
   FIT WIDTH
   ========================================================= */

function fitWidth() {

    if (!pdfDoc) {
        return;
    }

    const viewport =
        document.getElementById(
            "pdfViewport"
        );

    if (!viewport) {
        return;
    }

    pdfDoc
        .getPage(currentPage)
        .then(function (page) {

            const base =
                page.getViewport({
                    scale: 1,
                    rotation: rotation
                });

            const availableWidth =
                Math.max(
                    100,
                    viewport.clientWidth - 60
                );

            zoom =
                Math.max(
                    0.35,
                    Math.min(
                        MAX_ZOOM,
                        availableWidth /
                        base.width
                    )
                );

            renderPage(currentPage);

        })
        .catch(function (error) {

            console.error(error);

        });

}


/* =========================================================
   PREVIOUS PAGE
   ========================================================= */

function previousPage() {

    if (!pdfDoc) {
        return;
    }

    if (currentPage <= 1) {

        return;

    }

    renderPage(
        currentPage - 1
    );

}


/* =========================================================
   NEXT PAGE
   ========================================================= */

function nextPage() {

    if (!pdfDoc) {
        return;
    }

    if (currentPage >= pdfDoc.numPages) {

        return;

    }

    renderPage(
        currentPage + 1
    );

}


/* =========================================================
   SEARCH PLACE
   ========================================================= */

async function searchPlace() {

    if (!pdfDoc) {

        toast(
            "Open a floor map first."
        );

        return;

    }

    const input =
        document.getElementById(
            "placeSearch"
        );

    if (!input) {
        return;
    }

    const query =
        input.value
            .trim()
            .toLowerCase();

    const resultBox =
        document.getElementById(
            "searchResults"
        );

    if (!query) {

        clearSearch();

        return;

    }

    const results = [];

    resultBox.classList.remove(
        "hidden"
    );

    resultBox.innerHTML = `
        <div class="search-result">
            <span>Searching floor map...</span>
        </div>
    `;

    try {

        /*
           Search every PDF page
        */

        for (
            let pageNumber = 1;
            pageNumber <= pdfDoc.numPages;
            pageNumber++
        ) {

            const page =
                await pdfDoc.getPage(
                    pageNumber
                );

            const content =
                await page.getTextContent();

            content.items.forEach(
                function (item) {

                    const text =
                        item.str || "";

                    if (
                        text
                            .toLowerCase()
                            .includes(query)
                    ) {

                        results.push({

                            page: pageNumber,

                            text: text,

                            item: item

                        });

                    }

                }
            );

        }

        currentSearchResults =
            results;

        /*
           No result
        */

        if (!results.length) {

            resultBox.innerHTML = `

                <div class="search-result">

                    <span>
                        No matching place found
                        in this PDF.
                    </span>

                </div>

            `;

            const markerLayer =
                document.getElementById(
                    "markerLayer"
                );

            if (markerLayer) {

                markerLayer.innerHTML = "";

            }

            return;

        }

        /*
           Display results
        */

        resultBox.innerHTML =
            results
                .slice(0, 30)
                .map(
                    function (result, index) {

                        return `

                            <div class="search-result">

                                <span>

                                    <b>
                                        ${escapeHtml(
                                            result.text
                                        )}
                                    </b>

                                    · Page
                                    ${result.page}

                                </span>

                                <button
                                    onclick="jumpToResult(${index})">

                                    Show on Map

                                </button>

                            </div>

                        `;

                    }
                )
                .join("");

        /*
           Automatically open first result
        */

        jumpToResult(0);

    } catch (error) {

        console.error(
            "Search error:",
            error
        );

        resultBox.innerHTML = `

            <div class="search-result">

                <span>
                    Search failed.
                </span>

            </div>

        `;

    }

}


/* =========================================================
   SEARCH SUGGESTIONS
   ========================================================= */

function updateSearchSuggestions() {

    const input =
        document.getElementById(
            "placeSearch"
        );

    const suggestions =
        document.getElementById(
            "searchSuggestions"
        );

    if (!input || !suggestions) {
        return;
    }

    const query =
        input.value.trim().toLowerCase();

    if (!pdfDoc || query.length < 2) {

        suggestions.classList.add("hidden");
        suggestions.innerHTML = "";
        return;

    }

    const uniqueTexts = [];
    const seen = new Set();

    currentTextItems.forEach(function (item) {

        const text = item.text.trim();
        const key = text.toLowerCase();

        if (
            text.length >= 2 &&
            key.includes(query) &&
            !seen.has(key)
        ) {
            seen.add(key);
            uniqueTexts.push(text);
        }

    });

    if (!uniqueTexts.length) {

        suggestions.classList.add("hidden");
        suggestions.innerHTML = "";
        return;

    }

    suggestions.innerHTML = "";

    uniqueTexts.slice(0, 8).forEach(function (text) {

        const option =
            document.createElement("button");

        option.type = "button";
        option.className = "search-suggestion";
        option.textContent = text;

        option.addEventListener(
            "click",
            function () {

                input.value = text;
                suggestions.classList.add("hidden");
                searchPlace();

            }
        );

        suggestions.appendChild(option);

    });

    suggestions.classList.remove("hidden");

}


function initSearchSuggestions() {

    if (document.body.dataset.suggestionsReady) {
        return;
    }

    const input =
        document.getElementById(
            "placeSearch"
        );

    if (!input) {
        return;
    }

    document.body.dataset.suggestionsReady = "true";

    input.addEventListener(
        "input",
        updateSearchSuggestions
    );

    input.addEventListener(
        "focus",
        updateSearchSuggestions
    );

}


/* =========================================================
   JUMP TO SEARCH RESULT
   ========================================================= */

async function jumpToResult(index) {

    const result =
        currentSearchResults[index];

    if (!result) {
        return;
    }

    currentPage =
        result.page;

    await renderPage(
        currentPage
    );

    showMarkerForResult(
        result
    );

}


/* =========================================================
   SHOW LOCATION MARKER
   ========================================================= */

function showMarkerForResult(result) {

    if (
        !pdfDoc ||
        result.page !== currentPage
    ) {

        return;

    }

    const searchTextElement =
        document.getElementById(
            "placeSearch"
        );

    const searchText =
        searchTextElement
            ? searchTextElement.value
                .trim()
                .toLowerCase()
            : "";

    const layer =
        document.getElementById(
            "markerLayer"
        );

    if (!layer) {
        return;
    }

    layer.innerHTML = "";

    let match = null;

    /*
       First try the exact search result.
    */

    if (result.text) {

        match =
            currentTextItems.find(
                function (item) {

                    return (
                        item.text ===
                        result.text
                    );

                }
            );

    }

    /*
       If exact text was not found,
       search using the typed query.
    */

    if (!match && searchText) {

        match =
            currentTextItems.find(
                function (item) {

                    return item.text
                        .toLowerCase()
                        .includes(searchText);

                }
            );

    }

    if (!match) {

        return;

    }

    const marker =
        document.createElement(
            "div"
        );

    marker.className =
        "marker";

    marker.style.left =
        (
            match.x +
            Math.max(
                match.width,
                20
            ) / 2
        ) + "px";

    marker.style.top =
        (
            match.y -
            match.height -
            12
        ) + "px";

    marker.title =
        match.text;

    const label =
        document.createElement(
            "span"
        );

    label.className =
        "marker-label";

    label.textContent =
        match.text;

    marker.appendChild(
        label
    );

    layer.appendChild(
        marker
    );

    /*
       Scroll marker into view.
    */

    try {

        marker.scrollIntoView({

            behavior: "smooth",

            block: "center",

            inline: "center"

        });

    } catch (error) {

        console.log(error);

    }

}


/* =========================================================
   MAP TOUCH / MOUSE ZOOM
   ========================================================= */

document.addEventListener(
    "touchstart",
    function (event) {

        const viewport =
            event.target.closest(
                "#pdfViewport"
            );

        if (
            !viewport ||
            !pdfDoc ||
            event.touches.length !== 2
        ) {
            return;
        }

        event.preventDefault();

        const touchA = event.touches[0];
        const touchB = event.touches[1];

        pinchStartDistance =
            Math.hypot(
                touchB.clientX - touchA.clientX,
                touchB.clientY - touchA.clientY
            );

        pinchStartZoom = zoom;

        clearPinchPreview();

    },
    { passive: false }
);

document.addEventListener(
    "touchmove",
    function (event) {

        const viewport =
            event.target.closest(
                "#pdfViewport"
            );

        if (
            !viewport ||
            !pdfDoc ||
            event.touches.length !== 2 ||
            pinchStartDistance === null ||
            pinchStartZoom === null
        ) {
            return;
        }

        event.preventDefault();

        const touchA = event.touches[0];
        const touchB = event.touches[1];
        const currentDistance =
            Math.hypot(
                touchB.clientX - touchA.clientX,
                touchB.clientY - touchA.clientY
            );

        const ratio =
            currentDistance /
            pinchStartDistance;

        zoom = clampZoom(
            pinchStartZoom * ratio
        );

        const canvasWrap =
            document.getElementById("canvasWrap");

        if (canvasWrap) {

            canvasWrap.style.transform =
                "scale(" + zoom / pinchStartZoom + ")";

        }

    },
    { passive: false }
);

function finishPinch(commitZoom) {

    if (pinchStartZoom === null) {
        return;
    }

    if (!commitZoom) {

        zoom = pinchStartZoom;

    }

    pinchStartDistance = null;
    pinchStartZoom = null;
    clearPinchPreview();

    if (commitZoom) {

        scheduleZoomRender();

    }

}

document.addEventListener(
    "touchend",
    function () {

        finishPinch(true);

    },
    { passive: true }
);

document.addEventListener(
    "touchcancel",
    function () {

        finishPinch(false);

    },
    { passive: true }
);

document.addEventListener(
    "wheel",
    function (event) {

        const viewport =
            event.target.closest(
                "#pdfViewport"
            );

        if (
            !viewport ||
            (!event.ctrlKey && !event.metaKey) ||
            !pdfDoc
        ) {
            return;
        }

        event.preventDefault();

        changeZoom(
            event.deltaY < 0
                ? 0.05
                : -0.05
        );

    },
    { passive: false }
);


/* =========================================================
   CLEAR SEARCH
   ========================================================= */

function clearSearch() {

    const input =
        document.getElementById(
            "placeSearch"
        );

    if (input) {

        input.value = "";

    }

    const resultBox =
        document.getElementById(
            "searchResults"
        );

    if (resultBox) {

        resultBox.classList.add(
            "hidden"
        );

        resultBox.innerHTML = "";

    }

    const suggestions =
        document.getElementById(
            "searchSuggestions"
        );

    if (suggestions) {

        suggestions.classList.add(
            "hidden"
        );

        suggestions.innerHTML = "";

    }

    const markerLayer =
        document.getElementById(
            "markerLayer"
        );

    if (markerLayer) {

        markerLayer.innerHTML = "";

    }

    currentSearchResults = [];

}


/* =========================================================
   ADMIN PAGE
   ========================================================= */

async function renderAdmin() {

    try {

        const maps =
            await getAllMaps();

        const box =
            document.getElementById(
                "adminMapList"
            );

        if (!box) {
            return;
        }

        if (!maps.length) {

            box.innerHTML = `

                <p style="color:#68738a">

                    No maps uploaded.

                </p>

            `;

            return;

        }

        maps.sort(function (a, b) {

            return (
                Number(b.createdAt || 0) -
                Number(a.createdAt || 0)
            );

        });

        box.innerHTML = `

            <table class="admin-table">

                <thead>

                    <tr>

                        <th>
                            Map
                        </th>

                        <th>
                            Size
                        </th>

                        <th>
                            Added
                        </th>

                        <th>
                            Action
                        </th>

                    </tr>

                </thead>

                <tbody>

                    ${maps.map(
                        function (map) {

                            return `

                                <tr>

                                    <td>

                                        <b>
                                            ${escapeHtml(
                                                map.name
                                            )}
                                        </b>

                                    </td>

                                    <td>

                                        ${formatBytes(
                                            map.file.size
                                        )}

                                    </td>

                                    <td>

                                        ${new Date(
                                            map.createdAt
                                        ).toLocaleString()}

                                    </td>

                                    <td>

                                        <button
                                            class="delete-btn"
                                            onclick="removeMap('${map.id}')">

                                            Delete

                                        </button>

                                    </td>

                                </tr>

                            `;

                        }
                    ).join("")}

                </tbody>

            </table>

        `;

    } catch (error) {

        console.error(error);

        toast(
            "Unable to load admin maps."
        );

    }

}


/* =========================================================
   ADD MAP
   ========================================================= */

async function addMap() {
    const nameInput =
        document.getElementById(
            "mapName"
        );

    const fileInput =
        document.getElementById(
            "mapFile"
        );

    if (!nameInput || !fileInput) {

        toast(
            "Map upload controls not found."
        );

        return;

    }

    const name =
        nameInput.value.trim();

    const file =
        fileInput.files[0];

    if (!name) {

        toast(
            "Enter a map name"
        );

        return;

    }

    if (!file) {

        toast(
            "Please choose a PDF file"
        );

        return;

    }

    const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {

        toast(
            "Please choose a PDF file"
        );

        return;

    }

    try {

        const map = {

            id:
                crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString(),

            name:
                name,

            file:
                file,

            createdAt:
                Date.now()

        };

        await saveMap(map);

        nameInput.value = "";

        fileInput.value = "";

        toast(
            "Floor map added successfully"
        );

        await renderAdmin();

        initSearchSuggestions();

        await renderHome();

    } catch (error) {

        console.error(
            "Upload error:",
            error
        );

        toast(
            "Could not save the floor map."
        );

    }

}


/* =========================================================
   DELETE MAP
   ========================================================= */

async function removeMap(id) {

    const confirmDelete =
        confirm(
            "Delete this floor map?"
        );

    if (!confirmDelete) {

        return;

    }

    try {

        await deleteMap(id);

        /*
           If currently opened map is deleted,
           close it.
        */

        if (
            currentMap &&
            currentMap.id === id
        ) {

            currentMap = null;
            pdfDoc = null;

            if (currentObjectUrl) {

                URL.revokeObjectURL(
                    currentObjectUrl
                );

                currentObjectUrl = null;

            }

        }

        toast(
            "Map deleted"
        );

        await renderAdmin();

        await renderHome();

    } catch (error) {

        console.error(error);

        toast(
            "Could not delete the map."
        );

    }

}


/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

document.addEventListener(
    "keydown",
    function (event) {

        /*
           Enter = Search
        */

        if (
            event.key === "Enter" &&
            document.activeElement &&
            document.activeElement.id ===
                "placeSearch"
        ) {

            event.preventDefault();

            searchPlace();

        }

        /*
           Escape = Clear search
        */

        if (
            event.key === "Escape"
        ) {

            const search =
                document.getElementById(
                    "placeSearch"
                );

            if (
                search &&
                document.activeElement === search
            ) {

                clearSearch();

            }

        }

        /*
           Arrow keys = Page navigation
        */

        if (
            document.activeElement &&
            (
                document.activeElement.tagName ===
                "INPUT" ||
                document.activeElement.tagName ===
                "TEXTAREA"
            )
        ) {

            return;

        }

        if (event.key === "ArrowLeft") {

            previousPage();

        }

        if (event.key === "ArrowRight") {

            nextPage();

        }

    }
);


/* =========================================================
   CLEANUP OBJECT URL
   ========================================================= */

window.addEventListener(
    "beforeunload",
    function () {

        if (currentObjectUrl) {

            URL.revokeObjectURL(
                currentObjectUrl
            );

        }

    }
);


/* =========================================================
   START APPLICATION
   ========================================================= */

(async function () {

    try {

        await initDB();

        await renderHome();

        await renderAdmin();

        initSearchSuggestions();

    } catch (error) {

        console.error(
            "Application startup error:",
            error
        );

        toast(
            "Application could not start."
        );

    }

})();