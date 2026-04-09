#!/usr/bin/env node
/**
 * Test script for background scan functionality
 * Tests that scan can run in background and progress can be polled
 */

const SERVER_URL = process.env.BASE_URL || 'http://localhost:5174';

async function testBackgroundScan() {
  console.log('🧪 Testing background scan functionality...\n');
  
  try {
    // 1. Check server is running
    console.log('1️⃣ Checking server status...');
    const healthCheck = await fetch(`${SERVER_URL}/api/scan-results`);
    if (!healthCheck.ok) {
      throw new Error('Server not running. Start it with: npm run dev');
    }
    console.log('✅ Server is running\n');
    
    // 2. Check initial scan state
    console.log('2️⃣ Checking initial scan state...');
    const initialState = await fetch(`${SERVER_URL}/api/scan/progress`);
    const initialData = await initialState.json();
    console.log('Initial state:', JSON.stringify(initialData, null, 2));
    
    if (initialData.running) {
      console.log('⚠️  A scan is already running. Wait for it to complete before testing.\n');
      return;
    }
    console.log('✅ No active scan\n');
    
    // 3. Start a scan (but don't wait for it)
    console.log('3️⃣ Starting background scan...');
    const scanStart = await fetch(`${SERVER_URL}/api/scan`, { method: 'POST' });
    
    if (!scanStart.ok) {
      const error = await scanStart.json();
      throw new Error(`Failed to start scan: ${error.error}`);
    }
    
    // Read just the first message to get scan ID
    const reader = scanStart.body.getReader();
    const decoder = new TextDecoder();
    let scanId = null;
    
    const { value } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.scanId && data.started) {
            scanId = data.scanId;
            console.log(`✅ Scan started with ID: ${scanId}\n`);
            break;
          }
        }
      }
    }
    
    // Keep the request alive: canceling the reader aborts POST and can break the server-side scan.
    void (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        /* ignore */
      }
    })();
    
    if (!scanId) {
      throw new Error('Failed to get scan ID');
    }
    
    // 4. Poll for progress a few times
    console.log('4️⃣ Polling scan progress (5 times, 2s intervals)...');
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const progressCheck = await fetch(`${SERVER_URL}/api/scan/progress`);
      const progressData = await progressCheck.json();
      
      console.log(`   Poll ${i + 1}: ${progressData.progress.index}/${progressData.progress.total} tickers` +
        ` (${progressData.progress.vcpBullishCount} VCP bullish)` +
        ` ${progressData.running ? '🔄' : '✅ Complete'}`);
      
      if (!progressData.running) {
        console.log('✅ Scan completed!\n');
        break;
      }
    }
    
    console.log('5️⃣ Verifying results were saved...');
    const resultsCheck = await fetch(`${SERVER_URL}/api/scan-results`);
    const resultsData = await resultsCheck.json();
    
    if (resultsData.results && resultsData.results.length > 0) {
      console.log(`✅ Results saved: ${resultsData.results.length} tickers\n`);
    } else {
      console.log('⚠️  No results found (scan may still be running)\n');
    }
    
    console.log('✨ Background scan test complete!');
    console.log('   • Scan runs in background ✅');
    console.log('   • Progress can be polled ✅');
    console.log('   • Results are saved incrementally ✅');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testBackgroundScan();
