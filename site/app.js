const activeElement = document.querySelector("#active");
const historyElement = document.querySelector("#history");
const summaryElement = document.querySelector("#summary");
const pollStatusElement = document.querySelector("#poll-status");
const updatedElement = document.querySelector("#updated");
const historyLimitElement = document.querySelector("#history-limit");

let state = null;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
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
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
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
        return `<div class="prediction"><div class="pred-detail">Not enough comparable completed incidents yet.</div></div>`;
    }
    return `
        <div class="prediction">
            <div class="pred-main">Likely another ${duration(prediction.p20)}–${duration(prediction.p80)}</div>
            <div class="pred-detail">Median remaining: ${duration(prediction.median)}</div>
            <div class="sample">${prediction.sampleSize} comparable incidents · ${escapeHtml(prediction.basis)}</div>
        </div>`;
}

function render() {
    if (!state) return;
    const active = Object.values(state.active || {});
    const history = state.history || [];
    const completedDurations = history.map(item => item.duration_seconds).filter(Number.isFinite);

    summaryElement.innerHTML = [
        ["Active", active.length],
        ["Recorded", active.length + history.length],
        ["Median duration", duration(percentile(completedDurations, 0.5))],
        ["90th percentile", duration(percentile(completedDurations, 0.9))]
    ].map(([label, value]) => `
        <div class="metric"><span class="metric-label">${label}</span><span class="metric-value">${value ?? "—"}</span></div>
    `).join("");

    activeElement.innerHTML = active.length ? active.map(incident => `
        <article class="card">
            <div class="card-top">
                <span class="line">${escapeHtml(incident.line_name)}</span>
                <span class="badge">${escapeHtml(incident.severity)}</span>
            </div>
            <div class="reason">${escapeHtml(incident.reason)}</div>
            <div class="age">${duration(elapsedSeconds(incident))}</div>
            <div class="age-label">active since ${dateTime(incident.first_seen)}</div>
            ${predictionHtml(predictionFor(incident, history))}
        </article>
    `).join("") : `<div class="no-data">No active disruptions are currently recorded.</div>`;

    const limit = Number(historyLimitElement.value);
    historyElement.innerHTML = history.length ? history.slice(0, limit).map(incident => `
        <tr>
            <td><strong>${escapeHtml(incident.line_name)}</strong></td>
            <td>${escapeHtml(incident.category)}</td>
            <td>${escapeHtml(incident.severity)}</td>
            <td>${duration(incident.duration_seconds)}</td>
            <td>${dateTime(incident.resolved_at)}</td>
            <td class="message-cell">${escapeHtml(incident.reason)}</td>
        </tr>
    `).join("") : `<tr><td colspan="6">No completed incidents yet.</td></tr>`;

    updatedElement.textContent = state.updated_at ? `Incident data changed ${dateTime(state.updated_at)}` : "No incidents recorded yet";
    pollStatusElement.textContent = "TfL checked by GitHub Actions every ~5 min";
}

async function refresh() {
    try {
        const response = await fetch(`./data/state.json?cache=${Date.now()}`, {cache: "no-store"});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state = await response.json();
        render();
    } catch (error) {
        pollStatusElement.textContent = `Dashboard error: ${error.message}`;
        pollStatusElement.classList.add("error");
    }
}

historyLimitElement.addEventListener("change", render);
refresh();
setInterval(render, 15000);
setInterval(refresh, 300000);
