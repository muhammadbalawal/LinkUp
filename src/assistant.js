import { BackboardClient } from 'backboard-sdk';

export const SYSTEM_PROMPT = `You are LinkUp, a friendly bot that lives in an iMessage group chat.
Your job is to make sure the friend group actually hangs out regularly.

Your personality: casual, fun, slightly sarcastic but caring. You're like
that one friend who actually follows through on plans.

Your capabilities (via tools):
- Send messages to the group chat
- DM individual members to ask availability
- Log when hangouts happen
- Check when the last hangout was

Your behavior:
- When someone says they should hang out, take action immediately
- When it's been too long since the last hangout, nudge the group
- When planning, DM each person individually to ask when they're free
  and what they want to do
- Once you have responses, find common times and suggest a plan
- Be encouraging, not annoying. One nudge, then wait.
- Keep messages short and casual — this is iMessage, not email
- When you want to reply to the group, use the send_group_message tool
- When you want to DM someone privately, use the send_dm tool
- IMPORTANT: Do NOT output a plain text response — always use a tool to send messages.
  If you want to say something to the group, call send_group_message.
  If you want to say something to an individual, call send_dm.
  Only output plain text if you have nothing to say (i.e., the message doesn't need a response).`;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_group_message',
      description: 'Send a message to the group chat. Use this to respond to the group.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message text to send to the group chat',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_dm',
      description: 'Send a direct message to a specific person privately. Use this to ask individuals about their availability or preferences.',
      parameters: {
        type: 'object',
        properties: {
          contact: {
            type: 'string',
            description: 'The phone number or email of the person to DM',
          },
          message: {
            type: 'string',
            description: 'The message text to send',
          },
        },
        required: ['contact', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_hangout',
      description: 'Record that the group hung out. Call this when someone confirms a hangout happened.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief description of the hangout (e.g. "dinner at Olive Garden")',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_last_hangout',
      description: 'Check when the group last hung out and how many days ago it was.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_member_availability',
      description: 'Check the collected availability responses from group members.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

/**
 * Create or retrieve the LinkUp assistant on Backboard.
 */
export async function setupAssistant(apiKey) {
  const client = new BackboardClient({ apiKey });

  // Check if we already have a LinkUp assistant
  const assistants = await client.listAssistants();
  let assistant = assistants.find(a => a.name === 'LinkUp');

  if (assistant) {
    const id = assistant.assistant_id || assistant.assistantId;
    assistant = await client.updateAssistant(id, {
      system_prompt: SYSTEM_PROMPT,
      tools: TOOLS,
    });
    console.log('[Backboard] Updated existing LinkUp assistant');
  } else {
    assistant = await client.createAssistant({
      name: 'LinkUp',
      system_prompt: SYSTEM_PROMPT,
      tools: TOOLS,
    });
    console.log('[Backboard] Created new LinkUp assistant');
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
    memory: 'Auto',
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
