# StoryAI

StoryAI is a local-first workspace for writing stories and producing AI-assisted video. Each installation stores its projects and media on that computer.

## Start on Windows without Docker

Install Node.js 22 or newer and Git for Windows, then run in PowerShell:

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

The first start installs dependencies, builds the app, creates local configuration and opens `http://localhost:3011`. Later starts check `main` for updates and rebuild when source files have changed. FFmpeg and FFprobe are required for MP4 rendering.

See [README-USER.md](README-USER.md) for setup, updates, and local data details.

## Local data

Projects, media, renders, and `.env` stay on the user's computer. Keep `data/` and `.env` backed up together; the encryption key in `.env` is needed to read saved API credentials.

## Container distribution

The public container image is `ghcr.io/nghiencarcom/storydola:latest`. Docker deployment notes are in [DEPLOYMENT.md](DEPLOYMENT.md).
