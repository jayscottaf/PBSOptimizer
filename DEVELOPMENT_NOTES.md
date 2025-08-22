# PBS Optimizer - Development Notes

## Future Enhancements & Ideas

### Mobile UI Improvements
- [ ] Consider adding swipe gestures for tab navigation
- [ ] Implement pull-to-refresh on mobile
- [ ] Add haptic feedback for mobile interactions

### Feature Requests
- [ ] Export pairing data to CSV/Excel
- [ ] Advanced filtering by aircraft type
- [ ] Bid strategy recommendations based on historical data
- [ ] Integration with airline scheduling systems

### Performance Optimizations
- [ ] Implement virtual scrolling for large pairing lists
- [ ] Add background sync for offline data updates
- [ ] Optimize bundle size for faster mobile loading

### User Experience
- [ ] Add onboarding tutorial for new users
- [ ] Implement dark mode toggle
- [ ] Add keyboard shortcuts for power users
- [ ] Create dashboard customization options

### Technical Debt
- [ ] Migrate to React 19 when stable
- [ ] Implement proper error boundaries
- [ ] Add comprehensive unit tests
- [ ] Set up automated deployment pipeline

### Bug Fixes & Improvements
- [ ] Improve error handling for network failures
- [ ] Add loading states for better UX
- [ ] Optimize database queries for better performance

---

## Completed Features
- [x] Profile data persistence (seniority number & category percentage)
- [x] Mobile AI Assistant with compact layout
- [x] Calendar icon inline with favorites for cleaner mobile UI
- [x] Smart filters fix for dropdown accessibility
- [x] PWA implementation with offline capabilities
- [x] Full dataset caching and offline statistics
- [x] Mobile favicon and comprehensive icon support

## Architecture Notes

### Current Stack
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + Drizzle ORM
- **Database**: PostgreSQL (Neon serverless)
- **Deployment**: Vercel (frontend) + Replit (backend)
- **PWA**: Service Worker + IndexedDB for offline support

### Key Design Decisions
- Hybrid PWA approach for offline-first experience
- Component-based architecture with shadcn/ui
- React Query for server state management
- localStorage for user preferences persistence
- IndexedDB for large dataset caching

---

*Last updated: $(date)*
