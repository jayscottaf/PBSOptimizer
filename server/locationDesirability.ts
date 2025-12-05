type ClimateType = 'tropical' | 'warm' | 'mild' | 'cold' | 'hot_dry';

interface CityData {
  baseDesirability: number; // 0-100
  climate: ClimateType;
  isInternational: boolean;
  isBeach: boolean;
  isMajorHub: boolean;
}

type Season = 'winter' | 'spring' | 'summer' | 'fall';

const CITY_DATABASE: Record<string, CityData> = {
  // Tropical/Beach destinations - High base desirability
  'MIA': { baseDesirability: 90, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: true },
  'FLL': { baseDesirability: 85, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'TPA': { baseDesirability: 80, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'MCO': { baseDesirability: 75, climate: 'tropical', isInternational: false, isBeach: false, isMajorHub: true },
  'RSW': { baseDesirability: 80, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'PBI': { baseDesirability: 85, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'SJU': { baseDesirability: 95, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'HNL': { baseDesirability: 98, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: true },
  'OGG': { baseDesirability: 95, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'LIH': { baseDesirability: 92, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  'KOA': { baseDesirability: 90, climate: 'tropical', isInternational: false, isBeach: true, isMajorHub: false },
  
  // International destinations - Very high desirability
  'CUN': { baseDesirability: 92, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'SXM': { baseDesirability: 90, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'NAS': { baseDesirability: 88, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'AUA': { baseDesirability: 88, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'MBJ': { baseDesirability: 85, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'PUJ': { baseDesirability: 85, climate: 'tropical', isInternational: true, isBeach: true, isMajorHub: false },
  'LHR': { baseDesirability: 90, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'CDG': { baseDesirability: 92, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'FCO': { baseDesirability: 90, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'BCN': { baseDesirability: 88, climate: 'mild', isInternational: true, isBeach: true, isMajorHub: false },
  'AMS': { baseDesirability: 85, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'NRT': { baseDesirability: 80, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'HND': { baseDesirability: 82, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  'ICN': { baseDesirability: 75, climate: 'mild', isInternational: true, isBeach: false, isMajorHub: true },
  
  // California/West Coast - High desirability, mild climate
  'LAX': { baseDesirability: 85, climate: 'mild', isInternational: false, isBeach: true, isMajorHub: true },
  'SAN': { baseDesirability: 88, climate: 'mild', isInternational: false, isBeach: true, isMajorHub: false },
  'SFO': { baseDesirability: 82, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: true },
  'OAK': { baseDesirability: 65, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: false },
  'SJC': { baseDesirability: 68, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: false },
  'SNA': { baseDesirability: 78, climate: 'mild', isInternational: false, isBeach: true, isMajorHub: false },
  'BUR': { baseDesirability: 65, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: false },
  'SMF': { baseDesirability: 55, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: false },
  'PSP': { baseDesirability: 70, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: false },
  'SBA': { baseDesirability: 80, climate: 'mild', isInternational: false, isBeach: true, isMajorHub: false },
  
  // Pacific Northwest - Mild/cool, moderate desirability
  'SEA': { baseDesirability: 70, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: true },
  'PDX': { baseDesirability: 68, climate: 'mild', isInternational: false, isBeach: false, isMajorHub: false },
  
  // Mountain West - Variable desirability
  'DEN': { baseDesirability: 65, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'SLC': { baseDesirability: 60, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'PHX': { baseDesirability: 70, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: true },
  'TUS': { baseDesirability: 55, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: false },
  'ABQ': { baseDesirability: 50, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: false },
  'LAS': { baseDesirability: 78, climate: 'hot_dry', isInternational: false, isBeach: false, isMajorHub: true },
  'RNO': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'BOI': { baseDesirability: 50, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'IDA': { baseDesirability: 40, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'JAC': { baseDesirability: 65, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'ASE': { baseDesirability: 75, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'EGE': { baseDesirability: 70, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  
  // Texas - Warm climate, variable desirability
  'DFW': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: true },
  'IAH': { baseDesirability: 50, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: true },
  'HOU': { baseDesirability: 48, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'AUS': { baseDesirability: 70, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'SAT': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  
  // Northeast - Cold climate, variable desirability
  'JFK': { baseDesirability: 70, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'LGA': { baseDesirability: 65, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'EWR': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'BOS': { baseDesirability: 72, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'PHL': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'DCA': { baseDesirability: 65, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'IAD': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'BWI': { baseDesirability: 52, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'PIT': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'BDL': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'PVD': { baseDesirability: 48, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'SYR': { baseDesirability: 40, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'BUF': { baseDesirability: 40, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'ROC': { baseDesirability: 42, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'ALB': { baseDesirability: 42, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  
  // Midwest - Cold climate, generally lower desirability
  'ORD': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'MDW': { baseDesirability: 50, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'DTW': { baseDesirability: 50, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'MSP': { baseDesirability: 48, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: true },
  'STL': { baseDesirability: 48, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'MKE': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'IND': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'CLE': { baseDesirability: 42, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'CMH': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'CVG': { baseDesirability: 48, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'DSM': { baseDesirability: 38, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'OMA': { baseDesirability: 40, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'MCI': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'FAR': { baseDesirability: 30, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'GFK': { baseDesirability: 28, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  
  // Southeast - Warm climate, moderate desirability
  'ATL': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: true },
  'CLT': { baseDesirability: 52, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: true },
  'RDU': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'GSO': { baseDesirability: 45, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'BNA': { baseDesirability: 65, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'MEM': { baseDesirability: 42, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'MSY': { baseDesirability: 75, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'JAX': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  'SAV': { baseDesirability: 68, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  'CHS': { baseDesirability: 72, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  'RIC': { baseDesirability: 48, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'ORF': { baseDesirability: 48, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  'BHM': { baseDesirability: 42, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'HSV': { baseDesirability: 40, climate: 'warm', isInternational: false, isBeach: false, isMajorHub: false },
  'PNS': { baseDesirability: 55, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  'VPS': { baseDesirability: 60, climate: 'warm', isInternational: false, isBeach: true, isMajorHub: false },
  
  // Alaska - Cold, niche appeal
  'ANC': { baseDesirability: 55, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
  'FAI': { baseDesirability: 45, climate: 'cold', isInternational: false, isBeach: false, isMajorHub: false },
};

function getMonthFromBidPackage(month: string): number {
  const monthMap: Record<string, number> = {
    'january': 1, 'jan': 1, '01': 1, '1': 1,
    'february': 2, 'feb': 2, '02': 2, '2': 2,
    'march': 3, 'mar': 3, '03': 3, '3': 3,
    'april': 4, 'apr': 4, '04': 4, '4': 4,
    'may': 5, '05': 5, '5': 5,
    'june': 6, 'jun': 6, '06': 6, '6': 6,
    'july': 7, 'jul': 7, '07': 7, '7': 7,
    'august': 8, 'aug': 8, '08': 8, '8': 8,
    'september': 9, 'sep': 9, 'sept': 9, '09': 9, '9': 9,
    'october': 10, 'oct': 10, '10': 10,
    'november': 11, 'nov': 11, '11': 11,
    'december': 12, 'dec': 12, '12': 12,
  };
  
  const normalized = month.toLowerCase().trim();
  
  for (const [key, value] of Object.entries(monthMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  
  return new Date().getMonth() + 1;
}

function getSeason(monthNumber: number): Season {
  if (monthNumber >= 11 || monthNumber <= 3) return 'winter';
  if (monthNumber >= 4 && monthNumber <= 5) return 'spring';
  if (monthNumber >= 6 && monthNumber <= 8) return 'summer';
  return 'fall';
}

function getSeasonalModifier(climate: ClimateType, season: Season): number {
  const modifiers: Record<ClimateType, Record<Season, number>> = {
    'tropical': {
      winter: 20,   // Very desirable in winter
      spring: 10,   // Still desirable
      summer: 5,    // Less appeal (hurricane season, hot)
      fall: 15,     // Good shoulder season
    },
    'warm': {
      winter: 15,   // Escape the cold
      spring: 5,
      summer: -5,   // Can be too hot
      fall: 5,
    },
    'mild': {
      winter: 5,    // Pleasant year-round
      spring: 10,   // Nice weather
      summer: 10,   // Comfortable temps
      fall: 10,     // Beautiful fall
    },
    'cold': {
      winter: -15,  // Unpleasant, less desirable
      spring: 0,
      summer: 10,   // Nice escape from heat
      fall: 5,      // Fall colors
    },
    'hot_dry': {
      winter: 15,   // Pleasant in winter
      spring: 5,
      summer: -20,  // Extremely hot, avoid
      fall: 5,
    },
  };
  
  return modifiers[climate]?.[season] ?? 0;
}

export function getCityData(cityCode: string): CityData | null {
  const normalized = cityCode.toUpperCase().trim();
  return CITY_DATABASE[normalized] || null;
}

export function calculateLayoverDesirability(
  layoverCities: string[],
  bidMonth: string
): { score: number; reasoning: string[] } {
  const reasoning: string[] = [];
  
  if (!layoverCities || layoverCities.length === 0) {
    return { score: 50, reasoning: ['No layover data available'] };
  }
  
  const monthNumber = getMonthFromBidPackage(bidMonth);
  const season = getSeason(monthNumber);
  
  let totalScore = 0;
  let knownCities = 0;
  
  for (const city of layoverCities) {
    const cityData = getCityData(city);
    
    if (cityData) {
      const seasonalMod = getSeasonalModifier(cityData.climate, season);
      const cityScore = cityData.baseDesirability + seasonalMod;
      
      let cityReasoning = `${city}: base ${cityData.baseDesirability}`;
      
      if (seasonalMod !== 0) {
        const modSign = seasonalMod > 0 ? '+' : '';
        cityReasoning += ` (${season} ${modSign}${seasonalMod})`;
      }
      
      if (cityData.isInternational) {
        cityReasoning += ' [International]';
      }
      if (cityData.isBeach) {
        cityReasoning += ' [Beach]';
      }
      
      reasoning.push(cityReasoning);
      totalScore += cityScore;
      knownCities++;
    } else {
      reasoning.push(`${city}: unknown city (default 50)`);
      totalScore += 50;
      knownCities++;
    }
  }
  
  const averageScore = knownCities > 0 ? totalScore / knownCities : 50;
  
  const clampedScore = Math.max(0, Math.min(100, averageScore));
  
  reasoning.unshift(`Season: ${season} (month ${monthNumber})`);
  
  return {
    score: Math.round(clampedScore),
    reasoning,
  };
}

export function getLocationCompetitionAdjustment(
  layoverCities: string[],
  bidMonth: string
): number {
  const { score } = calculateLayoverDesirability(layoverCities, bidMonth);
  
  if (score >= 85) return -20;  // Very desirable = more competition = lower hold chance
  if (score >= 75) return -12;
  if (score >= 65) return -5;
  if (score >= 50) return 0;    // Average desirability = no adjustment
  if (score >= 40) return 5;
  if (score >= 30) return 10;
  return 15;                     // Undesirable = less competition = higher hold chance
}

export function isHolidayPeriod(monthNumber: number): boolean {
  return monthNumber === 11 || monthNumber === 12 || monthNumber === 1;
}

export function getHolidayCompetitionPenalty(monthNumber: number): number {
  if (monthNumber === 12) return -10; // December is most competitive
  if (monthNumber === 11) return -5;  // Thanksgiving
  if (monthNumber === 1) return -3;   // New Year period
  return 0;
}

export { getSeason, getMonthFromBidPackage, Season, ClimateType, CityData };
