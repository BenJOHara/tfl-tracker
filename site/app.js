const activeElement = document.querySelector("#active");
const historyElement = document.querySelector("#history");
const summaryElement = document.querySelector("#summary");
const pollStatusElement = document.querySelector("#poll-status");
const updatedElement = document.querySelector("#updated");
const historyLimitElement = document.querySelector("#history-limit");
const themeButtons = [...document.querySelectorAll("[data-theme-choice]")];
const themeColourElement = document.querySelector('meta[name="theme-color"]');

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
    ops: "#111418"
};

let state = null;

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
        return `
            <article class="incident-block">
                <div class="incident-head">
                    <div>
                        <div class="incident-line">${escapeHtml(incident.line_name)}</div>
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
    }).join("") : `<div class="empty-state">No active disruptions are currently recorded.</div>`;

    const limit = Number(historyLimitElement.value);
    historyElement.innerHTML = history.length ? history.slice(0, limit).map(incident => `
        <tr>
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
historyLimitElement.addEventListener("change", render);

setTheme(initialTheme());
refresh();
setInterval(render, 15000);
setInterval(refresh, 300000);
