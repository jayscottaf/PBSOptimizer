# Delta PBS Bid Optimization App

## Overview

The Delta PBS Bid Optimization App is a full-stack web application designed for Delta pilots to parse monthly bid packages, store pairing data, track historical bid awards, and predict hold likelihood. The application processes PDF bid packages, extracts detailed pairing information, and provides analytics to help pilots make informed bidding decisions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Framework**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Design System**: Component-based architecture with reusable UI components

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Structure**: RESTful API with structured route handlers
- **File Processing**: Multer for PDF file uploads with validation
- **Development Tools**: tsx for TypeScript execution in development

### Data Storage Solutions
- **Database**: PostgreSQL with Neon serverless database
- **ORM**: Drizzle ORM for type-safe database operations
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Connection**: Neon serverless connection pooling with WebSocket support

## Key Components

### Database Schema
The application uses a well-structured PostgreSQL schema with the following main entities:

1. **Users Table**: Stores pilot information including seniority number, base, and aircraft type
2. **Bid Packages Table**: Contains monthly bid package metadata with processing status
3. **Pairings Table**: Detailed pairing information including:
   - Flight segments and layover details stored as JSONB
   - Financial data (credit hours, block hours, pay)
   - Full text blocks preserving original PDF content
   - Hold probability predictions
4. **Bid History Table**: Historical award data linking pairings to seniority numbers
5. **User Favorites Table**: Allows pilots to save preferred pairings

### PDF Processing System
- **Upload Handling**: Secure PDF file uploads with type validation
- **Text Extraction**: Preserves complete pairing text blocks for detailed analysis
- **Structured Parsing**: Extracts specific fields into searchable database columns
- **Status Tracking**: Processing status monitoring (processing, completed, failed)

### Search and Filter System
- **Advanced Filtering**: Multi-criteria search including credit hours, block time, TAFB
- **Real-time Updates**: Live search results with debounced queries
- **Hold Probability**: Integrated probability scoring for bid success prediction

### Analytics Dashboard
- **Seniority Trends**: Visual representation of historical award patterns
- **Statistics Panel**: Quick stats for total pairings, hold likelihood, and preferences
- **Interactive Tables**: Sortable, filterable pairing displays with detailed views

## Data Flow

1. **PDF Upload**: Pilots upload monthly bid packages through the file upload component
2. **Processing Pipeline**: Server extracts text, parses structured data, and stores in database
3. **Search Interface**: Real-time filtering and search across pairing data
4. **Detail Views**: Modal dialogs showing complete pairing information and history
5. **Analytics**: Historical data analysis for seniority trends and hold predictions

## External Dependencies

### Frontend Dependencies
- **Radix UI**: Comprehensive set of accessible UI primitives
- **Lucide React**: Icon library for consistent iconography
- **React Hook Form**: Form state management with validation
- **Date-fns**: Date manipulation and formatting utilities
- **Class Variance Authority**: Utility for managing component variants

### Backend Dependencies
- **Drizzle ORM**: Type-safe database operations and migrations
- **Zod**: Runtime type validation for API inputs
- **Multer**: File upload handling middleware
- **Connect-pg-simple**: PostgreSQL session store

### Database and Infrastructure
- **Neon Database**: Serverless PostgreSQL with automatic scaling
- **WebSocket Support**: Real-time connection capabilities
- **Environment Configuration**: Secure credential management

## Deployment Strategy

### Development Environment
- **Hot Reloading**: Vite development server with fast refresh
- **Type Checking**: Continuous TypeScript compilation
- **Database Migrations**: Drizzle Kit for schema updates
- **Error Handling**: Runtime error overlay for debugging

### Production Build
- **Frontend**: Vite production build with optimized assets
- **Backend**: ESBuild bundling for Node.js deployment
- **Database**: Push migrations to production PostgreSQL
- **Asset Serving**: Static file serving through Express

### Configuration Management
- **Environment Variables**: DATABASE_URL and other sensitive configuration
- **Path Aliases**: TypeScript path mapping for clean imports
- **Build Optimization**: Tree shaking and code splitting for performance

The application follows a monorepo structure with shared TypeScript types between frontend and backend, ensuring type safety across the entire stack. The architecture prioritizes developer experience with hot reloading, comprehensive error handling, and a modern TypeScript-first approach.