# StoryAI

StoryAI is a local-first workspace for writing stories and producing AI-assisted video. Each installation stores its projects and media on that computer.

## Start on Windows without Docker

Install Node.js LTS, Git for Windows, and FFmpeg/FFprobe with WinGet, then run in PowerShell:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
winget install --id Gyan.FFmpeg --exact
```

Close and reopen PowerShell after installation, then run:

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

The first start installs dependencies, builds the app, creates local configuration and opens `http://localhost:3011`. Later starts check `main` for updates and rebuild when source files have changed. WinGet is part of Windows Package Manager/App Installer; see [README-USER.md](README-USER.md) for details.

See [README-USER.md](README-USER.md) for setup, updates, and local data details.

## Writing plugins and trend guides

- [US Everyday Drama Writer](plugins/PhimUS.zip)
- [Drama Đời Thường Việt](plugins/PhimViet.zip)
- [Trend bank (2005–2026)](plugins/drama-viet/references/trend-bank-2005-2026.md)
- [Trend vocabulary](plugins/drama-viet/references/trend-vocabulary.md)

## Local data

Projects, media, renders, and `.env` stay on the user's computer. Keep `data/` and `.env` backed up together; the encryption key in `.env` is needed to read saved API credentials.

## Container distribution

The public container image is `ghcr.io/nghiencarcom/storydola:latest`. Docker deployment notes are in [DEPLOYMENT.md](DEPLOYMENT.md).
