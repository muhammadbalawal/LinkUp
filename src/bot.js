import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as imessage from './imessage.js';
import {
  sendToBackboard,
  submitToolResults,
  createDMThread,
  sendToDMAgent,
} from './assistant.js';

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
 * Build a member directory string so the AI knows who's in the group and their contacts.
 */
function getMemberDirectory(chatConfig) {
  return chatConfig.members
    .map(m => `- ${m.name}: ${m.contact}`)
    .join('\n');
}

/**
 * Execute a tool call from the Group Agent and return the result string.
 */
async function executeTool(toolName, args, chatConfig, state, chatId, client, dmAssistantId) {
  switch (toolName) {
    case 'send_group_message': {
      const event = state.chats[chatId]?.event;

      // Rate-limit during plan delivery: max 2 messages
      if (event && event.type === 'ready') {
        if (!state.chats[chatId].planMessageCount) {
          state.chats[chatId].planMessageCount = 0;
        }
        state.chats[chatId].planMessageCount += 1;

        if (state.chats[chatId].planMessageCount > 2) {
          console.log(`[Bot] Blocked send_group_message — plan message limit (2) reached for ${chatId}`);
          // Reset to idle since plan is fully delivered
          state.chats[chatId].event = { type: 'idle' };
          state.chats[chatId].planDeliveredAt = Date.now();
          state.chats[chatId].planMessageCount = 0;
          saveState(state);
          return JSON.stringify({ success: false, error: 'Plan message limit reached. Plan has been delivered.' });
        }
      }

      console.log(`[Bot] Sending to group: "${args.message}"`);
      await imessage.sendMessage(chatId, args.message);

      // After 2 messages during ready state, reset to idle
      if (event && event.type === 'ready' && state.chats[chatId].planMessageCount >= 2) {
        console.log(`[Bot] Plan delivered (2 messages sent). Resetting to idle for ${chatId}`);
        state.chats[chatId].event = { type: 'idle' };
        state.chats[chatId].planDeliveredAt = Date.now();
        state.chats[chatId].planMessageCount = 0;
        saveState(state);
      }
      return JSON.stringify({ success: true });
    }

    case 'start_collecting': {
      console.log(`[Bot] Starting preference collection for ${chatConfig.name}`);
      const agents = {};

      for (const member of chatConfig.members) {
        // Create a fresh DM thread for this person
        const threadId = await createDMThread(client, dmAssistantId);
        agents[member.contact] = {
          name: member.name,
          threadId,
          status: 'chatting',
          preferences: null,
        };

        // Send initial prompt to DM Agent — it will generate and send the first DM
        const initMessage = `[SYSTEM] You are DMing ${member.name} about a hangout for the "${chatConfig.name}" group chat. Send them your first message now by calling the send_reply tool. Introduce yourself and ask about their availability and what they want to do.`;
        const response = await sendToDMAgent(client, threadId, initMessage);
        console.log(`[Bot] DM Agent init for ${member.name} — status: ${response.status}, toolCalls: ${response.toolCalls?.length || 0}, content: ${response.content ? response.content.substring(0, 100) : '(none)'}`);
        await processDMToolCalls(client, threadId, response, member.contact, state, chatId, chatConfig, dmAssistantId);
      }

      state.chats[chatId].event = { type: 'collecting', agents };
      saveState(state);
      return JSON.stringify({ success: true, members: Object.keys(agents).length });
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
      const event = chatState.event || { type: 'idle' };
      // If collecting/ready, return agent preferences
      if (event.agents) {
        const availability = {};
        for (const [contact, agent] of Object.entries(event.agents)) {
          availability[agent.name] = agent.preferences || 'still chatting...';
        }
        return JSON.stringify({ availability });
      }
      return JSON.stringify({ availability: {} });
    }

    case 'request_reschedule': {
      console.log(`[Bot] Schedule conflict detected: ${args.conflict_summary}`);
      const agents = {};

      for (const member of chatConfig.members) {
        const prevPrefs = state.chats[chatId]?.event?.agents?.[member.contact]?.preferences;
        const threadId = await createDMThread(client, dmAssistantId);
        agents[member.contact] = {
          name: member.name,
          threadId,
          status: 'chatting',
          preferences: null,
        };

        const initMessage = `[SYSTEM] RESCHEDULE for "${chatConfig.name}". You are DMing ${member.name}. Conflict: ${args.conflict_summary}. Their previous activity: "${prevPrefs?.activity || 'unknown'}". Send ONE message asking what other dates/times work. Then STOP and wait for their reply. Do NOT call submit_preferences or send "locked in" yet.`;
        const response = await sendToDMAgent(client, threadId, initMessage);
        await processDMToolCalls(client, threadId, response, member.contact, state, chatId, chatConfig, dmAssistantId);
      }

      state.chats[chatId].event = { type: 'collecting', agents };
      saveState(state);
      return JSON.stringify({ success: true, rescheduling: true });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

/**
 * Execute a tool call from the DM Agent and return the result string.
 */
async function executeDMTool(toolName, args, currentContact, state, chatId, client, chatConfig, dmAssistantId) {
  const event = state.chats[chatId]?.event;

  switch (toolName) {
    case 'send_reply': {
      console.log(`[Bot] DM Agent → ${currentContact}: "${args.message}"`);
      await imessage.sendDM(currentContact, args.message);
      return JSON.stringify({ success: true });
    }

    case 'search_tiktok_trends': {
      console.log(`[Bot] DM Agent searching TikTok trends for ${currentContact}`);
      const timestamp = Date.now();
      const link = `https://www.tiktok.com/search?q=Top10thingtodoinmontreal&t=${timestamp}&fyp_enter_method=WORD_NOT_EXIST_10003`;
      return JSON.stringify({ success: true, link });
    }

    case 'submit_preferences': {
      console.log(`[Bot] DM Agent submitted preferences for ${currentContact}`);
      const agent = event.agents[currentContact];
      agent.status = 'done';
      agent.preferences = {
        availability: args.availability,
        activity: args.activity,
        notes: args.notes,
      };
      saveState(state);

      // Check if all agents are done
      const allDone = Object.values(event.agents).every(a => a.status === 'done');
      if (allDone) {
        console.log(`[Bot] All preferences collected! Triggering plan generation.`);
        event.type = 'ready';
        saveState(state);
        // Trigger plan generation on the group agent
        await triggerPlanGeneration(client, chatConfig, state, chatId, dmAssistantId);
      }
      return JSON.stringify({ success: true, allDone });
    }

    default:
      return JSON.stringify({ error: `Unknown DM tool: ${toolName}` });
  }
}

/**
 * Process tool calls from the Group Agent (Backboard), executing them and submitting results back.
 * Loops until Backboard has no more tool calls.
 */
async function processToolCalls(client, threadId, response, chatConfig, state, chatId, dmAssistantId) {
  let current = response;

  while (current.status === 'REQUIRES_ACTION' && current.toolCalls && current.toolCalls.length > 0) {
    const toolOutputs = [];

    for (const tc of current.toolCalls) {
      const fnName = tc.function.name;
      const args = tc.function.parsedArguments || JSON.parse(tc.function.arguments || '{}');

      console.log(`[Bot] Group Agent tool call: ${fnName}(${JSON.stringify(args)})`);
      const output = await executeTool(fnName, args, chatConfig, state, chatId, client, dmAssistantId);
      toolOutputs.push({ tool_call_id: tc.id, output });
    }

    current = await submitToolResults(client, threadId, current.runId, toolOutputs);
  }

  return current;
}

/**
 * Process tool calls from a DM Agent thread.
 * Loops until the DM Agent has no more tool calls.
 * If the agent responds with no tool calls but the person is still chatting,
 * re-nudge it to use its tools.
 */
async function processDMToolCalls(client, threadId, response, currentContact, state, chatId, chatConfig, dmAssistantId) {
  let current = response;
  let anyToolCallsMade = false;

  while (current.status === 'REQUIRES_ACTION' && current.toolCalls && current.toolCalls.length > 0) {
    anyToolCallsMade = true;
    const toolOutputs = [];

    for (const tc of current.toolCalls) {
      const fnName = tc.function.name;
      const args = tc.function.parsedArguments || JSON.parse(tc.function.arguments || '{}');

      console.log(`[Bot] DM Agent tool call (${currentContact}): ${fnName}(${JSON.stringify(args)})`);
      const output = await executeDMTool(fnName, args, currentContact, state, chatId, client, chatConfig, dmAssistantId);
      toolOutputs.push({ tool_call_id: tc.id, output });
    }

    current = await submitToolResults(client, threadId, current.runId, toolOutputs);
  }

  // Only nudge if the agent made ZERO tool calls in the entire exchange
  // (if it already sent a send_reply or submit_preferences, the turn is done — no double texting)
  const agent = state.chats[chatId]?.event?.agents?.[currentContact];
  if (!anyToolCallsMade && agent && agent.status === 'chatting') {
    console.log(`[Bot] DM Agent for ${currentContact} responded without ANY tools — nudging`);
    const nudge = `[SYSTEM REMINDER] Your last response had no tool calls and was invisible. You MUST call either send_reply to message this person, or submit_preferences if you have all their info (availability, activity, notes). Do it now.`;
    current = await sendToDMAgent(client, threadId, nudge);
    while (current.status === 'REQUIRES_ACTION' && current.toolCalls && current.toolCalls.length > 0) {
      const toolOutputs = [];
      for (const tc of current.toolCalls) {
        const fnName = tc.function.name;
        const args = tc.function.parsedArguments || JSON.parse(tc.function.arguments || '{}');
        console.log(`[Bot] DM Agent tool call after nudge (${currentContact}): ${fnName}(${JSON.stringify(args)})`);
        const output = await executeDMTool(fnName, args, currentContact, state, chatId, client, chatConfig, dmAssistantId);
        toolOutputs.push({ tool_call_id: tc.id, output });
      }
      current = await submitToolResults(client, threadId, current.runId, toolOutputs);
    }
  }

  return current;
}

/**
 * When all DM agents have submitted preferences, compile and send to the Group Agent
 * so it can search for venues and make the plan.
 */
async function triggerPlanGeneration(client, gc, state, chatId, dmAssistantId) {
  const event = state.chats[chatId].event;
  const agents = event.agents;

  // Build preference summary
  let summary = `[ALL PREFERENCES COLLECTED]\n\n`;
  for (const [contact, agent] of Object.entries(agents)) {
    const p = agent.preferences;
    summary += `${agent.name}:\n`;
    summary += `  Available: ${p.availability}\n`;
    summary += `  Wants: ${p.activity}\n`;
    summary += `  Notes: ${p.notes}\n\n`;
  }

  const directory = getMemberDirectory(gc);
  const message = `[Group: ${gc.name}]\n[Members]\n${directory}\n\n${summary}CRITICAL INSTRUCTIONS — follow this exact order:
1. FIRST: Check if everyone's times overlap. If they DON'T (e.g. one person is free at 2pm and another at 6pm), call request_reschedule with the conflict details. Do NOT send the plan to the GC until times are compatible.
2. If times ARE compatible: Call web search to find REAL venues, restaurants, theaters, or activity spots based on these preferences. Search multiple times if needed. You MUST search BEFORE sending any messages.
3. After you have REAL search results with REAL URLs, send EXACTLY 2 messages to the GC using send_group_message. Message 1: plan summary (what, when, where). Message 2: real links and venues from your search results (each URL on its own line for iMessage previews).
4. Do NOT send more than 2 messages. Do NOT skip the web search step. Do NOT make up URLs — every link must come from an actual search result. If you fabricate a URL it will be broken.`;

  console.log(`[Bot] Sending compiled preferences to Group Agent for ${gc.name}`);
  const response = await sendToBackboard(client, gc.thread_id, message);
  await processToolCalls(client, gc.thread_id, response, gc, state, chatId, dmAssistantId);
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
async function checkHangoutThreshold(client, threadId, chatConfig, state, chatId, dmAssistantId) {
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
    await processToolCalls(client, threadId, response, chatConfig, state, chatId, dmAssistantId);

    if (!state.chats[chatId]) state.chats[chatId] = {};
    state.chats[chatId].lastNudge = new Date().toISOString();
    saveState(state);
  }
}

/**
 * Main polling loop. Checks for new messages in tracked group chats AND DM replies.
 */
export async function startPolling(client, chatConfigs, dmAssistantId) {
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

        // Skip GC messages while a planning cycle is active (prevents duplicate triggers)
        const event = currentState.chats[chatId].event || { type: 'idle' };
        if (event.type !== 'idle') {
          console.log(`[Bot] Skipping GC message — event is "${event.type}" for ${gc.name}`);
          currentState.chats[chatId].lastRowId = msg.rowid;
          saveState(currentState);
          continue;
        }

        // Post-plan cooldown: skip messages for 60 seconds after plan delivery
        // Prevents "bet" / "sounds good" from re-triggering the full planning flow
        const planDeliveredAt = currentState.chats[chatId].planDeliveredAt || 0;
        if (planDeliveredAt && (Date.now() - planDeliveredAt) < 60_000) {
          console.log(`[Bot] Skipping GC message — post-plan cooldown active for ${gc.name} (${Math.round((60_000 - (Date.now() - planDeliveredAt)) / 1000)}s remaining)`);
          currentState.chats[chatId].lastRowId = msg.rowid;
          saveState(currentState);
          continue;
        }

        const formatted = formatIncomingMessage(msg, gc);

        try {
          const response = await sendToBackboard(client, gc.thread_id, formatted);
          console.log(`[Bot] Backboard response — status: ${response.status}, toolCalls: ${response.toolCalls?.length || 0}, content: ${response.content ? response.content.substring(0, 100) : '(none)'}`);
          await processToolCalls(client, gc.thread_id, response, gc, currentState, chatId, dmAssistantId);
        } catch (err) {
          console.error(`[Bot] Error processing message in ${gc.name}:`, err.message);
        }

        currentState.chats[chatId].lastRowId = msg.rowid;
        saveState(currentState);
      }

      // --- Poll DM replies from each member ---
      const event = currentState.chats[chatId].event || { type: 'idle' };
      const dmBookmarks = currentState.chats[chatId].dmBookmarks || {};

      for (const member of gc.members) {
        const dmLastRowId = dmBookmarks[member.contact] || 0;
        const dmReplies = imessage.getDMReplies(member.contact, dmLastRowId);

        for (const dm of dmReplies) {
          console.log(`[Bot] DM reply from ${member.name} (${member.contact}): "${dm.text}"`);

          // Only process DM replies if we're collecting and this person has an active agent
          if (event.type === 'collecting' && event.agents && event.agents[member.contact]) {
            const agent = event.agents[member.contact];

            if (agent.status === 'chatting') {
              // Route to this person's DM Agent thread
              try {
                const response = await sendToDMAgent(client, agent.threadId, dm.text);
                console.log(`[Bot] DM Agent response for ${member.name} — status: ${response.status}, toolCalls: ${response.toolCalls?.length || 0}`);
                await processDMToolCalls(client, agent.threadId, response, member.contact, currentState, chatId, gc, dmAssistantId);
              } catch (err) {
                console.error(`[Bot] Error processing DM from ${member.name}:`, err.message);
              }
            } else {
              console.log(`[Bot] Ignoring DM from ${member.name} — agent status is "${agent.status}"`);
            }
          } else {
            console.log(`[Bot] Ignoring DM from ${member.name} — not in collecting state`);
          }

          currentState.chats[chatId].dmBookmarks[member.contact] = dm.rowid;
          saveState(currentState);
        }
      }

      // --- Check hangout threshold ---
      try {
        await checkHangoutThreshold(client, gc.thread_id, gc, currentState, chatId, dmAssistantId);
      } catch (err) {
        console.error(`[Bot] Error checking threshold for ${gc.name}:`, err.message);
      }
    }

    saveState(currentState);
  }

  // First poll immediately
  await poll();

  // Then repeat on interval, waiting for each poll to finish before scheduling next
  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await poll();
    } catch (err) {
      console.error('[Bot] Poll error:', err.message);
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL);
}
