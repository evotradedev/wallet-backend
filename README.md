# EvoTrade Backend

Backend service for EvoTrade - CoinStore API integration for token exchanges.

## Features

- Swap execution
- RESTful API endpoints

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Update `.env` with your CoinStore API credentials:
```env
COINSTORE_API_URL=https://api.coinstore.com
COINSTORE_API_KEY=your_api_key_here
COINSTORE_API_SECRET=your_api_secret_here
WITHDRAW_ADDRESS=your_withdraw-address_here
```

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The server will start on `http://localhost:3000` (or the PORT specified in `.env`).

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Exchange

#### Execute Swap
- `POST /api/exchange/swap`
  - Body: `{ fromToken, toToken, amount, recipient, chainId, ...additionalParams }`
  - Returns: Transaction data

## Project Structure

```
evotrade-backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic & external API integration
│   ├── routes/          # Route definitions
│   ├── middleware/      # Express middleware
│   ├── utils/           # Utility functions
│   └── app.js          # Application entry point
├── .env.example         # Environment variables template
└── package.json         # Dependencies and scripts
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `COINSTORE_API_URL` - CoinStore API base URL
- `COINSTORE_API_KEY` - CoinStore API key
- `COINSTORE_API_SECRET` - CoinStore API secret
- `LOG_LEVEL` - Logging level (error/warn/info/debug)

## License

GPL-3.0
