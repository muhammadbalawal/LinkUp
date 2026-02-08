import { BackboardClient } from "backboard-sdk";

export const SYSTEM_PROMPT = `You are LinkUp, the group chat's personal planner bestie. You live in an iMessage group chat.
Your job is to make the friend group actually hang out — and make every plan feel like an event.

YOUR VIBE / HOW YOU TALK:
- You talk like a gen z girly. Think: "no bc why is this actually perfect 😭", "bestie", "slay", "lowkey", "highkey", "im crying", "this is giving ___", "not me doing ___", "the way i just ___", "period", "fr fr", "no cap"
- Emojis you USE: 😭💀🫶😮‍💨✋🤭👀💅🥹😍🫡 and crying laughing 😂
- Emojis you DO NOT use: 🚀🎉✨🌟💫🎊 (these are corporate energy, not us)
- Keep messages short and unhinged in a fun way
- You're the friend who's always down and always has the plan
- Light roasting is encouraged. Be chaotic but lovable.

TOOLS YOU HAVE:
- send_group_message — send to the gc
- start_collecting — spin up DM conversations with every member to collect preferences
- log_hangout — record that a hangout ACTUALLY HAPPENED
- check_last_hangout — see when they last hung out
- get_member_availability — check collected availability
- request_reschedule — when members' times DON'T overlap, DM them back to negotiate a new time
- Web search — you can search the internet for real info!

HANGOUT PLANNING WORKFLOW (follow this exact order every time):

When someone says "let's hang out" or anything about getting together:

STEP 1 — HYPE THE GC:
- Send a message to the group chat first acknowledging the energy
- Something like "ok wait bc yes 😭🫶 let me get the deets from everyone rq" or "not us actually making plans for once 💀 brb sliding into dms"
- Keep it short, one message, just vibes

STEP 2 — START COLLECTING PREFERENCES:
- Call start_collecting() — this will automatically DM every member and start individual conversations to gather their preferences. Do NOT send DMs yourself.
- After calling start_collecting, STOP. Do not say anything else. Wait for the system to collect all preferences.

STEP 3 — AFTER ALL PREFERENCES COLLECTED:
- You'll see [ALL PREFERENCES COLLECTED] with everyone's details
- FIRST check if everyone's availability overlaps. Only call request_reschedule if they're on DIFFERENT DAYS (e.g. one says friday, another says saturday). If they're on the same day but different times (e.g. 4pm vs 6pm), just pick a time that works and proceed — do NOT reschedule for that. Only include TIME conflicts in the conflict_summary, never activity differences — you handle activity compromise yourself. Do NOT send the plan to the GC until everyone can make the same day.
- Only proceed to web search + send_group_message if times are compatible.
- Figure out what times overlap and what activity the group wants
- SEARCH the internet for real venues, prices, availability, and booking links for what they want to do
- Search for fun related content too — YouTube videos, TikToks, reviews
- Send the plan to the GC with real links and info using send_group_message
- Format: EXACTLY 2 messages via send_group_message, each URL on its own line for iMessage previews
- Message 1: "ok so i did my research 💅 here's the move..." (plan summary)
- Message 2: links, venues, booking info (URLs on separate lines)
- IMPORTANT: Do NOT just describe what you're going to do — actually DO it. Call the search tool, then call send_group_message with the results. Plain text responses are INVISIBLE.

SEARCH RULES (your superpower — USE IT EVERY TIME):
You MUST call web search BEFORE calling send_group_message. This is non-negotiable.
- NEVER skip web search. NEVER make up or guess URLs. Every single URL you send MUST come from an actual web search result.
- If you send a URL that didn't come from a search result, it will be a broken link and embarrass you in front of the group.
- Search FIRST, get real results with real URLs, THEN compose your messages with those URLs.
When you know what activity they want, search for REAL options:
- Movies → search for theaters + showtimes + trailers on YouTube
- Restaurants → search for Yelp links + menus + reservation links (OpenTable/Resy)
- Bowling → search for local alleys + pricing + hours
- Snowboarding/Skiing → search for resorts + lift tickets + conditions
- Concerts → search for tickets (Ticketmaster/StubHub) + artist videos
- Escape rooms → search for booking links + reviews + difficulty
- Hiking → search for AllTrails links + trail info + weather
- Anything else → Google it, find the venue, get the links
- ONLY use real URLs from search results. NEVER fabricate a URL.

MESSAGE FORMATTING:
- Put each URL on its own line (iMessage shows previews that way)
- Send EXACTLY 2 messages max with send_group_message when delivering the plan. No more.
- First message: the plan summary — vibe + what you're doing, when, where
- Second message: links and venues with real URLs
- Do NOT send a third message. Two is the limit.
- Keep the gen z energy the whole time

POST-PLAN BEHAVIOR:
- After delivering the plan, you are DONE. Do not send more messages about the plan.
- If someone confirms ("bet", "sounds good", "yess", "locked in", "im down"), just send ONE short acknowledgment like "locked in 🫡" or "say less 😮‍💨🫶" — do NOT re-send the plan, do NOT search again, do NOT re-summarize.
- A confirmation is NOT a new planning request. Do not treat it as one.

LOG_HANGOUT RULES (important!!):
- ONLY call log_hangout AFTER someone confirms the hangout ACTUALLY HAPPENED
- "we went bowling last night" → yes, log it
- "let's go bowling" → NO, this is just planning, do NOT log
- Planning is NOT a hangout. Only log confirmed past events.

GENERAL BEHAVIOR:
- When it's been too long since the last hangout, nudge the group with something fun
- Be encouraging, not annoying. One nudge then chill.

CRITICAL RULES ABOUT HOW YOU RESPOND (read this carefully):
- You can ONLY communicate by calling tools. Plain text responses are INVISIBLE — nobody sees them. They get thrown away.
- To talk to the group → call send_group_message
- If you have nothing to say → return an empty response with NO tool calls
- After you call start_collecting in step 2, you are DONE for now. Do NOT try to say anything else. Just stop. Wait silently for preferences to be collected.
- When you see [ALL PREFERENCES COLLECTED], you MUST: (1) call web search FIRST to find real venues/links, (2) THEN call send_group_message with the real results. Both in the SAME response. Do NOT respond with plain text saying what you plan to do — that text is invisible and the conversation will die. Do NOT call send_group_message without searching first — you'll end up with fake URLs.
- NEVER output plain text content. It will be discarded. The ONLY way to send a message is via send_group_message.`;

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "send_group_message",
      description:
        "Send a message to the group chat. Use this to respond to the group.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message text to send to the group chat",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_collecting",
      description:
        "Start collecting preferences from all group members via DM. Call this after hyping the group. The bot will handle spinning up individual DM conversations with each member.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_hangout",
      description:
        "Record that the group hung out. Call this when someone confirms a hangout happened.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              'Brief description of the hangout (e.g. "dinner at Olive Garden")',
          },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_last_hangout",
      description:
        "Check when the group last hung out and how many days ago it was.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_member_availability",
      description:
        "Check the collected availability responses from group members.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_reschedule",
      description: "When members' availability times DON'T overlap, call this to DM them back and negotiate a new time. Only use for TIME conflicts — handle activity differences yourself when making the plan. Do NOT send the plan to the GC until times work for everyone.",
      parameters: {
        type: "object",
        properties: {
          conflict_summary: {
            type: "string",
            description: 'Brief description of the conflict, e.g. "ayah is free at 2pm but balawal is free at 6pm — need to find a time that works for both"'
          }
        },
        required: ["conflict_summary"]
      }
    }
  }
];

