import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as imessage from './imessage.js';
import { sendToBackboard, submitToolResults } from './assistant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '..', 'state.json');
const POLL_INTERVAL = 10_000; // 10 seconds

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { chats: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Execute a tool call from the AI and return the result string.
 */
async function executeTool(toolName, args, chatConfig, state, chatId) {
  switch (toolName) {
    case 'send_group_message': {
      console.log(`[Bot] Sending to group: "${args.message}"`);
      await imessage.sendMessage(chatId, args.message);
      return JSON.stringify({ success: true });
    }

    case 'send_dm': {
      console.log(`[Bot] DMing ${args.contact}: "${args.message}"`);
      await imessage.sendDM(args.contact, args.message);
      return JSON.stringify({ success: true });
    }

    case 'log_hangout': {
      const hangout = {
        date: new Date().toISOString(),
        description: args.description || 'Hangout',
      };
      if (!state.chats[chatId]) state.chats[chatId] = {};
      if (!state.chats[chatId].hangouts) state.chats[chatId].hangouts = [];
      state.chats[chatId].hangouts.push(hangout);
      saveState(state);
      console.log(`[Bot] Logged hangout: ${hangout.description}`);
      return JSON.stringify({ success: true, hangout });
    }

    case 'check_last_hangout': {
      const chatState = state.chats[chatId] || {};
      const hangouts = chatState.hangouts || [];
      if (hangouts.length === 0) {
        return JSON.stringify({ lastHangout: null, message: 'No hangouts recorded yet!' });
      }
      const last = hangouts[hangouts.length - 1];
      const daysAgo = Math.floor((Date.now() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24));
      return JSON.stringify({ lastHangout: last, daysAgo });
    }

    case 'get_member_availability': {
      const chatState = state.chats[chatId] || {};
      const availability = chatState.availability || {};
      return JSON.stringify({ availability });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

/**
 * Process tool calls from Backboard, executing them and submitting results back.
 * Loops until Backboard has no more tool calls.
 */
async function processToolCalls(client, threadId, response, chatConfig, state, chatId) {
  let current = response;

  while (current.status === 'REQUIRES_ACTION' && current.toolCalls && current.toolCalls.length > 0) {
    const toolOutputs = [];

    for (const tc of current.toolCalls) {
      const fnName = tc.function.name;
      const args = tc.function.parsedArguments || JSON.parse(tc.function.arguments || '{}');

      console.log(`[Bot] Tool call: ${fnName}(${JSON.stringify(args)})`);
      const output = await executeTool(fnName, args, chatConfig, state, chatId);
      toolOutputs.push({ tool_call_id: tc.id, output });
    }

    current = await submitToolResults(client, threadId, current.runId, toolOutputs);
  }

  return current;
}

/**
 * Build a member directory string so the AI knows who's in the group and their contacts.
 */
function getMemberDirectory(chatConfig) {
  return chatConfig.members
    .map(m => `- ${m.name}: ${m.contact}`)
    .join('\n');
}

/**
 * Build a formatted message to send to Backboard from an iMessage.
 * Includes the member directory so the AI knows actual contact info.
 */
function formatIncomingMessage(msg, chatConfig) {
  const member = chatConfig.members.find(m => m.contact === msg.senderHandle);
  const name = member ? member.name : msg.senderHandle;
  const directory = getMemberDirectory(chatConfig);
  return `[Group: ${chatConfig.name}]\n[Members]\n${directory}\n\n[${name}]: ${msg.text}`;
}

/**
 * Check if it's been too long since the last hangout and trigger a nudge.
 */
async function checkHangoutThreshold(client, threadId, chatConfig, state, chatId) {
  const chatState = state.chats[chatId] || {};
  const hangouts = chatState.hangouts || [];
  const thresholdDays = chatConfig.hangout_threshold_days || 7;

  // Don't nudge if we've already nudged recently (within 24h)
  const lastNudge = chatState.lastNudge ? new Date(chatState.lastNudge) : null;
  if (lastNudge && (Date.now() - lastNudge.getTime()) < 24 * 60 * 60 * 1000) {
    return;
  }

  let shouldNudge = false;
  if (hangouts.length === 0) {
    const botStart = chatState.botStartDate ? new Date(chatState.botStartDate) : new Date();
    if (!chatState.botStartDate) {
      chatState.botStartDate = botStart.toISOString();
      state.chats[chatId] = chatState;
      saveState(state);
    }
    const daysSinceStart = Math.floor((Date.now() - botStart.getTime()) / (1000 * 60 * 60 * 24));
    shouldNudge = daysSinceStart >= thresholdDays;
  } else {
    const last = hangouts[hangouts.length - 1];
    const daysAgo = Math.floor((Date.now() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24));
    shouldNudge = daysAgo >= thresholdDays;
  }

  if (shouldNudge) {
    console.log(`[Bot] Hangout threshold reached for ${chatConfig.name}, nudging...`);
    const directory = getMemberDirectory(chatConfig);
    const nudgeMessage = `[Group: ${chatConfig.name}]\n[Members]\n${directory}\n\n[SYSTEM]: It's been a while since this group hung out. The hangout threshold of ${thresholdDays} days has been reached. Nudge the group to make plans!`;

    const response = await sendToBackboard(client, threadId, nudgeMessage);
    await processToolCalls(client, threadId, response, chatConfig, state, chatId);

    if (!state.chats[chatId]) state.chats[chatId] = {};
    state.chats[chatId].lastNudge = new Date().toISOString();
    saveState(state);
  }
}

/**
 * Main polling loop. Checks for new messages in tracked group chats AND DM replies.
 */
export async function startPolling(client, chatConfigs) {
  const state = loadState();

  // Initialize bookmarks for each group chat
  for (const gc of chatConfigs) {
    if (!state.chats[gc.chat_id]) state.chats[gc.chat_id] = {};
    if (!state.chats[gc.chat_id].lastRowId) {
      state.chats[gc.chat_id].lastRowId = imessage.getLatestRowId(gc.chat_id);
      console.log(`[Bot] Initialized ${gc.name} bookmark at rowid ${state.chats[gc.chat_id].lastRowId}`);
    }

    // Initialize DM bookmarks for each member
    if (!state.chats[gc.chat_id].dmBookmarks) {
      state.chats[gc.chat_id].dmBookmarks = {};
    }
    for (const member of gc.members) {
      if (!state.chats[gc.chat_id].dmBookmarks[member.contact]) {
        // Start from latest DM so we don't replay old messages
        state.chats[gc.chat_id].dmBookmarks[member.contact] = imessage.getLatestRowId(member.contact);
        console.log(`[Bot] Initialized DM bookmark for ${member.name} (${member.contact}) at rowid ${state.chats[gc.chat_id].dmBookmarks[member.contact]}`);
      }
    }
  }
  saveState(state);

  console.log('[Bot] Polling started. Watching for new messages...\n');

  async function poll() {
    const currentState = loadState();

    for (const gc of chatConfigs) {
      const chatId = gc.chat_id;
      const chatState = currentState.chats[chatId] || {};

      // --- Poll group chat messages ---
      const lastRowId = chatState.lastRowId || 0;
      const messages = imessage.getRecentMessages(chatId, lastRowId);

      for (const msg of messages) {
        if (msg.isFromMe) {
          currentState.chats[chatId].lastRowId = msg.rowid;
          continue;
        }

        console.log(`[Bot] New message in ${gc.name} from ${msg.senderHandle}: "${msg.text}"`);
        const formatted = formatIncomingMessage(msg, gc);

        try {
          const response = await sendToBackboard(client, gc.thread_id, formatted);
          await processToolCalls(client, gc.thread_id, response, gc, currentState, chatId);
        } catch (err) {
          console.error(`[Bot] Error processing message in ${gc.name}:`, err.message);
        }

        currentState.chats[chatId].lastRowId = msg.rowid;
        saveState(currentState);
      }

      // --- Poll DM replies from each member ---
      const dmBookmarks = currentState.chats[chatId].dmBookmarks || {};
      for (const member of gc.members) {
        const dmLastRowId = dmBookmarks[member.contact] || 0;
        const dmReplies = imessage.getDMReplies(member.contact, dmLastRowId);

        for (const dm of dmReplies) {
          console.log(`[Bot] DM reply from ${member.name} (${member.contact}): "${dm.text}"`);

          const directory = getMemberDirectory(gc);
          const formatted = `[Group: ${gc.name}]\n[Members]\n${directory}\n\n[DM from ${member.name} (${member.contact})]: ${dm.text}`;

          try {
            const response = await sendToBackboard(client, gc.thread_id, formatted);
            await processToolCalls(client, gc.thread_id, response, gc, currentState, chatId);
          } catch (err) {
            console.error(`[Bot] Error processing DM from ${member.name}:`, err.message);
          }

          currentState.chats[chatId].dmBookmarks[member.contact] = dm.rowid;
          saveState(currentState);
        }
      }

      // --- Check hangout threshold ---
      try {
        await checkHangoutThreshold(client, gc.thread_id, gc, currentState, chatId);
      } catch (err) {
        console.error(`[Bot] Error checking threshold for ${gc.name}:`, err.message);
      }
    }

    saveState(currentState);
  }

  // First poll immediately
  await poll();

  // Then repeat on interval
  setInterval(async () => {
    try {
      await poll();
    } catch (err) {
      console.error('[Bot] Poll error:', err.message);
    }
  }, POLL_INTERVAL);
}
