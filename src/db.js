import { MongoClient } from 'mongodb';

let client = null;
let db = null;

/**
 * Connect to MongoDB Atlas and create indexes.
 */
export async function connectDB(uri) {
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('linkup');

    // Create indexes
    await db.collection('preferences').createIndex({ groupId: 1, contact: 1 });
    await db.collection('preferences').createIndex({ groupId: 1, createdAt: -1 });
    await db.collection('hangouts').createIndex({ groupId: 1, createdAt: -1 });

    console.log('[MongoDB] Connected to Atlas and indexes ready');
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    console.log('[MongoDB] Falling back to local-only mode');
    client = null;
    db = null;
  }
}

/**
 * Guard for graceful degradation — returns true only if MongoDB is connected.
 */
export function isConnected() {
  return db !== null;
}

/**
 * Categorize an activity string into one of ~10 categories using regex matching.
 */
export function categorize(activity) {
  if (!activity) return 'other';
  const lower = activity.toLowerCase();

  const categories = [
    { name: 'food', pattern: /\b(eat|food|restaurant|dinner|lunch|brunch|tacos?|sushi|bbq|pizza|burgers?|ramen|pho|korean|thai|italian|mexican|chinese|indian|steak|wings|noodles?|cafe|bakery|dessert|ice cream|boba|coffee)\b/ },
    { name: 'movies', pattern: /\b(movie|film|cinema|theater|theatre|watch|netflix|screening|imax)\b/ },
    { name: 'sports', pattern: /\b(sport|basketball|soccer|football|tennis|volleyball|gym|workout|run|swim|hockey|baseball|golf|ski|snowboard|skating|skate)\b/ },
    { name: 'outdoors', pattern: /\b(hike|hiking|trail|park|beach|camp|camping|nature|lake|mountain|kayak|bike|biking|picnic|walk|garden)\b/ },
    { name: 'games', pattern: /\b(game|gaming|board game|video game|arcade|bowling|pool|billiard|laser tag|paintball|mini golf|go-kart|escape room|trivia|poker|chess)\b/ },
    { name: 'nightlife', pattern: /\b(bar|club|drink|party|karaoke|pub|lounge|nightclub|cocktail|brewery|wine|happy hour|dancing)\b/ },
    { name: 'chill', pattern: /\b(chill|hangout|hang out|vibe|relax|sleepover|movie night|game night|netflix|couch|house|home|potluck)\b/ },
    { name: 'shopping', pattern: /\b(shop|shopping|mall|thrift|vintage|market|flea market|outlet|store)\b/ },
    { name: 'creative', pattern: /\b(art|paint|pottery|museum|gallery|craft|diy|cooking class|workshop|music|concert|show|comedy|improv|open mic|exhibit)\b/ },
  ];

  for (const cat of categories) {
    if (cat.pattern.test(lower)) return cat.name;
  }
  return 'other';
}

/**
 * Save a preference to MongoDB. Auto-categorizes the activity.
 */
export async function savePreference({ groupId, contact, name, activity, availability, notes }) {
  if (!db) return;
  try {
    const category = categorize(activity);
    await db.collection('preferences').insertOne({
      groupId,
      contact,
      name,
      activity,
      category,
      availability,
      notes,
      createdAt: new Date(),
    });
    console.log(`[MongoDB] Saved preference for ${name}: ${activity} → ${category}`);
  } catch (err) {
    console.error('[MongoDB] Failed to save preference:', err.message);
  }
}

/**
 * Save a hangout to MongoDB. Auto-categorizes the description.
 */
export async function saveHangout({ groupId, groupName, description }) {
  if (!db) return;
  try {
    const category = categorize(description);
    await db.collection('hangouts').insertOne({
      groupId,
      groupName,
      description,
      category,
      createdAt: new Date(),
    });
    console.log(`[MongoDB] Saved hangout: ${description} → ${category}`);
  } catch (err) {
    console.error('[MongoDB] Failed to save hangout:', err.message);
  }
}

