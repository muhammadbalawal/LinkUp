import Database from 'better-sqlite3';
import { execFile } from 'child_process';
import path from 'path';
import os from 'os';

const CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

function openDb() {
  return new Database(CHAT_DB_PATH, { readonly: true, fileMustExist: true });
}

/**
 * Get recent messages from a specific chat since a given rowid.
 */
export function getRecentMessages(chatId, sinceRowId = 0) {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT
        m.ROWID as rowid,
        m.guid,
        m.text,
        m.date,
        m.is_from_me as isFromMe,
        h.id as senderHandle
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE c.chat_identifier = ?
        AND m.ROWID > ?
        AND m.text IS NOT NULL
        AND m.text != ''
      ORDER BY m.ROWID ASC
    `).all(chatId, sinceRowId);
  } finally {
    db.close();
  }
}

/**
 * Get the full chat guid (e.g. "iMessage;+;chat72506...") needed by AppleScript.
 */
export function getChatGuid(chatId) {
  const db = openDb();
  try {
    const row = db.prepare('SELECT guid FROM chat WHERE chat_identifier = ?').get(chatId);
    return row ? row.guid : chatId;
  } finally {
    db.close();
  }
}

/**
 * Send a message to a group chat via AppleScript.
 * Looks up the full chat guid since AppleScript needs it.
 */
export function sendMessage(chatId, text) {
  const chatGuid = getChatGuid(chatId);
  return new Promise((resolve, reject) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = `
      tell application "Messages"
        set targetChat to a reference to chat id "${chatGuid}"
        send "${escaped}" to targetChat
      end tell
    `;
    execFile('osascript', ['-e', script], (err, stdout, stderr) => {
      if (err) {
        console.error(`[iMessage] Failed to send to ${chatGuid}:`, stderr);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Send a DM to a specific phone number or email via AppleScript.
 */
export function sendDM(contact, text) {
  return new Promise((resolve, reject) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = `
      tell application "Messages"
        set targetBuddy to buddy "${contact}" of (service 1 whose service type is iMessage)
        send "${escaped}" to targetBuddy
      end tell
    `;
    execFile('osascript', ['-e', script], (err, stdout, stderr) => {
      if (err) {
        console.error(`[iMessage] Failed to DM ${contact}:`, stderr);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get members (handles) of a group chat.
 */
export function getGroupChatMembers(chatId) {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT h.id as handle
      FROM handle h
      JOIN chat_handle_join chj ON chj.handle_id = h.ROWID
      JOIN chat c ON c.ROWID = chj.chat_id
      WHERE c.chat_identifier = ?
    `).all(chatId);
    return rows.map(r => r.handle);
  } finally {
    db.close();
  }
}

/**
 * List all chats (for setup/discovery).
 */
export function getChatList() {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT
        c.chat_identifier as chatId,
        c.display_name as displayName,
        c.ROWID as chatRowId
      FROM chat c
      ORDER BY c.ROWID DESC
    `).all();

    const memberCountStmt = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM chat_handle_join chj
      JOIN chat c ON c.ROWID = chj.chat_id
      WHERE c.chat_identifier = ?
    `);

    return rows.map(row => {
      const { cnt } = memberCountStmt.get(row.chatId) || { cnt: 0 };
      return {
        chatId: row.chatId,
        displayName: row.displayName || '(unnamed)',
        memberCount: cnt,
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Get recent DM messages from a specific contact (their phone/email is the chat_identifier).
 * Only returns messages NOT from me (i.e. their replies).
 */
export function getDMReplies(contact, sinceRowId = 0) {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT
        m.ROWID as rowid,
        m.text,
        m.date,
        m.is_from_me as isFromMe
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = ?
        AND m.ROWID > ?
        AND m.is_from_me = 0
        AND m.text IS NOT NULL
        AND m.text != ''
      ORDER BY m.ROWID ASC
    `).all(contact, sinceRowId);
  } finally {
    db.close();
  }
}

/**
 * Get the latest ROWID from a chat (used to set initial bookmark).
 */
export function getLatestRowId(chatId) {
  const db = openDb();
  try {
    const row = db.prepare(`
      SELECT MAX(m.ROWID) as maxRowId
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = ?
    `).get(chatId);
    return row ? row.maxRowId || 0 : 0;
  } finally {
    db.close();
  }
}
