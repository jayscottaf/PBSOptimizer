# Delta PBS Bid Optimization App

## Overview

The Delta PBS Bid Optimization App is a full-stack web application for Delta pilots. Its primary purpose is to parse monthly bid packages, store detailed pairing data, track historical bid awards, and predict the likelihood of a bid being awarded. This application aims to provide pilots with actionable analytics to inform their bidding decisions and optimize their monthly schedules.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

- **Framework**: React with TypeScript (Vite)
- **UI/Styling**: Shadcn/ui (Radix UI primitives) and Tailwind CSS with CSS variables
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter
- **Design System**: Component-based architecture

### Backend Architecture

- **Runtime**: Node.js with Express.js (TypeScript, ES modules)
- **API**: RESTful API
- **File Processing**: Multer for PDF uploads
- **Development Tools**: tsx

### Data Storage Solutions

- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM for type-safe operations
- **Schema Management**: Drizzle Kit

### Key Features and Specifications

- **Database Schema**: Includes Users, Bid Packages, Pairings (with JSONB for segments, financial data, and full text), Bid History, and User Favorites tables.
- **PDF Processing**: Handles secure uploads, extracts text, and parses structured data from Delta bid packages (e.g., NYC A220 format, multi-day pairings, time-based pay hours). Tracks processing status.
- **Search and Filter**: Advanced multi-criteria search with real-time updates and integrated hold probability scoring.
- **Analytics Dashboard**: Visualizes seniority trends, provides quick statistics, and offers interactive pairing displays.
- **Hold Probability System**: Predicts bid success likelihood, incorporating location desirability and seasonal adjustments.
- **AI Assistant Integration**: Processes queries for pairing data, efficiency analysis, and high-credit pairings, with robust error handling and token optimization.

## External Dependencies

- **Database**: Neon Database (PostgreSQL)
- **Frontend Libraries**: Radix UI, Lucide React, React Hook Form, Date-fns, Class Variance Authority
- **Backend Libraries**: Drizzle ORM, Zod, Multer, Connect-pg-simple
- **AI Services**: OpenAI (for AI assistant functionality)
- **Utilities**: `fast-safe-stringify`, `tiktoken`