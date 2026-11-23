# StoryAI

StoryAI is a local-first workspace for writing stories and producing AI-assisted video. Each installation stores its projects and media on that computer.

## Start on macOS or Windows

Install Node.js 22 or newer and Git. Both FFmpeg and FFprobe are needed for MP4 rendering. On Windows, install the requirements with WinGet:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
```

Install FFmpeg and FFprobe together if you need MP4 rendering:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Close and reopen PowerShell after installation, then run:

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

The first start installs dependencies, builds the app, creates local configuration and opens `http://localhost:3012`. Later starts check `main` for updates and rebuild when source files have changed. Keep the terminal open while using StoryAI; press `Ctrl+C` to stop it. See [README-USER.md](README-USER.md) for setup, updates, and local data details.

On macOS, install Node.js and Git with your preferred package manager or installers, then run the same clone and `npm start` commands in Terminal.

With Homebrew, install Node.js and Git using `brew install node git`. Add `brew install ffmpeg` for MP4 rendering; this provides both `ffmpeg` and `ffprobe`. If you do not use Homebrew, get Node.js from [nodejs.org](https://nodejs.org/en/download/) and Git from [git-scm.com](https://git-scm.com/downloads/).

Before cloning, confirm `node --version` reports v22 or newer, then check `npm --version` and `git --version`. If MP4 rendering is needed, also check `ffmpeg -version` and `ffprobe -version`.

## Writing plugins and trend guides

- [PhimUS](plugins/PhimUS.zip)
- [PhimViet](plugins/PhimViet.zip)

Cả hai plugin mặc định viết hook gợi tò mò cho từng tập và yêu cầu đạt ít nhất 13/15; khi có cửa sổ thời gian, chấm hình ảnh và lời thoại riêng trong đúng khoảng đó. Plugin cũng rà thoại liên tục, giới hạn tốc độ khoảng 3 từ/giây; nếu bạn yêu cầu duyệt thoại trước JSON, plugin chỉ đưa bản chữ và ghi chú im lặng rồi chờ bạn phản hồi.

- [Trend bank (2005–2026)](plugins/drama-viet/references/trend-bank-2005-2026.md)
- [Trend vocabulary](plugins/drama-viet/references/trend-vocabulary.md)

## Local data

Projects, media, renders, and `.env` stay on the user's computer. Keep `data/` and `.env` backed up together; the encryption key in `.env` is needed to read saved API credentials.
