/**
 * LinkUp Setup — interactive CLI to choose which group chats to monitor.
 * Run: node setup.js
 *
 * PRIVACY: Only reads chat names/IDs from chat.db. Never reads message contents.
 */
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadExistingConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { backboard_api_key: '', group_chats: [] };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = loadExistingConfig();

  console.log('\n=== LinkUp Setup ===\n');
  console.log('This will help you configure which group chats LinkUp monitors.');
  console.log('PRIVACY: We only read chat names/IDs, never message contents.\n');

  // Step 1: API key
  if (!config.backboard_api_key) {
    config.backboard_api_key = await ask(rl, 'Enter your Backboard API key: ');
  } else {
    const change = await ask(rl, `Backboard API key is set (${config.backboard_api_key.slice(0, 8)}...). Change it? (y/N): `);
    if (change.toLowerCase() === 'y') {
      config.backboard_api_key = await ask(rl, 'Enter new Backboard API key: ');
    }
  }

  // Step 2: List group chats
  let imessage;
  let chatList;
  try {
    imessage = await import('./src/imessage.js');
    chatList = imessage.getChatList();
  } catch (err) {
    console.error('\nERROR: Could not read chat.db.');
    console.error('Make sure Terminal has Full Disk Access:');
    console.error('  System Settings → Privacy & Security → Full Disk Access → add Terminal\n');
    console.error('Details:', err.message);
    rl.close();
    process.exit(1);
  }

  // Filter to group chats (more than 1 member)
  const groupChats = chatList.filter(c => c.memberCount > 1);

  if (groupChats.length === 0) {
    console.log('\nNo group chats found in your Messages. Make sure you have group chats in iMessage.');
    rl.close();
    return;
  }

  console.log(`\nFound ${groupChats.length} group chats:\n`);
  groupChats.forEach((gc, i) => {
    const alreadyTracked = config.group_chats.some(t => t.chat_id === gc.chatId);
    const marker = alreadyTracked ? ' [TRACKED]' : '';
    console.log(`  ${i + 1}. ${gc.displayName} (${gc.memberCount} members)${marker}`);
  });

  console.log('\nEnter the numbers of chats to track (comma-separated), or "done" to keep current:');
  const selection = await ask(rl, '> ');

  if (selection.trim().toLowerCase() !== 'done') {
    const indices = selection.split(',').map(s => parseInt(s.trim(), 10) - 1);
    const newGroupChats = [];

    for (const idx of indices) {
      if (idx < 0 || idx >= groupChats.length) {
        console.log(`Skipping invalid index: ${idx + 1}`);
        continue;
      }

      const gc = groupChats[idx];

      // Check if already configured
      const existing = config.group_chats.find(t => t.chat_id === gc.chatId);
      if (existing) {
        newGroupChats.push(existing);
        continue;
      }

      // Get member details
      const handles = imessage.getGroupChatMembers(gc.chatId);

      console.log(`\nSetting up "${gc.displayName}":`);
      const members = [];
      for (const handle of handles) {
        const name = await ask(rl, `  Name for ${handle}: `);
        members.push({ name: name || handle, contact: handle });
      }

      const thresholdStr = await ask(rl, `  Days before nudging to hang out (default 7): `);
      const threshold = parseInt(thresholdStr, 10) || 7;

      newGroupChats.push({
        chat_id: gc.chatId,
        name: gc.displayName !== '(unnamed)' ? gc.displayName : `Group ${idx + 1}`,
        members,
        hangout_threshold_days: threshold,
      });
    }

    config.group_chats = newGroupChats;
  }

  saveConfig(config);
  console.log(`\nConfig saved to ${CONFIG_PATH}`);
  console.log(`Tracking ${config.group_chats.length} group chat(s).`);
  console.log('\nRun "npm start" to launch LinkUp!\n');

  rl.close();
}

main().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
