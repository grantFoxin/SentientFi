# SentientFi

An intelligent DeFi portfolio management platform built on the Stellar blockchain. SentientFi automatically rebalances crypto portfolios using real-time price data, configurable drift thresholds, and a queue-backed automation engine.

## Overview

SentientFi helps users maintain optimal asset allocation through automated rebalancing triggered when a portfolio drifts beyond a user-defined threshold. It combines Stellar's fast, low-cost infrastructure with a professional risk management layer — including EWMA volatility, Value-at-Risk, circuit breakers, and concentration limits.

## Features

- **Smart Rebalancing** — Automatically maintains target allocations with intelligent threshold-based triggers (1–50% drift)
- **Multi-Wallet Support** — Compatible with Freighter, Rabet, xBull, and other Stellar wallets
- **Real-time Price Feeds** — CoinGecko integration with smart caching; Reflector oracle integration in progress
- **Risk Management** — Built-in circuit breakers, concentration limits (70% cap), EWMA volatility detection, and VaR/CVaR metrics
- **Queue-backed Automation** — BullMQ + Redis worker system for reliable, non-blocking portfolio monitoring
- **Notification System** — Email (SMTP) and webhook notifications for rebalance events, circuit breaker triggers, and risk changes
- **Demo Mode** — Simulated $10,000 portfolio for testing without real funds
- **Professional UI** — Responsive React interface with real-time charts, analytics, and export (CSV/JSON)

## Architecture

```
SentientFi/
├── contracts/        # Soroban smart contracts (Rust)
├── frontend/         # React + TypeScript UI (Vite)
├── backend/          # Node.js + Express API
├── deployment/       # Docker Compose + nginx config
└── docs/             # API, migration, and notification docs
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Rust + Soroban SDK |
| Frontend | React 18, TypeScript, Tailwind CSS, Recharts |
| Backend | Node.js 18, Express, TypeScript |
| Queue | BullMQ + Redis |
| Database | PostgreSQL |
| Price Data | CoinGecko API (Reflector oracle integration planned) |
| Blockchain | Stellar Testnet / Mainnet |

## Quick Start

### Prerequisites

- Node.js 18+
- Rust + Cargo
- Soroban CLI
- Redis (for queue workers)
- PostgreSQL 14+
- A Stellar wallet — Freighter or Rabet recommended

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/grantFoxin/SentientFi.git
cd SentientFi
```

**2. Install dependencies**

```bash
# Frontend
cd frontend && npm install

# Backend
cd ../backend && npm install

# Smart contracts
cd ../contracts && cargo build
```

**3. Configure environment**

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set DATABASE_URL, REDIS_URL, and ADMIN_PUBLIC_KEYS

# Frontend
cp frontend/.env.example frontend/.env
# Edit with contract address and network
```

**4. Run database migrations**

```bash
cd backend && npm run db:migrate
```

See [docs/MIGRATION.md](docs/MIGRATION.md) for migration options including `--dry-run`.

**5. Configure SMTP for email notifications (optional)**

Update `backend/.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

