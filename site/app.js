const activeElement = document.querySelector("#active");
const historyElement = document.querySelector("#history");
const summaryElement = document.querySelector("#summary");
const pollStatusElement = document.querySelector("#poll-status");
const updatedElement = document.querySelector("#updated");
const historyLimitElement = document.querySelector("#history-limit");
const themeButtons = [...document.querySelectorAll("[data-theme-choice]")];
const themeColourElement = document.querySelector('meta[name="theme-color"]');
const systemHeadingElement = summaryElement.closest("section").querySelector("h2");
const activeHeadingElement = activeElement.closest("section").querySelector("h2");
const historyHeadingElement = historyElement.closest("section").querySelector("h2");
const historyControlElement = document.querySelector(".history-control");

const lineFilterClearElement = document.createElement("button");
lineFilterClearElement.type = "button";
lineFilterClearElement.className = "line-filter-clear";
lineFilterClearElement.textContent = "Show all lines";
lineFilterClearElement.hidden = true;
historyControlElement.parentElement.insertBefore(lineFilterClearElement, historyControlElement);

const themeColours = {
    clean: "#f4f5f7",
    tfl: "#071f3d",
    terminal: "#080b09",
    light: "#ffffff",
    swiss: "#f2f0e9",
    brutal: "#f4ff00",
    paper: "#eee8d9",
    midnight: "#090d18",
    crt: "#020a04",
    ops: "#111418",
    win96: "#008080",
    signal: "#071014",
    bare: "#fafafa"
};

const lineColours = {
    "bakerloo": "#B36305",
    "central": "#E32017",
    "circle": "#FFD300",
    "district": "#00782A",
    "hammersmith-city": "#F3A9BB",
    "hammersmith & city": "#F3A9BB",
    "jubilee": "#A0A5A9",
    "metropolitan": "#9B0056",
    "northern": "#000000",
    "piccadilly": "#003688",
    "victoria": "#0098D4",
    "waterloo-city": "#95CDBA",
    "waterloo & city": "#95CDBA",
    "elizabeth": "#6950A1",
    "elizabeth line": "#6950A1",
    "dlr": "#00A4A7",
    "tram": "#84B817",
    "london-overground": "#EE7C0E",
    "london overground": "#EE7C0E",
    "overground": "#EE7C0E",
    "lioness": "#EE7C0E",
    "mildmay": "#EE7C0E",
    "windrush": "#EE7C0E",
    "weaver": "#EE7C0E",
    "suffragette": "#EE7C0E",
    "liberty": "#EE7C0E"
};

let state = null;
let selectedLineKey = null;
let selectedLineName = null;

