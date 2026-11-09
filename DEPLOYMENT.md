# StoryAI distribution

## Direct Windows use with npm

Recommended for users who want to run StoryAI directly in a terminal without Docker.

Requirements: Node.js 22 or newer, Git for Windows, and FFmpeg/FFprobe in `PATH` for MP4 rendering.

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

`npm start` creates local `.env` and its encryption key on first run, installs dependencies if needed, builds the production app, and serves it at `http://localhost:3011`. On later starts, it fast-forwards a clean clone on `main` to the latest commit, then reinstalls dependencies or rebuilds only when required. If the source folder contains local tracked changes, the updater skips `git pull` to preserve them.

## Optional Docker distribution

The public GHCR image remains available at `ghcr.io/nghiencarcom/storydola:latest`. The release asset `storyai-installer.zip` is for Docker-based installs. Users following the direct npm method should clone the repository as described above; downloading GitHub's source ZIP does not include Git metadata and therefore cannot auto-update.

## Data and updates

- Each user keeps projects, media, renders, and API credentials in local `data/` and `.env` files.
- Git ignores those local files, so pulling source updates leaves them in place.
- Back up `data/` and `.env` together. Keep `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` unchanged to read saved API credentials.
- npm-based updates are checked when the user runs `npm start`; running instances do not hot-swap code in the background.
- Docker-based installations check the image when their launcher runs.
