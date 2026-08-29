(() => {
    const originalFetch = window.fetch.bind(window);
    const responseLog = [];
    const MAX_RESPONSES = 200;

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>'"]/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;"
        })[character]);
    }

    function trackedSource(input) {
        const url = typeof input === "string" ? input : input?.url || "";
        if (url.includes("api.tfl.gov.uk/Line/Mode/") && url.includes("/Status")) {
            return {name: "TfL live", url};
        }
        if (url.includes("data/state.json")) {
            return {name: "Saved state", url};
        }
        return null;
    }

    function formatTime(value) {
        return new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(new Date(value));
    }

    function describePayload(source, payload) {
        if (source === "TfL live" && Array.isArray(payload)) {
            let statusCount = 0;
            let disruptionCount = 0;
            for (const line of payload) {
                const statuses = line.lineStatuses || [];
                statusCount += statuses.length;
                for (const status of statuses) {
                    const severity = String(status.statusSeverityDescription || "").toLowerCase();
                    const reason = String(status.reason || "").trim();
                    if (reason || !["good service", "special service"].includes(severity)) {
                        disruptionCount += 1;
                    }
                }
            }
            return `${payload.length} lines · ${statusCount} statuses · ${disruptionCount} disruptions`;
        }

        if (source === "Saved state" && payload && typeof payload === "object") {
            const activeCount = Object.keys(payload.active || {}).length;
            const historyCount = Array.isArray(payload.history) ? payload.history.length : 0;
            const updated = payload.updated_at ? ` · data ${formatTime(payload.updated_at)}` : "";
            return `${activeCount} active · ${historyCount} history${updated}`;
        }

        if (Array.isArray(payload)) return `${payload.length} items`;
        if (payload && typeof payload === "object") return `${Object.keys(payload).length} fields`;
        return "response body";
    }

    function addResponse(entry) {
        responseLog.unshift(entry);
        if (responseLog.length > MAX_RESPONSES) responseLog.length = MAX_RESPONSES;
        renderResponses();
    }

    async function readResponseBody(response) {
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            try {
                return await clone.json();
            } catch (_) {}
        }
        try {
            return await clone.text();
        } catch (_) {
            return "<unable to read response body>";
        }
    }

    window.fetch = async (...args) => {
        const tracked = trackedSource(args[0]);
        if (!tracked) return originalFetch(...args);

        const started = performance.now();
        const requestedAt = new Date().toISOString();

        try {
            const response = await originalFetch(...args);
            const payload = await readResponseBody(response);
            addResponse({
                requestedAt,
                source: tracked.name,
                url: tracked.url,
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                elapsedMs: Math.round(performance.now() - started),
                summary: describePayload(tracked.name, payload),
                payload
            });
            return response;
        } catch (error) {
            addResponse({
                requestedAt,
                source: tracked.name,
                url: tracked.url,
                ok: false,
                status: null,
                statusText: "Network error",
                elapsedMs: Math.round(performance.now() - started),
                summary: error?.message || String(error),
                payload: {error: error?.message || String(error)}
            });
            throw error;
        }
    };

    function renderResponses() {
        const list = document.querySelector("#response-list");
        const count = document.querySelector("#response-count");
        if (!list || !count) return;

        count.textContent = `${responseLog.length} response${responseLog.length === 1 ? "" : "s"} since page opened`;

        if (!responseLog.length) {
            list.innerHTML = `<div class="response-empty">Waiting for the first fetch…</div>`;
            return;
        }

        list.innerHTML = responseLog.map((entry, index) => {
            const status = entry.status == null ? entry.statusText : `HTTP ${entry.status}`;
            const raw = typeof entry.payload === "string"
                ? entry.payload
                : JSON.stringify(entry.payload, null, 2);
            const endpoint = entry.url.split("?")[0];

            return `
                <details class="response-entry"${index === 0 ? " open" : ""}>
                    <summary class="response-summary">
                        <span class="response-time">${escapeHtml(formatTime(entry.requestedAt))}</span>
                        <strong class="response-source">${escapeHtml(entry.source)}</strong>
                        <span class="response-status ${entry.ok ? "ok" : "error"}">${escapeHtml(status)}</span>
                        <span class="response-latency">${entry.elapsedMs} ms</span>
                        <span class="response-description">${escapeHtml(entry.summary)}</span>
                    </summary>
                    <div class="response-detail">
                        <div class="response-url">${escapeHtml(endpoint)}</div>
                        <pre>${escapeHtml(raw)}</pre>
                    </div>
                </details>`;
        }).join("");
    }

    function setView(view) {
        const showResponses = view === "responses";
        document.querySelectorAll(".dashboard-section").forEach(section => {
            section.hidden = showResponses;
        });
        const responsesView = document.querySelector("#responses-view");
        if (responsesView) responsesView.hidden = !showResponses;

        document.querySelectorAll("[data-view-choice]").forEach(button => {
            const selected = button.dataset.viewChoice === view;
            button.classList.toggle("selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
    }

    function initialiseUi() {
        const tabs = document.querySelector("#view-tabs");
        if (!tabs) return;

        tabs.addEventListener("click", event => {
            const button = event.target.closest("[data-view-choice]");
            if (!button) return;
            setView(button.dataset.viewChoice);
        });

        const clearButton = document.querySelector("#clear-responses");
        clearButton?.addEventListener("click", () => {
            responseLog.length = 0;
            renderResponses();
        });

        setView("dashboard");
        renderResponses();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialiseUi, {once: true});
    } else {
        initialiseUi();
    }
})();
