# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PBS Optimizer is a Delta Airlines Preferential Bidding System (PBS) optimization application that helps pilots analyze and bid on flight pairings. The app parses PDF bid packages, calculates hold probabilities based on seniority, and provides interactive filtering and analysis tools.

## Development Commands

### Initial Setup
```bash
npm install              # Install dependencies
npm run build            # Build both frontend and backend
```

### Environment Setup
Create a `.env` file with:
```
DATABASE_URL=postgresql://... # Neon PostgreSQL connection string
OPENAI_API_KEY=sk-...        # OpenAI API key for chat features
OPENAI_ASSISTANT_ID=asst_... # OpenAI Assistant ID
PORT=5000                     # Server port (default: 5000)
NODE_ENV=development          # development or production
```

### Development
```bash
npm run dev              # Run development server with hot reload (uses tsx)
npm start                # Run production server (requires build first)
PORT=5000 npm start      # Override port via environment variable
```

### Database
```bash
npm run db:push          # Push schema changes to database (uses drizzle-kit)
```

### Code Quality
```bash
npm run check            # TypeScript type checking
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint errors automatically
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without changes
```

## Architecture

### Monorepo Structure
- **client/**: React frontend (Vite + TypeScript)
- **server/**: Express backend (Node.js + TypeScript)
- **shared/**: Shared TypeScript types and database schema (Drizzle ORM)

### Key Architectural Patterns

**Database Layer** (`server/storage.ts`, `server/db.ts`, `shared/schema.ts`):
- Drizzle ORM with PostgreSQL (Neon serverless)
- Storage interface pattern abstracts all database operations
- Schema defined in `shared/schema.ts` with automatic type inference
- Tables: `users`, `bidPackages`, `pairings`, `bidHistory`, `userFavorites`, `chatHistory`, `userCalendarEvents`

**API Routes** (`server/routes.ts`):
- RESTful API endpoints under `/api/*`
- WebSocket support for real-time progress updates during PDF parsing
- PDF upload and parsing handled via multer middleware
- Hold probability recalculation triggered after pairing operations

**PDF Processing** (`server/pdfParser.ts`, `server/openaiAssistant.ts`):
- Parses Delta Airlines PBS PDF bid packages
- Extracts pairing data (flight segments, credit hours, layovers, etc.)
- Uses OpenAI Assistant API for intelligent text extraction
- Progress tracking via WebSocket connections

**Hold Probability Calculation** (`server/holdProbabilityCalculator.ts`):
- Calculates likelihood of getting a pairing based on:
  - Seniority percentile
  - Desirability score (credit hours, TAFB, layovers, etc.)
  - Pairing frequency
  - Weekend factors
  - Deadhead count
- Optimized batch recalculation when user seniority changes

**Frontend State Management**:
- React Query (`@tanstack/react-query`) for server state
- Component-local state with React hooks
- Wouter for client-side routing

**Offline Capabilities**:
- PWA architecture with service worker support
- Offline banner notification
- React Query caching for data availability

### Path Aliases
```typescript
@/*        -> client/src/*
@shared/*  -> shared/*
@assets/*  -> attached_assets/*
```

### Build Process
1. **Frontend**: Vite bundles React app → `dist/public/`
2. **Backend**: esbuild bundles server → `dist/index.js`
3. **Production**: Express serves static frontend from `dist/public/` and API routes

### Logging Configuration
Control verbosity via environment variables:
```bash
LOG_LEVEL=debug          # error, warn, info, debug (default: info)
LOG_HTTP=0               # Disable HTTP request logging (default: enabled)
LOG_HOLD_DEBUG=1         # Enable hold probability calculation debugging
```

## Development Workflow

### User Preferences
- Implement automatic background data prefetching instead of requiring explicit UI actions
- Apply one fix at a time in priority order when addressing issues
- Number tasks with position and total count format: "(2 of x)"

### Code Review Approach
- Always review entire files before making suggestions
- Prefer thorough review over quick fixes

## Data Model Key Concepts

**Pairing**: A sequence of flights that a pilot flies over multiple days
- Identified by `pairingNumber` and `effectiveDates`
- Contains `flightSegments` (array of individual flights)
- Has `layovers` (array of overnight stays)
- `pairingDays` calculated from flight segment day letters

**Bid Package**: Monthly collection of available pairings
- Associated with specific `base`, `aircraft`, `month`, and `year`
- Processing status: `processing`, `completed`, or `failed`

**Hold Probability**: Calculated percentage (0-100) representing likelihood of being awarded a pairing
- Recalculated when user seniority changes or pairings are modified
- Lower seniority percentile = more senior = higher hold probability for desirable pairings