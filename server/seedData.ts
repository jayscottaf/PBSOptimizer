import { storage } from './storage';

export async function seedDatabase() {
  try {
    console.log('Starting database seeding...');

    // Create a sample bid package
    const bidPackage = await storage.createBidPackage({
      name: 'NYC A220 August 2025 Bid Package',
      month: 'August',
      year: 2025,
      base: 'NYC',
      aircraft: 'A220',
    });

    console.log('Created bid package:', bidPackage.id);

    // Create sample pairings with realistic data
    const samplePairings = [
      {
        bidPackageId: bidPackage.id,
        pairingNumber: '7666',
        effectiveDates: '01AUG-31AUG',
        route: 'JFK-BOS-JFK-DCA-JFK',
        creditHours: '5.75',
        blockHours: '4.45',
        tafb: '3d 02:15',
        fdp: '11:30',
        payHours: '5.75',
        sitEdpPay: '0.30',
        carveouts: 'None',
        deadheads: 0,
        layovers: [
          { city: 'BOS', hotel: 'Marriott Boston', duration: '10:30' },
          { city: 'DCA', hotel: 'Hyatt Arlington', duration: '12:45' },
        ],
        flightSegments: [
          {
            day: 1,
            date: '01AUG',
            flightNumber: 'DL2145',
            departure: 'JFK',
            departureTime: '06:00',
            arrival: 'BOS',
            arrivalTime: '07:25',
            blockTime: '1:25',
            turnTime: '0:45',
          },
          {
            day: 1,
            date: '01AUG',
            flightNumber: 'DL1876',
            departure: 'BOS',
            departureTime: '08:10',
            arrival: 'JFK',
            arrivalTime: '09:35',
            blockTime: '1:25',
          },
        ],
        fullTextBlock: `PAIRING: 7666    EFFECTIVE: 01AUG-31AUG
JFK-BOS-JFK-DCA-JFK
01AUG  DL2145  JFK  0600  BOS  0725  1:25  :45
       DL1876  BOS  0810  JFK  0935  1:25
       LAYOVER BOS 10:30 MARRIOTT BOSTON
02AUG  DL1234  JFK  1400  DCA  1530  1:30  :30
       DL5678  DCA  1600  JFK  1725  1:25
       
CREDIT: 5:75  BLOCK: 4:45  TAFB: 3d02:15  FDP: 11:30
PAY: 5:75  SIT/EDP: 0:30  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 85,
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: '7890',
        effectiveDates: '01AUG-31AUG',
        route: 'JFK-LAX-JFK',
        creditHours: '6.25',
        blockHours: '5.15',
        tafb: '4d 08:30',
        fdp: '13:15',
        payHours: '6.25',
        sitEdpPay: '0.50',
        carveouts: 'None',
        deadheads: 1,
        layovers: [{ city: 'LAX', hotel: 'Hilton LAX', duration: '24:30' }],
        flightSegments: [
          {
            day: 1,
            date: '05AUG',
            flightNumber: 'DL159',
            departure: 'JFK',
            departureTime: '08:00',
            arrival: 'LAX',
            arrivalTime: '11:30',
            blockTime: '6:30',
            turnTime: '24:30',
          },
          {
            day: 2,
            date: '06AUG',
            flightNumber: 'DL160',
            departure: 'LAX',
            departureTime: '12:00',
            arrival: 'JFK',
            arrivalTime: '20:30',
            blockTime: '5:30',
          },
        ],
        fullTextBlock: `PAIRING: 7890    EFFECTIVE: 01AUG-31AUG
JFK-LAX-JFK
05AUG  DL159   JFK  0800  LAX  1130  6:30  24:30
       LAYOVER LAX 24:30 HILTON LAX
06AUG  DL160   LAX  1200  JFK  2030  5:30
       
CREDIT: 6:25  BLOCK: 5:15  TAFB: 4d08:30  FDP: 13:15
PAY: 6:25  SIT/EDP: 0:50  CARVEOUTS: NONE  DH: 1`,
        holdProbability: 42,
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: '8123',
        effectiveDates: '01AUG-31AUG',
        route: 'JFK-MIA-JFK-ATL-JFK',
        creditHours: '5.45',
        blockHours: '4.20',
        tafb: '3d 15:45',
        fdp: '12:00',
        payHours: '5.45',
        sitEdpPay: '0.25',
        carveouts: 'None',
        deadheads: 0,
        layovers: [
          { city: 'MIA', hotel: 'Marriott Miami', duration: '14:15' },
          { city: 'ATL', hotel: 'Hilton Atlanta', duration: '11:30' },
        ],
        flightSegments: [
          {
            day: 1,
            date: '10AUG',
            flightNumber: 'DL1089',
            departure: 'JFK',
            departureTime: '07:30',
            arrival: 'MIA',
            arrivalTime: '10:45',
            blockTime: '3:15',
            turnTime: '14:15',
          },
          {
            day: 2,
            date: '11AUG',
            flightNumber: 'DL1090',
            departure: 'MIA',
            departureTime: '01:00',
            arrival: 'JFK',
            arrivalTime: '03:55',
            blockTime: '2:55',
            turnTime: '4:05',
          },
        ],
        fullTextBlock: `PAIRING: 8123    EFFECTIVE: 01AUG-31AUG
JFK-MIA-JFK-ATL-JFK
10AUG  DL1089  JFK  0730  MIA  1045  3:15  14:15
       LAYOVER MIA 14:15 MARRIOTT MIAMI
11AUG  DL1090  MIA  0100  JFK  0355  2:55  4:05
       DL1456  JFK  0800  ATL  1015  2:15  11:30
       LAYOVER ATL 11:30 HILTON ATLANTA
12AUG  DL1457  ATL  2045  JFK  2315  2:30
       
CREDIT: 5:45  BLOCK: 4:20  TAFB: 3d15:45  FDP: 12:00
PAY: 5:45  SIT/EDP: 0:25  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 73,
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: '9001',
        effectiveDates: '01AUG-31AUG',
        route: 'JFK-SEA-JFK',
        creditHours: '6.45',
        blockHours: '5.35',
        tafb: '2d 22:15',
        fdp: '12:45',
        payHours: '6.45',
        sitEdpPay: '0.60',
        carveouts: 'None',
        deadheads: 0,
        layovers: [{ city: 'SEA', hotel: 'Hyatt Seattle', duration: '22:15' }],
        flightSegments: [
          {
            day: 1,
            date: '15AUG',
            flightNumber: 'DL2567',
            departure: 'JFK',
            departureTime: '10:30',
            arrival: 'SEA',
            arrivalTime: '13:45',
            blockTime: '6:15',
            turnTime: '22:15',
          },
          {
            day: 2,
            date: '16AUG',
            flightNumber: 'DL2568',
            departure: 'SEA',
            departureTime: '12:00',
            arrival: 'JFK',
            arrivalTime: '19:20',
            blockTime: '5:20',
          },
        ],
        fullTextBlock: `PAIRING: 9001    EFFECTIVE: 01AUG-31AUG
JFK-SEA-JFK
15AUG  DL2567  JFK  1030  SEA  1345  6:15  22:15
       LAYOVER SEA 22:15 HYATT SEATTLE
16AUG  DL2568  SEA  1200  JFK  1920  5:20
       
CREDIT: 6:45  BLOCK: 5:35  TAFB: 2d22:15  FDP: 12:45
PAY: 6:45  SIT/EDP: 0:60  CARVEOUTS: NONE  DH: 0`,
        holdProbability: 95,
      },
      {
        bidPackageId: bidPackage.id,
        pairingNumber: '9876',
        effectiveDates: '01AUG-31AUG',
        route: 'JFK-ORD-DEN-JFK',
        creditHours: '5.15',
        blockHours: '3.85',
        tafb: '4d 12:30',
        fdp: '10:30',
        payHours: '5.15',
        sitEdpPay: '0.15',
        carveouts: 'None',
        deadheads: 2,
        layovers: [
          { city: 'ORD', hotel: "O'Hare Marriott", duration: '18:45' },
          { city: 'DEN', hotel: 'Westin Denver', duration: '20:30' },
        ],
        flightSegments: [
          {
            day: 1,
            date: '20AUG',
            flightNumber: 'DL1432',
            departure: 'JFK',
            departureTime: '14:20',
            arrival: 'ORD',
            arrivalTime: '16:45',
            blockTime: '2:25',
            turnTime: '18:45',
          },
          {
            day: 2,
            date: '21AUG',
            flightNumber: 'DL2234',
            departure: 'ORD',
            departureTime: '11:30',
            arrival: 'DEN',
            arrivalTime: '12:45',
            blockTime: '2:15',
            turnTime: '20:30',
          },
        ],
        fullTextBlock: `PAIRING: 9876    EFFECTIVE: 01AUG-31AUG
JFK-ORD-DEN-JFK
20AUG  DL1432  JFK  1420  ORD  1645  2:25  18:45
       LAYOVER ORD 18:45 O'HARE MARRIOTT
21AUG  DL2234  ORD  1130  DEN  1245  2:15  20:30
       LAYOVER DEN 20:30 WESTIN DENVER
22AUG  DHD     DEN  0800  JFK  1430  DEADHEAD
       DHD     JFK  1600  JFK  1600  DEADHEAD
       
CREDIT: 5:15  BLOCK: 3:85  TAFB: 4d12:30  FDP: 10:30
PAY: 5:15  SIT/EDP: 0:15  CARVEOUTS: NONE  DH: 2`,
        holdProbability: 28,
      },
    ];

    // Insert all pairings
    for (const pairingData of samplePairings) {
      const pairing = await storage.createPairing(pairingData);
      console.log(`Created pairing: ${pairing.pairingNumber}`);
    }

    // Update bid package status to completed
    await storage.updateBidPackageStatus(bidPackage.id, 'completed');

    // Create sample bid history
    const bidHistoryData = [
      {
        pairingNumber: '7666',
        month: 'July',
        year: 2025,
        juniorHolderSeniority: 15750,
        awardedAt: new Date('2025-07-15'),
      },
      {
        pairingNumber: '7666',
        month: 'June',
        year: 2025,
        juniorHolderSeniority: 15820,
        awardedAt: new Date('2025-06-15'),
      },
      {
        pairingNumber: '7890',
        month: 'July',
        year: 2025,
        juniorHolderSeniority: 14500,
        awardedAt: new Date('2025-07-15'),
      },
      {
        pairingNumber: '9001',
        month: 'July',
        year: 2025,
        juniorHolderSeniority: 16200,
        awardedAt: new Date('2025-07-15'),
      },
    ];

    for (const historyData of bidHistoryData) {
      await storage.createBidHistory(historyData);
    }

    // Create a sample user
    const user = await storage.createUser({
      seniorityNumber: 15860,
      base: 'NYC',
      aircraft: 'A220',
    });

    console.log('Database seeding completed successfully!');
    console.log(`Created bid package: ${bidPackage.id}`);
    console.log(`Created ${samplePairings.length} pairings`);
    console.log(`Created user with seniority: ${user.seniorityNumber}`);
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}
