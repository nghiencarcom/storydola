# Install and run StoryAI

StoryAI runs on the user's computer as a local web app. It does not require Docker.

## Requirements

- Node.js 22 or newer
- Git, for cloning and automatic updates
- FFmpeg and FFprobe, only if you need MP4 rendering

## Install

```sh
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

The first run creates a local `.env` file and encryption key, installs npm dependencies, builds the production app, and opens `http://localhost:3012`. Keep the terminal open while using StoryAI. Press `Ctrl+C` to stop it.

On a clean clone of the `main` branch, `npm start` checks GitHub for updates before starting. Downloaded source ZIPs do not contain Git metadata, so they do not update automatically.

When the maintainer pushes a commit to `main`, users receive it the next time they run `npm start` from a clean clone. Keep the terminal output if an update or build fails.

## Local data

Projects, media, renders, and credentials stay in the local `data/` directory and `.env` file. Back them up together. Keep `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` unchanged to read saved credentials.

## Troubleshooting

Check the terminal output first. StoryAI also writes runtime details and server output to `logs/storyai-supervisor.log`. Include the operating system, `node --version`, the steps that caused the error, and the relevant sanitized log lines in a GitHub issue. Never attach `.env`, `data/`, API keys, or login tokens.
