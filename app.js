/* =========================================================
   OFFICE FLOOR MAP NAVIGATOR
   HTML + CSS + JavaScript
   ========================================================= */

/* =========================================================
   DATABASE SETTINGS
   ========================================================= */

const DB_NAME = "officeMapNavigatorDB";
const DB_VERSION = 2;
const STORE = "maps";
const PREVIEW_STORE = "mapPreviews";
const PDFJS_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let db = null;
let pdfjsPromise = null;

let currentMap = null;
let pdfDoc = null;
let currentPage = 1;
let zoom = 1;
let rotation = 0;
let activeRenderTask = null;
let renderRequestId = 0;
let zoomRenderTimer = null;
let pinchStartDistance = null;
let pinchStartZoom = null;
let pinchZoomAnchor = null;

const MAX_ZOOM = 5;

let currentTextItems = [];
let currentSearchResults = [];
let roomLocations = {};
let pageTextCache = new Map();
let pageTextPromises = new Map();
let pdfGeneration = 0;

let currentObjectUrl = null;
let mapPreviewUrls = [];
let previewObserver = null;
const mapPreviewData = new WeakMap();


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

            if (!database.objectStoreNames.contains(PREVIEW_STORE)) {

                database.createObjectStore(
                    PREVIEW_STORE,
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

function getStore(mode = "readonly", storeName = STORE) {

    if (!db) {
        throw new Error("Database is not initialized.");
    }

    return db
        .transaction(storeName, mode)
        .objectStore(storeName);

}

function getMapPreview(id) {

    return new Promise((resolve, reject) => {

        const request =
            getStore("readonly", PREVIEW_STORE).get(id);

        request.onsuccess = function () {
            resolve(request.result);
        };

        request.onerror = function () {
            reject(request.error);
        };

    });

}

function saveMapPreview(preview) {

    return new Promise((resolve, reject) => {

        const request =
            getStore("readwrite", PREVIEW_STORE).put(preview);

        request.onsuccess = function () {
            resolve();
        };

        request.onerror = function () {
            reject(request.error);
        };

    });

}

function deleteMapPreview(id) {

    return new Promise((resolve, reject) => {

        const request =
            getStore("readwrite", PREVIEW_STORE).delete(id);

        request.onsuccess = function () {
            resolve();
        };

        request.onerror = function () {
            reject(request.error);
        };

    });

}

function loadPdfJs() {

    if (typeof pdfjsLib !== "undefined") {
        return Promise.resolve(pdfjsLib);
    }

    if (!pdfjsPromise) {
        pdfjsPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = PDFJS_SRC;
            script.async = true;
            script.onload = function () {
                if (typeof pdfjsLib === "undefined") {
                    pdfjsPromise = null;
                    reject(new Error("PDF.js loaded without defining pdfjsLib."));
                    return;
                }

                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    PDFJS_WORKER_SRC;
                resolve(pdfjsLib);
            };
            script.onerror = function () {
                pdfjsPromise = null;
                reject(new Error("Unable to load PDF.js."));
            };
            document.head.appendChild(script);
        });
    }

    return pdfjsPromise;

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

        if (previewObserver) {
            previewObserver.disconnect();
        }

        mapPreviewUrls.forEach(function (url) {
            URL.revokeObjectURL(url);
        });
        mapPreviewUrls = [];

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

            card.innerHTML = `

                <div class="map-thumb">

                    <div class="map-preview-loading" aria-hidden="true">
                        Loading preview...
                    </div>

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

            const thumb =
                card.querySelector(".map-thumb");

            if (thumb && "IntersectionObserver" in window) {
                if (!previewObserver) {
                    previewObserver =
                        new IntersectionObserver(function (entries) {
                            entries.forEach(function (entry) {
                                if (!entry.isIntersecting) {
                                    return;
                                }

                                previewObserver.unobserve(entry.target);
                                renderMapPreview(
                                    mapPreviewData.get(entry.target),
                                    entry.target
                                );
                            });
                        }, { rootMargin: "160px" });
                }

                mapPreviewData.set(thumb, map);
                previewObserver.observe(thumb);
            }

        }

        if (!("IntersectionObserver" in window)) {
            const thumbs = grid.querySelectorAll(".map-thumb");
            thumbs.forEach(function (thumb, index) {
                renderMapPreview(maps[index], thumb);
            });
        }

    } catch (error) {

        console.error(error);

        toast("Unable to load floor maps.");

    }

}


async function renderMapPreview(map, thumb) {

    try {
        const cachedPreview = await getMapPreview(map.id);
        let previewBlob =
            cachedPreview &&
            cachedPreview.fileSize === map.file.size &&
            cachedPreview.fileLastModified === map.file.lastModified
                ? cachedPreview.blob
                : null;

        if (!previewBlob) {
            const pdfjs = await loadPdfJs();
            const pdf = await pdfjs.getDocument({
                data: await map.file.arrayBuffer()
            }).promise;

            try {
                const page = await pdf.getPage(1);
                const baseViewport = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({
                    scale: Math.min(1, 320 / baseViewport.width)
                });
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");

                if (!context) {
                    throw new Error("Could not create a map preview canvas.");
                }

                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await page.render({
                    canvasContext: context,
                    viewport: viewport
                }).promise;

                previewBlob = await new Promise((resolve, reject) => {
                    canvas.toBlob(function (blob) {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error("Could not encode the map preview."));
                        }
                    }, "image/jpeg", 0.65);
                });

                canvas.width = 0;
                canvas.height = 0;

                try {
                    await saveMapPreview({
                        id: map.id,
                        fileSize: map.file.size,
                        fileLastModified: map.file.lastModified,
                        blob: previewBlob
                    });
                } catch (error) {
                    console.error("Could not cache map preview:", error);
                }
            } finally {
                await pdf.destroy();
            }
        }

        if (!thumb.isConnected) {
            return;
        }

        const image = document.createElement("img");
        const previewUrl = URL.createObjectURL(previewBlob);
        mapPreviewUrls.push(previewUrl);
        image.src = previewUrl;
        image.alt = map.name + " preview";
        image.loading = "lazy";
        image.decoding = "async";
        thumb.replaceChildren(image);
    } catch (error) {
        console.error("Could not render map preview:", error);

        if (thumb.isConnected) {
            thumb.innerHTML =
                '<div class="map-preview-error">PDF preview unavailable</div>';
        }
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
        roomLocations = {};
        currentTextItems = [];
        pageTextCache = new Map();
        pageTextPromises = new Map();
        pdfGeneration++;

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

        ["currentRoom", "destinationRoom"].forEach(
            function (id) {

                const input = document.getElementById(id);

                if (input) {
                    input.value = "";
                }

            }
        );

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

        const pdfjs = await loadPdfJs();

        pdfDoc =
            await pdfjs
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

async function renderPage(pageNumber, zoomAnchor) {

    if (!pdfDoc) {
        return;
    }

    const requestId = ++renderRequestId;
    let renderTask = null;

    try {

        if (activeRenderTask) {

            const previousTask = activeRenderTask;
            previousTask.cancel();

            try {
                await previousTask.promise;
            } catch (error) {
                if (!error || error.name !== "RenderingCancelledException") {
                    throw error;
                }
            }

            if (activeRenderTask === previousTask) {
                activeRenderTask = null;
            }

        }

        if (requestId !== renderRequestId) {
            return;
        }

        currentPage =
            Math.max(
                1,
                Math.min(
                    pageNumber,
                    pdfDoc.numPages
                )
            );

        const requestedPage = currentPage;
        const page =
            await pdfDoc.getPage(
                requestedPage
            );

        if (requestId !== renderRequestId) {
            return;
        }

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
                3,
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

        renderTask = page.render({

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

        activeRenderTask = renderTask;
        await renderTask.promise;

        if (requestId !== renderRequestId) {
            return;
        }

        if (zoomAnchor) {
            restoreZoomAnchor(zoomAnchor);
        }

        if (activeRenderTask === renderTask) {
            activeRenderTask = null;
        }

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
                requestedPage,
                page,
                viewport
            );

        if (requestId !== renderRequestId) {
            return;
        }

        if (Object.keys(roomLocations).length) {

            showRoomMarkers();

        } else if (currentSearchResults.length) {

            showMarkerForResult(
                currentSearchResults[0]
            );

        }

    } catch (error) {

        if (error && error.name === "RenderingCancelledException") {
            return;
        }

        if (activeRenderTask === renderTask) {
            activeRenderTask = null;
        }

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
    pageNumber,
    page,
    viewport
) {

    const contentItems =
        await getPageTextItems(pageNumber, page);
    const pdfjs = await loadPdfJs();

    return contentItems.map(
        function (item) {

            const transform =
                pdfjs.Util.transform(
                    viewport.transform,
                    item.transform
                );

            return {

                text: item.str || "",

                x: transform[4],

                y: transform[5],

                width:
                    Math.abs(
                        item.width * viewport.scale
                    ),

                height:
                    Math.abs(
                        item.height * viewport.scale
                    ) || 14

            };

        }
    );

}

async function getPageTextItems(pageNumber, page) {

    const cachedItems = pageTextCache.get(pageNumber);

    if (cachedItems) {
        return cachedItems;
    }

    let textPromise = pageTextPromises.get(pageNumber);

    if (!textPromise) {
        const generation = pdfGeneration;
        textPromise = (async function () {
            try {
                const textPage = page || await pdfDoc.getPage(pageNumber);
                const content = await textPage.getTextContent();

                if (generation === pdfGeneration) {
                    pageTextCache.set(pageNumber, content.items);
                }
                if (pageTextPromises.get(pageNumber) === textPromise) {
                    pageTextPromises.delete(pageNumber);
                }

                return content.items;
            } catch (error) {
                if (pageTextPromises.get(pageNumber) === textPromise) {
                    pageTextPromises.delete(pageNumber);
                }
                throw error;
            }
        })();

        pageTextPromises.set(pageNumber, textPromise);
    }

    return textPromise;

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

function changeZoom(factor, clientX, clientY) {

    const zoomAnchor =
        typeof clientX === "number" &&
        typeof clientY === "number"
            ? getZoomAnchor(clientX, clientY)
            : getZoomAnchor();

    zoom = clampZoom(
        zoom * factor
    );

    scheduleZoomRender(zoomAnchor);

}

function getZoomAnchor(clientX, clientY) {

    const viewport =
        document.getElementById("pdfViewport");
    const canvasWrap =
        document.getElementById("canvasWrap");

    if (!viewport || !canvasWrap) {
        return null;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvasWrap.getBoundingClientRect();

    if (!canvasRect.width || !canvasRect.height) {
        return null;
    }

    const targetClientX =
        typeof clientX === "number"
            ? clientX
            : viewportRect.left + viewport.clientLeft + viewport.clientWidth / 2;
    const targetClientY =
        typeof clientY === "number"
            ? clientY
            : viewportRect.top + viewport.clientTop + viewport.clientHeight / 2;

    return {
        targetX:
            targetClientX - viewportRect.left - viewport.clientLeft,
        targetY:
            targetClientY - viewportRect.top - viewport.clientTop,
        mapX: (targetClientX - canvasRect.left) / canvasRect.width,
        mapY: (targetClientY - canvasRect.top) / canvasRect.height
    };

}

function restoreZoomAnchor(anchor) {

    const viewport =
        document.getElementById("pdfViewport");
    const canvasWrap =
        document.getElementById("canvasWrap");

    if (!viewport || !canvasWrap || !anchor) {
        return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvasWrap.getBoundingClientRect();

    viewport.scrollLeft +=
        canvasRect.left +
        anchor.mapX * canvasRect.width -
        (viewportRect.left + viewport.clientLeft + anchor.targetX);
    viewport.scrollTop +=
        canvasRect.top +
        anchor.mapY * canvasRect.height -
        (viewportRect.top + viewport.clientTop + anchor.targetY);

}

function scheduleZoomRender(zoomAnchor) {

    clearTimeout(zoomRenderTimer);

    zoomRenderTimer = setTimeout(function () {

        zoomRenderTimer = null;
        renderPage(currentPage, zoomAnchor);

    }, 120);

}

function clearPinchPreview() {

    const canvasWrap =
        document.getElementById("canvasWrap");

    if (canvasWrap) {

        canvasWrap.style.transform = "";
        canvasWrap.style.transformOrigin = "";

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

            const styles = getComputedStyle(viewport);
            const horizontalPadding =
                parseFloat(styles.paddingLeft) +
                parseFloat(styles.paddingRight);

            const availableWidth =
                Math.max(
                    100,
                    viewport.clientWidth - horizontalPadding - 12
                );

            zoom = clampZoom(
                availableWidth / base.width
            );

            renderPage(currentPage);

        })
        .catch(function (error) {

            console.error(error);
            toast("Unable to fit the PDF page to width.");

        });

}

function fitPage() {

    if (!pdfDoc) {
        return;
    }

    const viewport =
        document.getElementById("pdfViewport");

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

            const styles = getComputedStyle(viewport);
            const horizontalPadding =
                parseFloat(styles.paddingLeft) +
                parseFloat(styles.paddingRight);
            const verticalPadding =
                parseFloat(styles.paddingTop) +
                parseFloat(styles.paddingBottom);

            const availableWidth =
                Math.max(
                    100,
                    viewport.clientWidth - horizontalPadding - 12
                );
            const availableHeight =
                Math.max(
                    100,
                    viewport.clientHeight - verticalPadding - 12
                );

            zoom = clampZoom(
                Math.min(
                    availableWidth / base.width,
                    availableHeight / base.height
                )
            );

            renderPage(currentPage);

        })
        .catch(function (error) {

            console.error(error);
            toast("Unable to fit the PDF page to the viewer.");

        });

}

function resetZoom() {
    zoom = 1;
    scheduleZoomRender();
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

    roomLocations = {};

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

        const pageTexts = new Array(pdfDoc.numPages);
        let nextPageNumber = 1;

        async function readNextPage() {
            while (nextPageNumber <= pdfDoc.numPages) {
                const pageNumber = nextPageNumber++;
                pageTexts[pageNumber - 1] = {
                    pageNumber: pageNumber,
                    items: await getPageTextItems(pageNumber)
                };
            }
        }

        await Promise.all(
            Array.from(
                { length: Math.min(4, pdfDoc.numPages) },
                readNextPage
            )
        );

        pageTexts.forEach(function (pageText) {
            pageText.items.forEach(
                function (item) {

                    const text =
                        item.str || "";

                    if (
                        text
                            .toLowerCase()
                            .includes(query)
                    ) {

                        results.push({

                            page: pageText.pageNumber,

                            text: text,

                            item: item

                        });

                    }

                }
            );
        });

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


async function searchRooms() {

    if (!pdfDoc) {

        toast("Open a floor map first.");
        return;

    }

    const currentInput =
        document.getElementById("currentRoom");

    const destinationInput =
        document.getElementById("destinationRoom");

    const resultBox =
        document.getElementById("searchResults");

    if (!currentInput || !destinationInput || !resultBox) {
        return;
    }

    const currentQuery = currentInput.value.trim();
    const destinationQuery = destinationInput.value.trim();

    if (!currentQuery || !destinationQuery) {
        toast("Enter both a current room and a destination room.");
        return;
    }

    currentSearchResults = [];
    roomLocations = {};

    const markerLayer = document.getElementById("markerLayer");

    if (markerLayer) {
        markerLayer.innerHTML = "";
    }

    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `
        <div class="search-result">
            <span>Finding both rooms in this floor map...</span>
        </div>
    `;

    try {

        const [current, destination] = await Promise.all([
            findRoomInPdf(currentQuery),
            findRoomInPdf(destinationQuery)
        ]);

        if (!current || !destination) {

            const missing = [];

            if (!current) {
                missing.push(`current room "${escapeHtml(currentQuery)}"`);
            }

            if (!destination) {
                missing.push(`destination room "${escapeHtml(destinationQuery)}"`);
            }

            resultBox.innerHTML = `
                <div class="search-result">
                    <span>Could not find ${missing.join(" and ")} in this PDF.</span>
                </div>
            `;

            return;

        }

        roomLocations = { current, destination };
        currentSearchResults = [];

        resultBox.innerHTML = `
            ${[
                ["current", "Current room", current],
                ["destination", "Destination room", destination]
            ].map(function ([key, label, room]) {
                return `
                    <div class="search-result">
                        <span>
                            <b>${label}:</b>
                            ${escapeHtml(room.text)}
                            · Page ${room.page}
                        </span>
                        <button onclick="jumpToRoom('${key}')">Show on Map</button>
                    </div>
                `;
            }).join("")}
        `;

        await jumpToRoom("destination");

    } catch (error) {

        console.error("Room search error:", error);
        resultBox.innerHTML = `
            <div class="search-result">
                <span>Room search failed.</span>
            </div>
        `;

    }

}


async function findRoomInPdf(query) {

    const normalizedQuery = normalizeRoomText(query);

    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {

        const items = await getPageTextItems(pageNumber);
        const itemRanges = [];
        let searchableText = "";

        items.forEach(function (item, itemIndex) {

            const text = normalizeRoomText(item.str);

            if (!text) {
                return;
            }

            if (searchableText) {
                searchableText += " ";
            }

            const start = searchableText.length;
            searchableText += text;
            itemRanges.push({
                start: start,
                end: searchableText.length,
                itemIndex: itemIndex
            });

        });

        const matchIndex = searchableText.indexOf(normalizedQuery);

        if (matchIndex !== -1) {
            const matchedItem = itemRanges.find(function (range) {
                return range.start <= matchIndex && range.end > matchIndex;
            });

            if (!matchedItem) {
                continue;
            }

            return {
                page: pageNumber,
                text: items[matchedItem.itemIndex].str,
                itemIndex: matchedItem.itemIndex
            };
        }

    }

    return null;

}

function normalizeRoomText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}


async function jumpToRoom(roomKey) {

    const room = roomLocations[roomKey];

    if (!room) {
        return;
    }

    await renderPage(room.page);

}


function showRoomMarkers() {

    const layer = document.getElementById("markerLayer");

    if (!layer) {
        return;
    }

    layer.innerHTML = "";

    ["current", "destination"].forEach(function (roomKey) {

        const room = roomLocations[roomKey];

        if (!room || room.page !== currentPage) {
            return;
        }

        const match = currentTextItems[room.itemIndex];

        if (!match) {
            return;
        }

        const marker = document.createElement("div");
        marker.className = `marker ${roomKey}-room-marker`;
        marker.style.left =
            match.x + Math.max(match.width, 20) / 2 + "px";
        marker.style.top = match.y - match.height - 12 + "px";
        marker.title =
            `${roomKey === "current" ? "Current room" : "Destination"}: ${room.text}`;

        const label = document.createElement("span");
        label.className = "marker-label";
        label.textContent =
            `${roomKey === "current" ? "Current" : "Destination"}: ${room.text}`;
        marker.appendChild(label);
        layer.appendChild(marker);

    });

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

        const midpointX = (touchA.clientX + touchB.clientX) / 2;
        const midpointY = (touchA.clientY + touchB.clientY) / 2;

        pinchStartDistance =
            Math.hypot(
                touchB.clientX - touchA.clientX,
                touchB.clientY - touchA.clientY
            );

        pinchStartZoom = zoom;
        pinchZoomAnchor =
            getZoomAnchor(midpointX, midpointY);

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

            if (pinchZoomAnchor) {
                canvasWrap.style.transformOrigin =
                    pinchZoomAnchor.mapX * canvasWrap.offsetWidth +
                    "px " +
                    pinchZoomAnchor.mapY * canvasWrap.offsetHeight +
                    "px";
            }

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

        scheduleZoomRender(pinchZoomAnchor);

    }

    pinchZoomAnchor = null;

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
                ? 1.1
                : 1 / 1.1,
            event.clientX,
            event.clientY
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

    ["currentRoom", "destinationRoom"].forEach(
        function (id) {

            const roomInput = document.getElementById(id);

            if (roomInput) {
                roomInput.value = "";
            }

        }
    );

    roomLocations = {};

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

        try {
            await deleteMapPreview(id);
        } catch (error) {
            console.error("Could not delete the cached map preview:", error);
        }

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