![Alt text](./LinkUp.jpg)

## Inspiration

Every friend group has the same problem: someone drops "we should hang out" in the group chat, everyone says "yeah for sure," and then... nothing happens.  
Coordinating schedules, picking an activity, and actually committing is surprisingly hard. We wanted to build something that lives right in the group chat and
does the annoying planning work for you, so you actually see your friends.

## What it does

LinkUp is an AI-powered iMessage bot that lives in your group chat. When someone says "let's hang out," LinkUp:

1. **Hypes the group** with a message acknowledging the energy
2. **Slides into everyone's DMs** individually to collect availability, activity preferences, and notes (no awkward "what works for everyone?" back-and-forth in
   the group chat)
3. **Handles indecision**: if someone says "idk," it checks the group's hangout history in MongoDB Atlas and makes personalized suggestions based on what
   they've done before and what they've never tried
4. **Searches the internet** for real venues, showtimes, menus, and booking links
5. **Drops the final plan** in the group chat with real URLs and details
6. **Remembers everything**: every preference and hangout is stored in MongoDB Atlas, so suggestions get smarter over time

It even detects scheduling conflicts and re-DMs people to negotiate a new time, and nudges the group if it's been too long since the last hangout.

## How we built it

- **Node.js** as the runtime
- \*\*We run two AI agents:
  - A **Group Agent** that manages the group chat, searches the web, and delivers plans
  - A **DM Agent** that handles 1-on-1 conversations with each member to collect preferences
- **better-sqlite3** to read the iMessage database directly on macOS, polling for new messages in group chats and DMs
- **MongoDB Atlas** for long-term memory, storing every preference and hangout with auto-categorization into categories like food, movies, sports, nightlife,
  etc.
- A **state machine** (`state.json`) for runtime state, tracking event flow (idle → collecting → ready → plan delivered), DM bookmarks, and cooldown timers

The architecture is a two-agent system: the Group Agent coordinates at the group level, while individual DM Agents have private conversations with each member.
Tool calls bridge the two: the DM Agent submits preferences, and when all are collected, the Group Agent takes over to search and plan.

## Challenges we ran into

- **Double-texting**: the AI agents sometimes wanted to send multiple messages in one turn or repeat themselves. We had to build rate limiters (max 2 messages
  per plan delivery) and nudge systems (re-prompting the agent if it responded without using any tools, since plain text responses are invisible in our
  architecture)
- **Rescheduling logic**: detecting that "Friday 2pm" and "Friday 7pm" on the same day is fine (just pick a compromise time) but "Friday" vs "Saturday" actually requires re-DMing people was a nuanced distinction to get right
- **Post-plan chaos**: after delivering a plan, group members saying "bet" or "sounds good" would re-trigger the entire planning flow. We added a 60-second
  cooldown after plan delivery to prevent this
- **iMessage integration**: reading from the macOS Messages database directly with SQLite required careful bookmark management to avoid processing the same message twice across restarts

## Accomplishments that we're proud of

- The **two-agent DM architecture**: instead of awkward group-chat polls, each person gets a private, natural conversation. It feels like texting a friend, not
  filling out a form
- **MongoDB Atlas memory**: the bot actually gets smarter over time. It knows your group always picks food, that you've never tried karaoke, and that one friend literally always picks the same thing (and roasts them for it)
- **Graceful degradation**: if MongoDB isn't configured, everything falls back seamlessly to the original flow. No crashes, no setup required
- **Real links, not hallucinated ones**: the bot searches the web and only sends URLs from actual search results. Every venue, every booking link, every trailer is real

## What we learned

- **AI orchestration is harder than AI prompting**: getting two agents to coordinate across group chats and DMs, handle edge cases, and not talk over each other was the real engineering challenge
- **Tool-calling architectures need guardrails**: without rate limits, cooldowns, and nudge systems, AI agents can spiral. Constraints make them better
- **MongoDB Atlas indexing matters**: even with small datasets, designing the right indexes upfront (compound indexes on `groupId + contact`, time-sorted indexes for recent queries) made the memory queries clean and fast
- **State machines save lives**: tracking the event flow (idle → collecting → ready → delivered) prevented so many bugs around duplicate triggers and race conditions

## What's next for LinkUp

- **Cross-platform support**: expanding beyond iMessage to WhatsApp and Discord so every friend group can use it
- **Smarter memory**: using the MongoDB history to detect patterns like "this group always hangs out on Fridays" or "these two people never agree on food" and proactively suggesting compromises
- **Recap messages**: after a hangout, the bot could ask how it went and build a group scrapbook over time
- **Budget tracking**: remembering spending preferences and suggesting activities within everyone's budget
- **Group streaks**: gamifying consistency with streak counters and milestone celebrations in the group chat
