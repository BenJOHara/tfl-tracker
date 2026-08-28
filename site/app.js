const activeElement = document.querySelector("#active");
const historyElement = document.querySelector("#history");
const summaryElement = document.querySelector("#summary");
const pollStatusElement = document.querySelector("#poll-status");
const updatedElement = document.querySelector("#updated");
const historyLimitElement = document.querySelector("#history-limit");

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
const expandedLines = new Set();

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

function lineHistoryHtml(incident, history) {
    const lineKey = incidentLineKey(incident);
    const lineHistory = history.filter(item => incidentLineKey(item) === lineKey);
    const durations = lineHistory.map(item => item.duration_seconds).filter(Number.isFinite);

    if (!lineHistory.length) {
        return `
            <div class="line-history-panel">
                <div class="line-history-title">${escapeHtml(incident.line_name)} history</div>
                <div class="line-history-empty">No completed incidents recorded yet.</div>
            </div>`;
    }

    const recentRows = lineHistory.slice(0, 5).map(item => `
        <tr>
            <td>${dateTime(item.resolved_at)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>${duration(item.duration_seconds)}</td>
            <td>${escapeHtml(item.severity)}</td>
        </tr>`).join("");

    return `
        <div class="line-history-panel">
            <div class="line-history-title">${escapeHtml(incident.line_name)} history</div>
            <div class="line-history-stats">
                <span><strong>${lineHistory.length}</strong> incidents</span>
                <span><strong>${duration(percentile(durations, 0.5))}</strong> median</span>
                <span><strong>${duration(percentile(durations, 0.9))}</strong> p90</span>
            </div>
            <div class="line-history-table-wrap">
                <table class="line-history-table">
                    <thead><tr><th>Resolved</th><th>Cause</th><th>Duration</th><th>Status</th></tr></thead>
                    <tbody>${recentRows}</tbody>
                </table>
            </div>
        </div>`;
}

function render() {
    if (!state) return;

    const active = Object.values(state.active || {});
    const history = state.history || [];
    const completedDurations = history.map(item => item.duration_seconds).filter(Number.isFinite);

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
        const prediction = predictionFor(incident, history);
        const lineKey = incidentLineKey(incident);
        const expanded = expandedLines.has(lineKey);
        return `
            <article class="incident-block${expanded ? " line-expanded" : ""}" style="--line-colour:${lineColour(incident)}">
                <div class="incident-head">
                    <div>
                        <div class="incident-line">
                            <button type="button" class="line-link" data-line-expand="${escapeHtml(lineKey)}" aria-expanded="${expanded}">${escapeHtml(incident.line_name)}</button>
                        </div>
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
                ${expanded ? lineHistoryHtml(incident, history) : ""}
            </article>`;
    }).join("") : `<div class="empty-state">No active disruptions are currently recorded.</div>`;

    const limit = Number(historyLimitElement.value);
    historyElement.innerHTML = history.length ? history.slice(0, limit).map(incident => `
        <tr style="--line-colour:${lineColour(incident)}">
            <td><strong>${escapeHtml(incident.line_name)}</strong></td>
            <td>${escapeHtml(incident.category)}</td>
            <td>${escapeHtml(incident.severity)}</td>
            <td>${duration(incident.duration_seconds)}</td>
            <td>${dateTime(incident.resolved_at)}</td>
            <td class="message-cell">${escapeHtml(incident.reason)}</td>
        </tr>`).join("") : `<tr><td colspan="6" class="muted">No completed incidents yet.</td></tr>`;

    updatedElement.textContent = state.updated_at ? `Updated ${dateTime(state.updated_at)}` : "No incidents recorded yet";
    pollStatusElement.textContent = "TfL check ~5 min";
}

function handleLineExpand(event) {
    const button = event.target.closest("[data-line-expand]");
    if (!button) return;

    const lineKey = button.dataset.lineExpand;
    if (expandedLines.has(lineKey)) {
        expandedLines.delete(lineKey);
    } else {
        expandedLines.add(lineKey);
    }
    render();
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

activeElement.addEventListener("click", handleLineExpand);
historyLimitElement.addEventListener("change", render);

refresh();
setInterval(render, 15000);
setInterval(refresh, 300000);
