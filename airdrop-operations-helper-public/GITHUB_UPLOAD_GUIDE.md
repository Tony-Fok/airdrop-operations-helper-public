# GitHub Upload Guide

This guide explains how to prepare and upload this project to GitHub.

## 1. Public vs Private Repository

Recommended default: use a private repository.

Use a public repository only after confirming that the code, filenames, package metadata, documentation, and example files do not expose internal chain, DApp, explorer, RPC, wallet, token, or operational information.

Current public-safe files prepared in this pass:

- `README.md`
- `airdrop_config.example.json`
- `.gitignore`

Files and directories excluded by `.gitignore`:

- `airdrop_config.json`
- `airdrop_config.json.save`
- `.env`
- `reports/`
- `screenshots/`
- `logs/`
- `playwright-profile/`
- `node_modules/`
- `dashboard/dist/`
- old internal manual file

## 2. Recommended Pre-Upload Check

Before uploading, run a keyword scan for any internal project names, target page URLs, explorer URLs, RPC URLs, wallet addresses, token contracts, and real infrastructure domains.

Review every match manually.

Some matches may be generic or harmless, but anything that reveals production infrastructure, chain identity, wallet address, token contract, explorer URL, or target DApp URL should be removed or replaced before publishing.

## 3. Initialize Git

From the project directory:

```bash
git init
git status
```

Check the untracked file list carefully. Confirm sensitive files are ignored.

## 4. Add Files

```bash
git add README.md DEVELOPMENT_HISTORY.md GITHUB_UPLOAD_GUIDE.md .gitignore package.json package-lock.json tsconfig.json vite.config.ts airdrop_config.example.json src dashboard
git status
```

Do not use `git add .` until you are confident `.gitignore` is correct.

## 5. First Commit

```bash
git commit -m "chore: prepare dashboard helper for repository upload"
```

## 6. Create GitHub Repository

On GitHub:

1. Create a new repository.
2. Prefer `Private` unless the project has been fully sanitized.
3. Do not initialize with README, license, or gitignore if you already committed these locally.

## 7. Connect Remote

Replace the URL with your repository URL:

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPOSITORY.git
git branch -M main
git push -u origin main
```

If using HTTPS instead of SSH:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git branch -M main
git push -u origin main
```

## 8. After Upload

Check GitHub manually:

- Confirm `airdrop_config.json` is not present.
- Confirm `reports/`, `screenshots/`, `logs/`, `playwright-profile/`, and `node_modules/` are not present.
- Confirm README does not expose target DApp, chain, explorer, RPC, wallet, or token contract information.
- Confirm repository visibility is what you intended.

## 9. Running The Project Later

Start Chrome with remote debugging if the wallet extension workflow needs the existing browser profile:

```bash
osascript -e 'quit app "Google Chrome"'
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Start the local Dashboard:

```bash
DASHBOARD_API_PORT=3002 npm run dashboard:api
```

Open:

```text
http://127.0.0.1:3002
```

The Dashboard runs only while the terminal process is alive.
