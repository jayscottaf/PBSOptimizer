# PWA Offline Testing Guide

## 🧪 **Stage 7: Comprehensive Test Matrix**

This guide provides systematic testing procedures to ensure your PBS Optimizer PWA works reliably across all network conditions.

---

## **Quick Test Commands**

### **Development Console Utilities**
```javascript
// Run comprehensive test suite
window.offlineTests.runAll()

// Simulate network conditions
window.offlineTests.simulateOffline()
window.offlineTests.simulateOnline()

// Check cache status
window.offlineTests.cacheInfo()

// Debug cache contents
window.debugCache.inspect()
window.debugCache.info()
```

---

## **Manual Testing Scenarios**

### **1. Network Connectivity Tests**

#### **Test 1A: Online → Offline Transition**
1. **Setup**: Ensure app is loaded with data cached
2. **Action**: Open DevTools → Network tab → Set "No throttling" to "Offline"
3. **Expected**: 
   - Network status indicator appears (top-right)
   - "Working Offline" alert shows
   - Cached pairings remain accessible
   - Sorting/filtering works locally

#### **Test 1B: Offline → Online Transition**
1. **Setup**: Start with offline mode
2. **Action**: Restore network connection
3. **Expected**:
   - "Back Online" notification appears
   - Network indicator updates
   - Fresh data syncs automatically

#### **Test 1C: Slow Connection**
1. **Setup**: DevTools → Network → "Slow 3G"
2. **Action**: Navigate and interact with app
3. **Expected**:
   - "Slow Connection Detected" warning
   - App prioritizes cached data
   - Performance remains smooth

### **2. Cache Functionality Tests**

#### **Test 2A: Initial Cache Population**
1. **Action**: Fresh browser session → load app
2. **Expected**:
   - "Preparing offline cache..." appears
   - Changes to "Available offline: Yes"
   - Console shows cache prefetch logs

#### **Test 2B: Cache Persistence**
1. **Action**: Close browser → reopen app
2. **Expected**:
   - Instant "Available offline: Yes" 
   - Data loads immediately from cache
   - No server requests for cached data

#### **Test 2C: User-Specific Cache Isolation**
1. **Action**: Change seniority number (Profile → edit)
2. **Expected**:
   - New cache namespace created
   - Previous user's cache remains separate
   - Fresh cache for new user starts building

### **3. Feature Degradation Tests**

#### **Test 3A: Offline Feature Matrix**
| Feature | Online | Offline | Notes |
|---------|--------|---------|-------|
| View Pairings | ✅ | ✅ | From cache |
| Sort/Filter | ✅ | ✅ | Local processing |
| Calendar View | ✅ | ✅ | Cached data |
| Statistics | ✅ | ✅ | Cached stats |
| AI Assistant | ✅ | ❌ | Requires internet |
| Upload Bid Package | ✅ | ❌ | Server required |
| Profile Updates | ✅ | ⚠️ | Local storage only |

#### **Test 3B: AI Assistant Offline Behavior**
1. **Setup**: Go offline
2. **Action**: Try to open AI chat
3. **Expected**: 
   - Clear "Requires internet" message
   - Graceful fallback or disabled state

#### **Test 3C: Upload Offline Behavior**
1. **Setup**: Go offline  
2. **Action**: Try to upload new bid package
3. **Expected**:
   - Clear error message about network requirement
   - Suggestion to try again when online

### **4. Data Integrity Tests**

#### **Test 4A: Sort Consistency**
1. **Setup**: Online with 500+ pairings
2. **Action**: Sort by Credit → go offline → sort by Block
3. **Expected**: Same results online and offline

#### **Test 4B: Filter Accuracy**
1. **Setup**: Apply complex filters online
2. **Action**: Go offline → modify filters
3. **Expected**: Accurate local filtering on full dataset

#### **Test 4C: Pagination Correctness**
1. **Setup**: Cached full dataset
2. **Action**: Navigate through pages offline
3. **Expected**: Correct page counts and data consistency