function setTheme(theme) {
    const validTheme = themeButtons.some(button => button.dataset.themeChoice === theme) ? theme : "clean";
    document.body.dataset.theme = validTheme;
    themeButtons.forEach(button => {
        const selected = button.dataset.themeChoice === validTheme;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
    if (themeColourElement) themeColourElement.content = themeColours[validTheme] || themeColours.clean;
    try {
        localStorage.setItem("tfl-theme", validTheme);
    } catch (_) {
        // Theme persistence is optional.
    }
}

function initialTheme() {
    try {
        return localStorage.getItem("tfl-theme") || "clean";
    } catch (_) {
        return "clean";
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[character]);
}

function incidentLineKey(incident) {
    return String(incident.line_id || incident.line_name || "").trim().toLowerCase();
}

function lineColour(incident) {
    const lineId = String(incident.line_id || "").toLowerCase();
    const lineName = String(incident.line_name || "").toLowerCase();
    return lineColours[lineId] || lineColours[lineName] || "#777777";
}

function duration(seconds) {
    if (seconds == null) return "—";
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dateTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(new Date(value));
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function elapsedSeconds(incident) {
    return Math.max(0, (Date.now() - new Date(incident.first_seen).getTime()) / 1000);
}

function predictionFor(incident, history) {
    const elapsed = elapsedSeconds(incident);
    const eligible = history.filter(item => item.duration_seconds >= elapsed);
    const matchers = [
        [item => item.line_id === incident.line_id && item.category === incident.category, "same line + cause"],
        [item => item.category === incident.category, "same cause"],
        [item => item.line_id === incident.line_id, "same line"],
        [() => true, "all incidents"]
    ];

    for (const [matches, basis] of matchers) {
        const remaining = eligible.filter(matches).map(item => item.duration_seconds - elapsed);
        if (remaining.length >= 3) {
            return {
                sampleSize: remaining.length,
                basis,
                p20: percentile(remaining, 0.2),
                median: percentile(remaining, 0.5),
                p80: percentile(remaining, 0.8)
            };
        }
    }
    return null;
}

function predictionHtml(prediction) {
    if (!prediction) {
        return `<div class="prediction unavailable">Not enough comparable completed incidents yet.</div>`;
    }
    return `
        <div class="prediction">
            <span class="prediction-range">Likely another ${duration(prediction.p20)}–${duration(prediction.p80)}</span>
            <span class="prediction-median">Median ${duration(prediction.median)}</span>
            <span class="prediction-sample">n=${prediction.sampleSize} · ${escapeHtml(prediction.basis)}</span>
        </div>`;
}

function lineLinkHtml(incident) {
    return `<button type="button" class="line-link" data-line-filter="${escapeHtml(incidentLineKey(incident))}" data-line-name="${escapeHtml(incident.line_name)}">${escapeHtml(incident.line_name)}</button>`;
}

function updateLineViewLabels() {
    if (selectedLineKey) {
        systemHeadingElement.textContent = `${selectedLineName} statistics`;
        activeHeadingElement.textContent = `${selectedLineName} — current`;
        historyHeadingElement.textContent = `${selectedLineName} history`;
        lineFilterClearElement.hidden = false;
    } else {
        systemHeadingElement.textContent = "System";
        activeHeadingElement.textContent = "Active disruptions";
        historyHeadingElement.textContent = "Incident history";
        lineFilterClearElement.hidden = true;
    }
}

function render() {
    if (!state) return;

    const allActive = Object.values(state.active || {});
    const allHistory = state.history || [];
    const active = selectedLineKey ? allActive.filter(item => incidentLineKey(item) === selectedLineKey) : allActive;
    const history = selectedLineKey ? allHistory.filter(item => incidentLineKey(item) === selectedLineKey) : allHistory;
    const completedDurations = history.map(item => item.duration_seconds).filter(Number.isFinite);

    updateLineViewLabels();

    const metrics = [
        ["Active", active.length],
        ["Recorded", active.length + history.length],
        ["Median duration", duration(percentile(completedDurations, 0.5))],
        ["90th percentile", duration(percentile(completedDurations, 0.9))]
    ];
    summaryElement.innerHTML = metrics.map(([label, value]) => `
        <div class="metric"><span class="metric-label">${label}</span><span class="metric-value">${value ?? "—"}</span></div>
    `).join("");

    activeElement.innerHTML = active.length ? active.map(incident => {
        const prediction = predictionFor(incident, allHistory);
        return `
            <article class="incident-block" style="--line-colour:${lineColour(incident)}">
                <div class="incident-head">
                    <div>
                        <div class="incident-line">${lineLinkHtml(incident)}</div>
                        <div class="incident-cause">${escapeHtml(incident.category || "Unknown cause")}</div>
                    </div>
                    <span class="incident-status">${escapeHtml(incident.severity)}</span>
                </div>
                <div class="incident-age">
                    <span class="age-value">${duration(elapsedSeconds(incident))}</span>
                    <span class="age-label">active · since ${dateTime(incident.first_seen)}</span>
                </div>
                <div class="incident-message">${escapeHtml(incident.reason)}</div>
                ${predictionHtml(prediction)}
            </article>`;
    }).join("") : `<div class="empty-state">${selectedLineKey ? `No active ${escapeHtml(selectedLineName)} disruptions are currently recorded.` : "No active disruptions are currently recorded."}</div>`;

    const limit = Number(historyLimitElement.value);
    historyElement.innerHTML = history.length ? history.slice(0, limit).map(incident => `
        <tr style="--line-colour:${lineColour(incident)}">
            <td><strong>${lineLinkHtml(incident)}</strong></td>
            <td>${escapeHtml(incident.category)}</td>
            <td>${escapeHtml(incident.severity)}</td>
            <td>${duration(incident.duration_seconds)}</td>
            <td>${dateTime(incident.resolved_at)}</td>
            <td class="message-cell">${escapeHtml(incident.reason)}</td>
        </tr>`).join("") : `<tr><td colspan="6" class="muted">${selectedLineKey ? `No completed ${escapeHtml(selectedLineName)} incidents yet.` : "No completed incidents yet."}</td></tr>`;

    updatedElement.textContent = state.updated_at ? `Updated ${dateTime(state.updated_at)}` : "No incidents recorded yet";
    pollStatusElement.textContent = "TfL check ~5 min";
}

function selectLine(lineKey, lineName) {
    selectedLineKey = lineKey;
    selectedLineName = lineName;
    render();
    historyElement.closest("section").scrollIntoView({behavior: "smooth", block: "start"});
}

function clearLineFilter() {
    selectedLineKey = null;
    selectedLineName = null;
    render();
}

function handleLineClick(event) {
    const button = event.target.closest("[data-line-filter]");
    if (!button) return;
    selectLine(button.dataset.lineFilter, button.dataset.lineName);
}

async function refresh() {
    try {
        const response = await fetch(`./data/state.json?cache=${Date.now()}`, {cache: "no-store"});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state = await response.json();
        pollStatusElement.classList.remove("error");
        render();
    } catch (error) {
        pollStatusElement.textContent = `Data error: ${error.message}`;
        pollStatusElement.classList.add("error");
    }
}

themeButtons.forEach(button => {
    button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
});
activeElement.addEventListener("click", handleLineClick);
historyElement.addEventListener("click", handleLineClick);
lineFilterClearElement.addEventListener("click", clearLineFilter);
historyLimitElement.addEventListener("change", render);

setTheme(initialTheme());
refresh();
setInterval(render, 15000);
setInterval(refresh, 300000);
