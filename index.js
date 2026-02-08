import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupAssistant, setupDMAgent, getOrCreateThread } from './src/assistant.js';
import { startPolling } from './src/bot.js';
import { connectDB } from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('No config.json found. Run "npm run setup" first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  if (!config.backboard_api_key) {
    console.error('No Backboard API key in config.json. Run "npm run setup" first.');
    process.exit(1);
  }

  if (!config.group_chats || config.group_chats.length === 0) {
    console.error('No group chats configured. Run "npm run setup" first.');
    process.exit(1);
  }

  console.log('=== LinkUp for iMessage ===\n');

  // Initialize Backboard
  console.log('[Init] Connecting to Backboard...');
  const { client, assistantId } = await setupAssistant(config.backboard_api_key);
  console.log(`[Init] Group Agent ID: ${assistantId}`);

  const { dmAssistantId } = await setupDMAgent(client);
  console.log(`[Init] DM Agent ID: ${dmAssistantId}\n`);

  // Connect to MongoDB Atlas if configured
  if (config.mongodb_uri) {
    console.log('[Init] Connecting to MongoDB Atlas...');
    await connectDB(config.mongodb_uri);
  } else {
    console.log('[Init] No MongoDB URI configured — running without memory');
  }

  // Set up threads for each group chat
  for (const gc of config.group_chats) {
    gc.thread_id = await getOrCreateThread(client, assistantId, gc.thread_id);
    console.log(`[Init] ${gc.name} → thread ${gc.thread_id}`);
  }

  // Save thread IDs so they persist across restarts
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('');

  // Start the polling loop
  await startPolling(client, config.group_chats, dmAssistantId);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
