# TfL Incident Tracker

A tiny TfL disruption-history tracker designed to run entirely on GitHub's free public-repository infrastructure.

- **GitHub Pages** hosts the dashboard.
- **GitHub Actions** checks TfL roughly every 5 minutes.
- Incident history is stored in `site/data/state.json`.
- No package manager, framework, database server or API key is required.
- Python standard library only.

## What it does

For each disruption it records when the incident was first seen and when it disappears. The dashboard shows how long active incidents have lasted and estimates remaining time from historical incidents that survived at least as long as the current incident.

The prediction starts with same-line + same-cause history, then falls back to same cause, same line and finally all incidents. It only shows a prediction with at least three comparable completed incidents.

## GitHub setup

1. Create a **public** GitHub repository and put these files on its `main` branch.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Open **Actions → Collect TfL incidents → Run workflow** once to initialise collection immediately.

The Pages URL will then be shown by the `Deploy GitHub Pages` workflow.

## Why collection is every 5 minutes

GitHub Actions' shortest supported scheduled interval is five minutes, and scheduled runs can occasionally be delayed. This is adequate for building incident-duration history without running a paid server.

The collector does **not** commit every five minutes. It commits only when an incident appears, disappears, or its message changes, keeping repository history small.

## Local test

```bash
python3 -m unittest -v
```

Run one real collection:

```bash
python3 collector.py
```

Serve the static site locally:

```bash
python3 -m http.server 8787 --directory site
```

Then open `http://127.0.0.1:8787`.

## Data

Data provided by Transport for London. This project is not an official TfL application.
