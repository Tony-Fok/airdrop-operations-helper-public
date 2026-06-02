[README.md](https://github.com/user-attachments/files/28499357/README.md)
# airdrop-operations-helper-public# Airdrop Operations Helper

A local dashboard and automation helper for repetitive token distribution operations.

This project is designed for operators who need to prepare, run, monitor, and review multiple token distribution tasks through an existing web page and wallet extension workflow.

It does not include any target DApp URL, chain name, private RPC, wallet address, token contract, or production network information. Those values must be provided locally through configuration.

## What It Does

- Provides a local Dashboard for single-task and integrated multi-task runs.
- Resolves task input from a local token registry.
- Opens the configured web page and fills token contract, amount per address, and recipient count.
- Generates random recipient addresses through the page workflow.
- Optionally clicks the page-level start/authorize button after addresses are generated.
- Watches wallet extension popups and clicks common workflow buttons such as connect, next, approve, confirm, and sign.
- Runs integrated tasks in sequence while reusing the same page session.
- Records runtime logs directly inside the Home and Integrated Task pages.
- Calculates gas cost from before/after native balance and receipt data when available.
- Checks token balance and holder count through a configured explorer endpoint.
- Writes CSV reports and shows history with single-task and integrated-task views.

## What It Does Not Do

- It does not unlock the wallet extension.
- It does not enter wallet passwords.
- It does not store private keys or seed phrases.
- It does not construct or sign transactions by itself.
- It does not include production chain, token, RPC, explorer, or DApp configuration.
- It does not replace operator review. You should still verify page data before running real tasks.

## Main Screens

| Screen | Purpose |
|---|---|
| Home | Create and run one distribution task. |
| Integrated Task | Build a queue of subtasks and run them in sequence. |
| Settings | Edit local runtime settings and token registry. |
| History | Review single-task and integrated-task results by date. |

Runtime logs are embedded in Home and Integrated Task, so operators do not need to switch to a separate log page during execution.

## Requirements

- Node.js 20 or later
- npm
- Google Chrome
- A wallet browser extension installed in Chrome
- A local configuration file with:
  - target page URL
  - RPC URL
  - wallet address
  - explorer base URL
  - token registry

## Installation

```bash
npm install
npm run install:browsers
cp airdrop_config.example.json airdrop_config.json
```

Then edit `airdrop_config.json` locally.

Do not commit `airdrop_config.json`. It may contain private infrastructure, wallet, and token information.

## Start The Dashboard

By default:

```bash
npm run dashboard:api
```

Open:

```text
http://127.0.0.1:3002
```

If you want to specify the port explicitly:

```bash
DASHBOARD_API_PORT=3002 npm run dashboard:api
```

The Dashboard is a local service. If the terminal closes, the service stops and you need to run the command again.

## Chrome And Wallet Setup

The helper works best when Chrome is launched with remote debugging enabled, so it can connect to the same browser profile that contains your wallet extension.

On macOS:

```bash
osascript -e 'quit app "Google Chrome"'
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Then start the Dashboard:

```bash
DASHBOARD_API_PORT=3002 npm run dashboard:api
```

Keep Chrome open while tasks are running.

## Typical Workflow

1. Start Chrome with remote debugging.
2. Start the local Dashboard.
3. Open `http://127.0.0.1:3002`.
4. Review Settings and token registry.
5. Use Home for one task, or Integrated Task for a sequence.
6. Confirm the auto-click option is enabled if full automation is expected.
7. Start the task.
8. Enter the wallet extension password manually if needed.
9. Monitor embedded logs and task status.
10. Review History after completion.

## Reports

Reports are written locally under:

```text
reports/
```

The main CSV format is:

```text
airdrop_session_summary_YYYY-MM-DD.csv
```

Integrated task history is stored locally as JSON.

These runtime files should not be committed to a public repository.

## Safety Notes

- Review all local configuration before running production tasks.
- Keep wallet credentials outside this project.
- Do not commit local config, reports, screenshots, browser profiles, logs, or private infrastructure details.
- Use a private repository if the project contains operational logic that should not be public.
- Test with small recipient counts before running large integrated queues.

## Useful Commands

```bash
npm run dashboard:api
npm run dashboard:build
npm run typecheck
npm run start
```

`npm run start` keeps the older CLI workflow available for troubleshooting, but the Dashboard is the main workflow.