For Gmail, [generate an App Password](https://myaccount.google.com/apppasswords) after enabling 2FA. Other supported providers: SendGrid (`smtp.sendgrid.net:587`), Mailgun (`smtp.mailgun.org:587`), AWS SES.

**6. Start development servers**

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

**7. Open the application**

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |

## Smart Contract

The portfolio rebalancer contract is deployed on Stellar Testnet:

```
Contract Address:  CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
Reflector Oracle:  CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
```

**Deploy your own instance:**

```bash
cd contracts

# Build WASM
soroban contract build

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# Initialize
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
```

## Usage

### Creating a Portfolio

1. Connect your Stellar wallet
2. Navigate to **Create Portfolio**
3. Set target asset allocations (must sum to 100%)
4. Configure rebalance threshold (1–50%)
5. Enable or disable automatic rebalancing
6. Submit the transaction

### Dashboard

- **Overview** — Current allocations vs. targets, drift indicators
- **Analytics** — Performance chart, risk metrics (VaR, CVaR, volatility)
- **Notifications** — Configure email and webhook preferences
- **History** — Full rebalancing event log with on-chain sync

### Safety Features

| Feature | Detail |
|---------|--------|
| Cooldown Periods | Minimum 1 hour between rebalances |
| Circuit Breakers | Auto-pause during extreme volatility |
| Concentration Limits | No single asset can exceed 70% |
| Volatility Detection | EWMA-based volatility gating |

## API Reference

Base URL: `http://localhost:3001/api`

### Portfolio Management

```bash
# Create a portfolio
POST /api/portfolio
{
  "userAddress": "STELLAR_ADDRESS",
  "allocations": { "XLM": 40, "USDC": 35, "BTC": 25 },
  "threshold": 5
}

# Get portfolio
GET /api/portfolio/:id

# Execute manual rebalance
POST /api/portfolio/:id/rebalance

# Get rebalance plan (preview)
GET /api/portfolio/:id/rebalance-plan
```

### Notifications

```bash
# Subscribe
POST /api/notifications/subscribe
{
  "userId": "STELLAR_ADDRESS",
  "emailEnabled": true,
  "emailAddress": "user@example.com",
  "webhookEnabled": false,
  "webhookUrl": "",
  "events": {
    "rebalance": true,
    "circuitBreaker": true,
    "priceMovement": false,
    "riskChange": true
  }
}

# Get preferences
GET /api/notifications/preferences?userId=STELLAR_ADDRESS

# Unsubscribe
DELETE /api/notifications/unsubscribe?userId=STELLAR_ADDRESS
```

### Price Data

```bash
# Current prices
GET /api/prices

# Enhanced prices with alerts
GET /api/prices/enhanced
```

### Auto-Rebalancer (Admin)

Requires `ADMIN_PUBLIC_KEYS` to be set in `backend/.env`.

```bash
# Start auto-rebalancer
POST /api/auto-rebalancer/start

# Stop auto-rebalancer
POST /api/auto-rebalancer/stop

# Force immediate check
POST /api/auto-rebalancer/force-check

# View auto-rebalancer history
GET /api/auto-rebalancer/history
```

Full API documentation: [docs/API.md](docs/API.md)

## Configuration

### Backend (`backend/.env`)

```env
# Blockchain
CONTRACT_ADDRESS=CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
STELLAR_NETWORK=testnet

# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://portfolio_user:portfolio_pass@localhost:5432/stellar_portfolio

# Redis (queue)
REDIS_URL=redis://localhost:6379

# Admin
# Comma-separated Stellar public keys authorized for admin routes
ADMIN_PUBLIC_KEYS=YOUR_ADMIN_STELLAR_ADDRESS

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

### Frontend (`frontend/.env`)

```env
VITE_CONTRACT_ADDRESS=CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
VITE_STELLAR_NETWORK=testnet
VITE_API_URL=http://localhost:3001
```

## Development

### Project Structure

```
frontend/src/
├── components/       # React components (Dashboard, PortfolioSetup, etc.)
├── hooks/            # usePortfolio, useReflector
├── services/         # Browser price service
├── utils/            # Calculations, wallet adapters, export
└── context/          # ThemeContext

backend/src/
├── api/              # Express routes and validation
├── services/         # Business logic (rebalancing, notifications, risk)
├── queue/            # BullMQ workers and schedulers
├── monitoring/       # Portfolio monitoring
├── db/               # Database client, migrations, seed
└── middleware/       # Auth, rate limiting, idempotency, error handler

contracts/src/
├── lib.rs            # Main contract entry points
├── portfolio.rs      # Portfolio management logic
├── types.rs          # Contract data structures
├── reflector.rs      # Reflector oracle client interface
└── test.rs           # Soroban unit tests
```

### Running Tests

```bash
# Frontend unit tests
cd frontend && npm test

# Backend tests (requires running Postgres + Redis)
cd backend && npm test

# Smart contract tests
cd contracts && cargo test
```

### Docker Deployment

```bash
# Validate compose configuration
docker compose -f deployment/docker-compose.yml config

# Build images
docker compose -f deployment/docker-compose.yml build frontend backend

# Start full stack
docker compose -f deployment/docker-compose.yml up --build -d
```

Deployment files:

```
deployment/
├── docker-compose.yml
├── deploy.sh
└── nginx.conf
backend/Dockerfile
frontend/Dockerfile
frontend/nginx.conf
```

## Roadmap

### Phase 1 — Current

- ✅ Soroban smart contract deployment
- ✅ Basic portfolio management (create, rebalance, history)
- ✅ Demo mode
- ✅ Multi-wallet support (Freighter, Rabet, xBull)
- ✅ Email + webhook notifications
- ✅ Risk metrics (VaR, CVaR, EWMA volatility)
- ✅ Queue-backed auto-rebalancer

### Phase 2 — Next

- 🔄 Reflector oracle backend integration (real on-chain price feeds)
- 🔄 DEX integration for live trade execution
- 🔄 Advanced rebalancing strategies (tax-loss harvesting, threshold bands)
- 🔄 Webhook signature verification (HMAC-SHA256)
- 🔄 Portfolio analytics and backtesting

### Phase 3 — Future

- ⏳ Institutional features (multi-sig, audit logs)
- ⏳ Cross-chain portfolio support
- ⏳ Yield farming integration
- ⏳ Mobile application
- ⏳ Advanced risk modeling

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

Please ensure `npm test` and `cargo test` pass before submitting.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Stellar Development Foundation](https://stellar.org) — blockchain infrastructure
- [Reflector Protocol](https://reflector.network) — price oracle services
- [Soroban](https://soroban.stellar.org) — smart contract platform
- Open-source wallet teams — Freighter, Rabet, xBull

---

Built for the Stellar ecosystem.
