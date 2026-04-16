# Bybit Bearish Divergence Scanner — 24/7 Bot

Runs every 30 minutes via GitHub Actions. Sends phone notifications via ntfy.sh when fresh strong bearish RSI divergence signals are detected.

## Setup (5 minutes)

### 1. Create the GitHub repo
- Go to github.com → New repository
- Name it anything, e.g. `divergence-bot`
- Set it to **Public** (free unlimited minutes)
- Upload these two files:
  - `scanner.js` → root of repo
  - `.github/workflows/scan.yml` → exactly that path

### 2. Set your ntfy topic (secret)
- In your repo → Settings → Secrets and variables → Actions
- Under **Secrets** → New repository secret
  - Name: `NTFY_TOPIC`
  - Value: `your-private-topic-name` (e.g. `sudara-bear-signals-2025`)

### 3. Set up phone notifications
- Install the **ntfy** app (Android / iOS, free)
- Open app → Subscribe → enter your topic name
- Done — you'll get push notifications

### 4. Enable the workflow
- Go to your repo → Actions tab
- If prompted, click "I understand my workflows, go ahead and enable them"
- Click "Bearish Divergence Scanner" → "Run workflow" to test it manually

## Configuration (optional)

In repo Settings → Secrets and variables → Actions → **Variables** tab:

| Variable | Default | Description |
|---|---|---|
| TIMEFRAME | 60 | Candle timeframe in minutes (15, 60, 240, D) |
| LB_LEFT | 5 | RSI pivot lookback left (matches TradingView default) |
| LB_RIGHT | 5 | RSI pivot lookback right |
| RANGE_LOWER | 5 | Min bars between pivots |
| RANGE_UPPER | 60 | Max bars between pivots |
| MIN_RSI_DROP | 2 | Minimum RSI drop to qualify |
| MAX_BARS_AGO | 2 | Only signals formed in last N bars |
| MIN_STRENGTH | 8 | Only notify if RSI drop >= this value |

## How it works

- Runs every 30 minutes via GitHub's free cron scheduler
- Fetches all Bybit USDT perpetual futures (~300+ symbols)
- Detects bearish RSI divergence using same logic as the TradingView indicator
- Only notifies for signals where SH2 formed in the last 1-2 bars (MAX_BARS_AGO=2)
- Sends ntfy.sh push notification with TradingView chart link

## Notification example

```
Bear Div: GRASS/USDT (1H)
RSI drop: -13.9 (68.6 → 54.7)
Price rise: +9.67%
SH1: 04/13 13:30 LKT
SH2: 04/15 19:00 LKT
Bars ago: 1
https://www.tradingview.com/chart/?symbol=BYBIT:GRASSUSDT.P
```
