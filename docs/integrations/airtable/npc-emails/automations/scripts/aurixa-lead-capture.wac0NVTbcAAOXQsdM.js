// Aurixa Lead Capture  —  node wac0NVTbcAAOXQsdM
// Source automation wflM9vUhBoHb0ZE8r in base apptyShYE0yzL4IGB (NPC Emails).
// Paste into the Airtable UI: the API cannot author a script node.
// Declared input variables: (none)

console.log("Starting 60-second delay...");

// 1. Capture the start time in milliseconds
const startTime = Date.now();
const delayDuration = 10000; // 60 seconds

// 2. Loop continuously until the time difference reaches 60,000ms
while (Date.now() - startTime < delayDuration) {
    // This loop blocks execution until the target duration passes
}

console.log("60 seconds completed. Proceeding with script...");
