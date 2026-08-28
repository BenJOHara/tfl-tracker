const activeElement = document.querySelector("#active");
const historyElement = document.querySelector("#history");
const summaryElement = document.querySelector("#summary");
const pollStatusElement = document.querySelector("#poll-status");
const updatedElement = document.querySelector("#updated");
const historyLimitElement = document.querySelector("#history-limit");

let state = null;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[character]);
}

function duration(seconds) {
    if (seconds == null) return "--";
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h${String(remainder).padStart(2, "0")}m` : `${hours}h`;
}

function dateTime(value) {
    if (!value) return "--";
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

function predictionRows(prediction) {
    if (!prediction) {
        return `<div class="term-row"><span class="term-key">eta</span><span class="term-muted">insufficient historical sample</span></div>`;
    }
    return `
        <div class="term-row"><span class="term-key">eta</span><span class="term-good">${duration(prediction.p20)} .. ${duration(prediction.p80)}</span></div>
        <div class="term-row"><span class="term-key">median</span><span>${duration(prediction.median)} remaining</span></div>
        <div class="term-row"><span class="term-key">sample</span><span class="term-muted">n=${prediction.sampleSize} (${escapeHtml(prediction.basis)})</span></div>`;
}

function render() {
    if (!state) return;

    const active = Object.values(state.active || {});
    const history = state.history || [];
    const completedDurations = history.map(item => item.duration_seconds).filter(Number.isFinite);

    const metrics = [
        ["active", active.length],
        ["recorded", active.length + history.length],
        ["median", duration(percentile(completedDurations, 0.5))],
        ["p90", duration(percentile(completedDurations, 0.9))]
    ];
    summaryElement.innerHTML = metrics.map(([label, value]) => `
        <span class="sys-pair"><span class="sys-key">${label}=</span><span class="sys-value">${value ?? "--"}</span></span>
    `).join("");

    activeElement.innerHTML = active.length ? active.map(incident => {
        const prediction = predictionFor(incident, history);
        return `
            <article class="incident-block">
                <div class="incident-head">
                    <span class="incident-line">${escapeHtml(incident.line_name)}</span>
                    <span class="incident-status">[ ${escapeHtml(incident.severity).toUpperCase()} ]</span>
                </div>
                <div class="term-row"><span class="term-key">up</span><span class="term-warn">${duration(elapsedSeconds(incident))}</span><span class="term-muted">since ${dateTime(incident.first_seen)}</span></div>
                <div class="term-row"><span class="term-key">cause</span><span>${escapeHtml(incident.category || "unknown")}</span></div>
                <div class="term-row"><span class="term-key">msg</span><span>${escapeHtml(incident.reason)}</span></div>
                ${predictionRows(prediction)}
            </article>`;
    }).join("") : `<div class="terminal-ok">[ OK ] no active disruptions recorded</div>`;

    const limit = Number(historyLimitElement.value);
    historyElement.innerHTML = history.length ? history.slice(0, limit).map(incident => `
        <tr>
            <td>${escapeHtml(incident.line_name)}</td>
            <td>${escapeHtml(incident.category)}</td>
            <td>${escapeHtml(incident.severity)}</td>
            <td>${duration(incident.duration_seconds)}</td>
            <td>${dateTime(incident.resolved_at)}</td>
            <td class="message-cell">${escapeHtml(incident.reason)}</td>
        </tr>`).join("") : `<tr><td colspan="6" class="term-muted">-- no completed incidents --</td></tr>`;

    updatedElement.textContent = state.updated_at ? `state=${dateTime(state.updated_at)}` : "state=empty";
    pollStatusElement.textContent = "[ POLL ~5m ]";
}

async function refresh() {
    try {
        const response = await fetch(`./data/state.json?cache=${Date.now()}`, {cache: "no-store"});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state = await response.json();
        render();
    } catch (error) {
        pollStatusElement.textContent = `[ ERROR ${error.message} ]`;
        pollStatusElement.classList.add("error");
    }
}

historyLimitElement.addEventListener("change", render);
refresh();
setInterval(render, 15000);
setInterval(refresh, 300000);