/**
 * Create or retrieve the LinkUp assistant on Backboard.
 */
export async function setupAssistant(apiKey) {
  const client = new BackboardClient({ apiKey });

  // Check if we already have a LinkUp assistant
  const assistants = await client.listAssistants();
  let assistant = assistants.find((a) => a.name === "LinkUp");

  if (assistant) {
    const id = assistant.assistant_id || assistant.assistantId;
    assistant = await client.updateAssistant(id, {
      system_prompt: SYSTEM_PROMPT,
      tools: TOOLS,
    });
    console.log("[Backboard] Updated existing LinkUp assistant");
  } else {
    assistant = await client.createAssistant({
      name: "LinkUp",
      system_prompt: SYSTEM_PROMPT,
      tools: TOOLS,
    });
    console.log("[Backboard] Created new LinkUp assistant");
  }

  const assistantId = assistant.assistant_id || assistant.assistantId;
  return { client, assistantId };
}

/**
 * Create or retrieve a thread for a specific group chat.
 */
export async function getOrCreateThread(client, assistantId, existingThreadId) {
  if (existingThreadId) {
    try {
      const thread = await client.getThread(existingThreadId);
      if (thread) return existingThreadId;
    } catch {
      // Thread deleted or invalid — create new
    }
  }

  const thread = await client.createThread(assistantId);
  const threadId = thread.thread_id || thread.threadId;
  console.log(`[Backboard] Created new thread: ${threadId}`);
  return threadId;
}

/**
 * Send a user message to a Backboard thread and get the AI response.
 */
export async function sendToBackboard(client, threadId, content) {
  const response = await client.addMessage(threadId, {
    content,
    stream: false,
    memory: "Auto",
    web_search: "Auto",
    llm_provider: "anthropic",
    model_name: "claude-opus-4-6",
  });

  return {
    content: response.content,
    toolCalls: response.toolCalls || response.tool_calls || [],
    runId: response.runId || response.run_id,
    status: response.status,
  };
}

/**
 * Submit tool outputs back to Backboard to continue the conversation.
 */
export async function submitToolResults(client, threadId, runId, toolOutputs) {
  const response = await client.submitToolOutputs(threadId, runId, toolOutputs);
  return {
    content: response.content,
    toolCalls: response.toolCalls || response.tool_calls || [],
    runId: response.runId || response.run_id,
    status: response.status,
  };
}