/**
 * Get group memory — the key query for personalized suggestions.
 * Returns favorites, never-tried categories, personal picks, streak info, etc.
 */
export async function getGroupMemory(groupId, contact, personName) {
  if (!db) return { hasHistory: false };

  try {
    const preferences = await db.collection('preferences').find({ groupId }).sort({ createdAt: -1 }).toArray();
    const hangouts = await db.collection('hangouts').find({ groupId }).sort({ createdAt: -1 }).toArray();

    if (preferences.length === 0 && hangouts.length === 0) {
      return { hasHistory: false };
    }

    // Group favorites — count categories across all preferences
    const categoryCounts = {};
    for (const p of preferences) {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    }
    const groupFavorites = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));

    // Never-tried categories
    const allCategories = ['food', 'movies', 'sports', 'outdoors', 'games', 'nightlife', 'chill', 'shopping', 'creative'];
    const triedCategories = new Set(Object.keys(categoryCounts));
    const hangoutCategories = new Set(hangouts.map(h => h.category));
    for (const c of hangoutCategories) triedCategories.add(c);
    const neverTried = allCategories.filter(c => !triedCategories.has(c));

    // Person's favorites
    const personPrefs = preferences.filter(p => p.contact === contact);
    const personCategoryCounts = {};
    for (const p of personPrefs) {
      personCategoryCounts[p.category] = (personCategoryCounts[p.category] || 0) + 1;
    }
    const personFavorites = Object.entries(personCategoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));

    // Check if person always picks the same thing
    let personAlwaysPicks = null;
    if (personPrefs.length >= 2) {
      const uniqueCategories = new Set(personPrefs.map(p => p.category));
      if (uniqueCategories.size === 1) {
        personAlwaysPicks = [...uniqueCategories][0];
      }
    }

    // Hangout stats
    const totalHangouts = hangouts.length;

    // Streak — count consecutive weeks with a hangout
    let streak = 0;
    if (hangouts.length > 0) {
      const now = new Date();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      let weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of current week (Sunday)

      while (true) {
        const weekEnd = new Date(weekStart.getTime() + oneWeekMs);
        const hasHangout = hangouts.some(h => {
          const d = new Date(h.createdAt);
          return d >= weekStart && d < weekEnd;
        });
        if (hasHangout) {
          streak++;
          weekStart = new Date(weekStart.getTime() - oneWeekMs);
        } else {
          break;
        }
      }
    }

    // Last hangout info
    let lastHangout = null;
    if (hangouts.length > 0) {
      const last = hangouts[0]; // Already sorted by createdAt desc
      const daysAgo = Math.floor((Date.now() - new Date(last.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      lastHangout = { description: last.description, category: last.category, daysAgo };
    }

    return {
      hasHistory: true,
      groupFavorites,
      neverTried,
      personFavorites,
      personAlwaysPicks,
      totalHangouts,
      streak,
      lastHangout,
    };
  } catch (err) {
    console.error('[MongoDB] Failed to get group memory:', err.message);
    return { hasHistory: false };
  }
}

/**
 * Lighter query for check_last_hangout enhancement — returns total + streak.
 */
export async function getHangoutStats(groupId) {
  if (!db) return null;

  try {
    const hangouts = await db.collection('hangouts').find({ groupId }).sort({ createdAt: -1 }).toArray();

    if (hangouts.length === 0) return null;

    const totalHangouts = hangouts.length;

    // Streak calculation
    let streak = 0;
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    let weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    while (true) {
      const weekEnd = new Date(weekStart.getTime() + oneWeekMs);
      const hasHangout = hangouts.some(h => {
        const d = new Date(h.createdAt);
        return d >= weekStart && d < weekEnd;
      });
      if (hasHangout) {
        streak++;
        weekStart = new Date(weekStart.getTime() - oneWeekMs);
      } else {
        break;
      }
    }

    return { totalHangouts, streak };
  } catch (err) {
    console.error('[MongoDB] Failed to get hangout stats:', err.message);
    return null;
  }
}