---

## **Automated Test Suite**

### **Running Automated Tests**
```javascript
// Complete test suite
const results = await window.offlineTests.runAll();

// Results show:
// ✅ Cache Tests (3/3 passed)
// ✅ Network Tests (3/3 passed)  
// ✅ UI Tests (3/3 passed)
// ✅ Data Integrity Tests (3/3 passed)
```

### **Test Categories**

#### **Cache Tests**
- ✅ Cache info accessibility
- ✅ Cache key generation consistency
- ✅ IndexedDB functionality

#### **Network Tests**
- ✅ Health check endpoint
- ✅ Network status detection
- ✅ Retry mechanism logic

#### **UI Tests**
- ✅ Service Worker registration
- ✅ PWA manifest accessibility
- ✅ Critical DOM elements present

#### **Data Integrity Tests**
- ✅ Local storage accessibility
- ✅ Query client state
- ✅ Critical app state preservation

---

## **Platform-Specific Testing**

### **Desktop Browsers**
- **Chrome**: Full PWA support, install prompts
- **Firefox**: Core functionality, limited install
- **Safari**: WebKit limitations, test carefully
- **Edge**: Chrome-like behavior

### **Mobile Devices**
- **iOS Safari**: Test add to home screen
- **Android Chrome**: Full PWA install experience
- **Mobile Firefox**: Core functionality verification

### **Network Conditions**
- **Offline**: Complete disconnection
- **Slow 3G**: 400Kbps, 400ms latency
- **Fast 3G**: 1.5Mbps, 150ms latency  
- **4G**: 4Mbps, 20ms latency
- **Intermittent**: Connection drops and recovers

---

## **Performance Benchmarks**

### **Target Metrics**
- **Initial Load**: < 3 seconds
- **Cache Hit**: < 100ms response
- **Offline Sort**: < 500ms for 1000 items
- **Network Recovery**: < 2 seconds to sync

### **Monitoring Commands**
```javascript
// Performance timing
performance.getEntriesByType('navigation')[0]

// Cache size estimation
window.debugCache.info().then(info => 
  console.log(`Cache: ${info.totalEntries} entries`)
)

// Network timing
navigator.connection?.downlink + 'Mbps'
```

---

## **Troubleshooting**

### **Common Issues**

#### **Cache Not Working**
```javascript
// Check IndexedDB
window.debugCache.info()

// Clear and rebuild
window.debugCache.clear()
// Reload page, should rebuild cache
```

#### **Network Status Stuck**
```javascript
// Force network event
window.offlineTests.simulateOnline()
window.offlineTests.simulateOffline()
```

#### **Service Worker Issues**
```javascript
// Check registration
navigator.serviceWorker.getRegistration()

// Force update
navigator.serviceWorker.getRegistration()
  .then(reg => reg?.update())
```

### **Reset Procedures**

#### **Full Reset (Nuclear Option)**
```javascript
// Clear everything
window.debugCache.clear()
localStorage.clear()
sessionStorage.clear()

// Unregister SW
navigator.serviceWorker.getRegistrations()
  .then(regs => regs.forEach(reg => reg.unregister()))

// Reload
window.location.reload()
```

---

## **Success Criteria**

### **✅ Stage 7 Complete When:**
1. **All automated tests pass** (`window.offlineTests.runAll()`)
2. **Manual scenarios work** (offline transitions, feature degradation)
3. **Cross-platform verified** (desktop + mobile)
4. **Performance meets targets** (< 3s load, < 100ms cache hits)
5. **User experience smooth** (clear feedback, graceful failures)

### **🎉 PWA Conversion Complete!**
Your PBS Optimizer is now a professional-grade Progressive Web App with robust offline capabilities, ready for multi-user deployment.

---

## **Next Steps (Post-PWA)**
- 📊 Analytics integration
- 🔐 Multi-user authentication
- 🏗️ Production deployment optimization
- 📱 App store submission (optional)