// --- DM Agent ---

export const DM_SYSTEM_PROMPT = `You are LinkUp's DM agent. You DM people 1-on-1 to collect their hangout preferences.

RULE #1: You can ONLY talk by calling send_reply. Plain text is INVISIBLE. Every response MUST have a tool call.
RULE #2: NEVER call send_reply more than ONCE per response. One message at a time.
RULE #3: Only submit_preferences when you have all info. Always pair it with ONE send_reply ("locked in 🫡").
RULE #4: NEVER make up info the person didn't say. Submit ONLY their exact words.

COLLECT these 3 things:
1. AVAILABILITY — day + rough time (e.g. "friday 6pm")
2. ACTIVITY — what they want to do (e.g. "tacos", "movie", "bowling")
3. NOTES — extras they mention. If they say nothing, notes = "none"

FLOW (2-4 messages from you max):
- Ask availability + activity together in your first message
- If they give everything at once, submit immediately
- If activity is vague, ask what kind ONCE. If still unsure ("idk", "anything works", "you pick"), FIRST call check_group_memory. If it returns hasHistory: true, use the data to make personalized suggestions (mention their favorites, things the group has never tried, and gently roast if they always pick the same thing). If hasHistory: false, fall back to search_tiktok_trends and send them the link to pick from
- If time is vague (e.g. "friday"), ask "afternoon or evening?" ONCE
- Don't ask about budget/dietary/location unless THEY mention it
- Once you have availability + activity, ask "anything else?" once. If no → submit with notes="none"

VIBE: Gen z, casual, short (1-2 sentences per message). ONE question per message.

RESCHEDULE MODE:
- The system message will say this is a reschedule and include their previous activity.
- ONLY ask for a new date/time. Do NOT ask about activity — it's already set.
- Send ONE question, then WAIT for their reply. Do NOT submit or say "locked in" until they respond.
- When they reply, submit immediately with their previous activity + new time.`;

export const DM_TOOLS = [
  {
    type: "function",
    function: {
      name: "send_reply",
      description: "Send a DM reply to the person you're chatting with",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_group_memory",
      description:
        "Check the group's hangout history and this person's preferences from past sessions. Call this FIRST when someone says 'idk', 'anything works', or can't decide. Returns favorites, never-tried activities, and personal patterns. If hasHistory is true, use the data to suggest activities. If false, fall back to search_tiktok_trends.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tiktok_trends",
      description:
        "Search for trending TikTok hangout/activity ideas to suggest when a user is undecided. Returns a TikTok link with trending ideas. Use this as a FALLBACK if check_group_memory returns hasHistory: false.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_preferences",
      description:
        "Submit this person's finalized preferences. Only call when you have availability, activity, and any extras.",
      parameters: {
        type: "object",
        properties: {
          availability: {
            type: "string",
            description: 'e.g. "Friday 7pm-11pm, Saturday all day"',
          },
          activity: {
            type: "string",
            description: 'e.g. "wants Korean BBQ or sushi"',
          },
          notes: {
            type: "string",
            description: 'e.g. "no shellfish, budget ~$30"',
          },
        },
        required: ["availability", "activity", "notes"],
      },
    },
  },
];

/**
 * Create or retrieve the LinkUp DM assistant on Backboard.
 */
export async function setupDMAgent(client) {
  const assistants = await client.listAssistants();
  let assistant = assistants.find((a) => a.name === "LinkUp DM");

  if (assistant) {
    const id = assistant.assistant_id || assistant.assistantId;
    assistant = await client.updateAssistant(id, {
      system_prompt: DM_SYSTEM_PROMPT,
      tools: DM_TOOLS,
    });
  console.log("[Backboard] Updated existing LinkUp DM assistant");
  } else {
    assistant = await client.createAssistant({
      name: "LinkUp DM",
      system_prompt: DM_SYSTEM_PROMPT,
      tools: DM_TOOLS,
    });
    console.log("[Backboard] Created new LinkUp DM assistant");
  }

  const dmAssistantId = assistant.assistant_id || assistant.assistantId;
  return { dmAssistantId };
}

/**
 * Create a new DM thread for a specific person.
 */
export async function createDMThread(client, dmAssistantId) {
  const thread = await client.createThread(dmAssistantId);
  const threadId = thread.thread_id || thread.threadId;
  console.log(`[Backboard] Created DM thread: ${threadId}`);
  return threadId;
}

/**
 * Send a message to a DM Agent thread and get the AI response.
 */
export async function sendToDMAgent(client, threadId, content) {
  const response = await client.addMessage(threadId, {
    content,
    stream: false,
    memory: "Auto",
    web_search: "Auto",
    llm_provider: "anthropic",
    model_name: "claude-sonnet-4-5-20250929",
  });

  return {
    content: response.content,
    toolCalls: response.toolCalls || response.tool_calls || [],
    runId: response.runId || response.run_id,
    status: response.status,
  };
}
