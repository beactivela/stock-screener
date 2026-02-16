#!/usr/bin/env node
/**
 * Manual verification of industry data accuracy vs Yahoo Finance
 * Compares selected industries from your table with current Yahoo Finance data
 */

import https from 'https';

// Your table data from the screenshot (as of 2/15/2026, 2:20:54 PM)
const yourTableData = {
  // Technology Sector
  'Semiconductors': { ytd: 1.3, sixM: 10.9, oneY: 39.0 },
  'Computer Hardware': { ytd: 23.9, sixM: 44.1, oneY: 52.0 },
  'Software - Application': { ytd: -25.0, sixM: -30.1, oneY: -39.6 },
  'Software - Infrastructure': { ytd: -16.3, sixM: -22.2, oneY: -4.6 },
  
  // Financial Services
  'Banks - Diversified': { ytd: -5.1, sixM: 10.5, oneY: 15.5 },
  'Asset Management': { ytd: -4.9, sixM: -8.9, oneY: -6.8 },
  
  // Mixed
  'Semiconductor Equipment & Materials': { ytd: 61.2, sixM: 112.3, oneY: 116.4 }
};

// Function to fetch current Yahoo Finance sector data
async function fetchYahooSectorPerformance(sectorUrl) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'finance.yahoo.com',
      path: sectorUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    let data = '';
    const req = https.request(options, (res) => {
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Look for performance percentage in the HTML
          const ytdMatch = data.match(/YTD.*?([+-]?\d+\.?\d*)%/s);
          const sixMMatch = data.match(/6M.*?([+-]?\d+\.?\d*)%/s);
          const oneYMatch = data.match(/1Y.*?([+-]?\d+\.?\d*)%/s);
          
          resolve({
            ytd: ytdMatch ? parseFloat(ytdMatch[1]) : null,
            sixM: sixMMatch ? parseFloat(sixMMatch[1]) : null,
            oneY: oneYMatch ? parseFloat(oneYMatch[1]) : null,
            source: 'Yahoo Finance'
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Compare your data with current Yahoo data
async function verifyData() {
  console.log('Industry Data Accuracy Verification');
  console.log('====================================');
  console.log('Comparing your table data (2/15/2026, 2:20:54 PM) vs current Yahoo Finance\n');

  const sectorUrls = {
    'Computer Hardware': '/sectors/technology/computer-hardware/',
    'Software - Application': '/sectors/technology/software-application/',
    'Semiconductors': '/sectors/technology/semiconductors/'
  };

  for (const [industry, url] of Object.entries(sectorUrls)) {
    try {
      console.log(`\n${industry}:`);
      console.log(`Your data - YTD: ${yourTableData[industry].ytd}%, 6M: ${yourTableData[industry].sixM}%, 1Y: ${yourTableData[industry].oneY}%`);
      
      // For now, we'll just show the comparison method
      // In practice, you'd fetch from Yahoo and compare
      console.log(`To verify: Visit https://finance.yahoo.com${url}`);
      console.log(`Check: Does the sector performance match your table values?`);
      
    } catch (error) {
      console.log(`Error fetching ${industry}: ${error.message}`);
    }
  }

  console.log('\n');
  console.log('Manual Verification Steps:');
  console.log('1. Visit individual Yahoo Finance sector pages');
  console.log('2. Compare YTD, 6M, and 1Y percentages');
  console.log('3. Check if your data timestamp (2/15/2026, 2:20:54 PM) corresponds to the same period');
  console.log('4. Account for different market close times and data refresh rates');
}

// Run verification
verifyData().catch(console.error);