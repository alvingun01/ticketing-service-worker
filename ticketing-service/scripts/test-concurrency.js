/**
 * High-Concurrency Ticket Purchasing Test Script
 * 
 * Simulates concurrent buyers attempting to purchase tickets simultaneously.
 * Verifies Redis atomic Lua script execution, zero race conditions, and zero overselling.
 * 
 * Usage:
 *   node scripts/test-concurrency.js [CONCURRENCY_LEVEL] [TARGET_URL]
 *   Example: node scripts/test-concurrency.js 50 http://localhost:8000
 */

const BASE_URL = process.argv[3] || process.env.BACKEND_URL || 'http://localhost:8000';
const CONCURRENCY_LEVEL = parseInt(process.argv[2] || '50', 10);

async function runConcurrencyTest() {
  console.log('\n======================================================');
  console.log('🚀 REDIS HIGH-CONCURRENCY TICKET BUYING TEST SCRIPT');
  console.log('======================================================');
  console.log(`🎯 Target Server     : ${BASE_URL}`);
  console.log(`⚡ Concurrent Requests: ${CONCURRENCY_LEVEL} buyers simultaneously\n`);

  try {
    // Step 1: Fetch initial tickets list
    console.log('🔍 Step 1: Fetching available ticket inventory...');
    let res = await fetch(`${BASE_URL}/tickets`);
    if (!res.ok) {
      throw new Error(`Failed to fetch /tickets (HTTP ${res.status})`);
    }

    let tickets = await res.json();
    if (!Array.isArray(tickets) || tickets.length === 0) {
      console.log('🌱 No tickets found. Triggering database seed...');
      await fetch(`${BASE_URL}/seed`, { method: 'POST' });
      res = await fetch(`${BASE_URL}/tickets`);
      tickets = await res.json();
    }

    // Pick target ticket tier for concurrency test (prioritize CAT 2 General Floor for Music of the Spheres Tour)
    const categoryFilter = process.env.TARGET_CAT || 'CAT 2';
    const eventFilter = process.env.TARGET_EVENT || 'Music of the Spheres';

    let targetTicket = tickets.find(
      (t) =>
        t.categoryName?.toLowerCase().includes(categoryFilter.toLowerCase()) &&
        t.eventTitle?.toLowerCase().includes(eventFilter.toLowerCase())
    );

    if (!targetTicket) {
      targetTicket = tickets.find((t) => t.quantity > 0) || tickets[0];
    }

    if (!targetTicket) {
      throw new Error('No tickets available for test.');
    }

    console.log(`📌 Selected Target Tier : [${targetTicket.categoryName}] for "${targetTicket.eventTitle}"`);
    console.log(`   Ticket ID            : ${targetTicket.id}`);
    console.log(`   Current Stock in DB  : ${targetTicket.quantity}`);

    // Step 2: Ensure ticket is set to AVAILABLE so it is loaded into Redis
    console.log('\n⚡ Step 2: Enabling sale status to push ticket to Redis cache...');
    const patchRes = await fetch(`${BASE_URL}/tickets/${targetTicket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'AVAILABLE' }),
    });

    if (patchRes.ok) {
      targetTicket = await patchRes.json();
      console.log(`   Sale Status Enabled : [${targetTicket.status}] (Stock: ${targetTicket.quantity})`);
    }

    const initialQuantity = targetTicket.quantity;
    console.log(`\n🔥 Step 3: Firing ${CONCURRENCY_LEVEL} SIMULTANEOUS purchase requests (1 ticket each)...`);

    const startTime = Date.now();

    // Prepare array of concurrent fetch promises
    const promises = Array.from({ length: CONCURRENCY_LEVEL }, (_, i) => {
      return fetch(`${BASE_URL}/tickets/${targetTicket.id}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 }),
      }).then(async (r) => ({
        index: i + 1,
        status: r.status,
        ok: r.ok,
        body: await r.json().catch(() => ({})),
      })).catch((err) => ({
        index: i + 1,
        status: 0,
        ok: false,
        error: err.message,
      }));
    });

    // Execute all requests at the exact same millisecond
    const results = await Promise.all(promises);
    const durationMs = Date.now() - startTime;

    // Step 4: Analyze Results
    const successfulPurchases = results.filter((r) => r.ok);
    const rejectedPurchases = results.filter((r) => !r.ok && r.status === 400);
    const otherErrors = results.filter((r) => !r.ok && r.status !== 400);

    // Step 5: Fetch final ticket inventory from backend
    const finalRes = await fetch(`${BASE_URL}/tickets/${targetTicket.id}`);
    const finalTicket = await finalRes.json();

    console.log('\n======================================================');
    console.log('📊 CONCURRENCY TEST RESULTS & STATISTICS');
    console.log('======================================================');
    console.log(`⏱️ Total Time Elapsed   : ${durationMs} ms (${(durationMs / 1000).toFixed(2)}s)`);
    console.log(`🚀 Requests Per Second  : ${((CONCURRENCY_LEVEL / durationMs) * 1000).toFixed(1)} req/sec`);
    console.log(`📦 Initial Ticket Stock : ${initialQuantity}`);
    console.log(`✅ Successful Purchases : ${successfulPurchases.length}`);
    console.log(`🔴 Rejected (Sold Out)  : ${rejectedPurchases.length}`);
    if (otherErrors.length > 0) {
      console.log(`⚠️ Network/Other Errors : ${otherErrors.length}`);
    }
    console.log(`📉 Remaining Stock      : ${finalTicket.quantity}`);
    console.log(`🏷️ Final Ticket Status  : [${finalTicket.status}]`);

    // Verification Checks
    console.log('\n======================================================');
    console.log('🛡️ RACE CONDITION & OVERSELLING INTEGRITY CHECKS');
    console.log('======================================================');

    const expectedStock = Math.max(0, initialQuantity - successfulPurchases.length);
    const oversold = finalTicket.quantity < 0;
    const stockIntegrityValid = finalTicket.quantity === expectedStock;
    const noGhostTickets = successfulPurchases.length <= initialQuantity;

    if (!oversold && stockIntegrityValid && noGhostTickets) {
      console.log('🟢 PASS: Zero Race Conditions Detected!');
      console.log('🟢 PASS: Stock count matches expected remaining inventory perfectly!');
      console.log('🟢 PASS: Zero Overselling! Redis atomic Lua script protected inventory.');
      console.log('======================================================\n');
      process.exit(0);
    } else {
      console.error('🔴 FAIL: Race condition or overselling detected!');
      if (oversold) console.error(`   - Stock dropped below zero: ${finalTicket.quantity}`);
      if (!stockIntegrityValid) console.error(`   - Stock mismatch: expected ${expectedStock}, got ${finalTicket.quantity}`);
      if (!noGhostTickets) console.error(`   - Sold more tickets (${successfulPurchases.length}) than initial stock (${initialQuantity})`);
      console.log('======================================================\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n🔴 Concurrency Test Exec Error:', err.message);
    process.exit(1);
  }
}

runConcurrencyTest();
