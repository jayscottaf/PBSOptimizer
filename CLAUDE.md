# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start development server with hot reload (uses tsx for TypeScript execution)
- `npm run build` - Build client and server for production (Vite + esbuild bundling)
- `npm start` - Run production server (requires build first)
- `npm run check` - TypeScript type checking
- `npm run db:push` - Push database schema changes using Drizzle Kit

### Database
- Uses PostgreSQL with Neon serverless connection
- Drizzle ORM for schema and queries  
- Migration files in `/migrations/`
- Schema defined in `/shared/schema.ts`

## Architecture

### Monorepo Structure
- **`/client/`** - React frontend (Vite + TypeScript)
- **`/server/`** - Express.js backend (TypeScript)  
- **`/shared/`** - Common types and schemas
- **`/uploads/`** - PDF file storage (hashed filenames)

### Client Architecture
- **Framework**: React 18 with Vite build system
- **Routing**: Wouter for client-side routing
- **Styling**: Tailwind CSS with shadcn/ui components
- **State**: React Query for server state, local component state
- **Components**: Located in `/client/src/components/`
  - UI components in `/components/ui/` (shadcn/ui)
  - Feature components directly in `/components/`

### Server Architecture  
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL via Drizzle ORM with Neon serverless
- **File Upload**: Multer with hash-based storage in `/uploads/`
- **PDF Processing**: Custom PDF parser using pdf-parse and pdf2pic
- **AI Integration**: OpenAI API for chat functionality
- **Authentication**: Session-based (express-session)

### Key Data Models
- **BidPackages**: Monthly airline schedule packages
- **Pairings**: Individual flight sequences with complex metadata
- **Users**: Pilot profiles with seniority data
- **ChatHistory**: AI assistant conversation storage

### Core Business Logic
- **Hold Probability Calculator** (`/server/holdProbabilityCalculator.ts`): Complex algorithm for calculating probability of getting assigned a pairing based on seniority, desirability, and historical data
- **PDF Parser** (`/server/pdfParser.ts`): Extracts flight pairing data from airline bid package PDFs
- **Smart Filtering** (`/client/src/components/smart-filter-system.tsx`): Advanced filtering system with user preferences

### Important Conventions
- **Path Aliases**: `@/` maps to `/client/src/`, `@shared/` to `/shared/`
- **Database**: All DB operations use Drizzle ORM, schema is strongly typed
- **Error Handling**: Structured error responses with proper HTTP status codes
- **Logging**: Configurable logging levels via environment variables (see README.md)

### Environment Variables
Key variables for development:
- `DATABASE_URL` - Neon PostgreSQL connection string (required)
- `LOG_LEVEL` - Controls logging verbosity (error, warn, info, debug)
- `LOG_HTTP` - Enable/disable HTTP request logging (0/1)
- `LOG_HOLD_DEBUG` - Enable hold probability calculation debugging (0/1)

### Testing & Quality
- TypeScript strict mode enabled
- No test framework currently configured
- Type checking via `npm run check`