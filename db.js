// FocusGen SQLite Database Manager
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'focusgen.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    is_guest INTEGER DEFAULT 0,
    guest_generations INTEGER DEFAULT 0,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    mode TEXT DEFAULT 'normal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    image_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    meta TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purpose_overrides (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    proposed_purpose TEXT NOT NULL,
    chosen_purpose TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
  CREATE INDEX IF NOT EXISTS idx_overrides_user_kw ON purpose_overrides(user_id, keyword);
`);

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
}

// User Helpers
function createUser(email, passwordHash) {
  const id = generateId();
  const defaultSettings = JSON.stringify({
    language: 'en',
    mode: 'normal',
    theme: 'dark',
    webFirst: true
  });
  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, is_guest, guest_generations, settings)
    VALUES (?, ?, ?, 0, 0, ?)
  `);
  stmt.run(id, email.toLowerCase().trim(), passwordHash, defaultSettings);
  return findUserById(id);
}

function createGuestUser() {
  const id = 'guest_' + generateId();
  const defaultSettings = JSON.stringify({
    language: 'en',
    mode: 'normal',
    theme: 'dark',
    webFirst: true
  });
  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, is_guest, guest_generations, settings)
    VALUES (?, NULL, NULL, 1, 0, ?)
  `);
  stmt.run(id, defaultSettings);
  return findUserById(id);
}

function findUserByEmail(email) {
  if (!email) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const user = stmt.get(email.toLowerCase().trim());
  if (user && user.settings) {
    try { user.settings = JSON.parse(user.settings); } catch (e) { user.settings = {}; }
  }
  return user;
}

function findUserById(id) {
  if (!id) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const user = stmt.get(id);
  if (user && user.settings) {
    try { user.settings = JSON.parse(user.settings); } catch (e) { user.settings = {}; }
  }
  return user;
}

function incrementGuestUsage(id) {
  const stmt = db.prepare('UPDATE users SET guest_generations = guest_generations + 1 WHERE id = ?');
  stmt.run(id);
  return findUserById(id);
}

function updateUserSettings(id, settings) {
  const current = findUserById(id);
  if (!current) return null;
  const merged = { ...(current.settings || {}), ...settings };
  const stmt = db.prepare('UPDATE users SET settings = ? WHERE id = ?');
  stmt.run(JSON.stringify(merged), id);
  return merged;
}

// Chat Helpers
function createChat(userId, title = 'New Chat', mode = 'normal') {
  const id = generateId();
  const stmt = db.prepare(`
    INSERT INTO chats (id, user_id, title, mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  stmt.run(id, userId, title, mode);
  return getChatById(id, userId);
}

function getChatsByUser(userId) {
  const stmt = db.prepare(`
    SELECT id, title, mode, created_at, updated_at
    FROM chats
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `);
  return stmt.all(userId);
}

function getChatById(chatId, userId) {
  const stmt = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?');
  return stmt.get(chatId, userId);
}

function renameChat(chatId, userId, newTitle) {
  const stmt = db.prepare(`
    UPDATE chats
    SET title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `);
  stmt.run(newTitle.trim(), chatId, userId);
  return getChatById(chatId, userId);
}

function deleteChat(chatId, userId) {
  const stmt = db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?');
  return stmt.run(chatId, userId);
}

function touchChat(chatId) {
  const stmt = db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(chatId);
}

// Message Helpers
function addMessage(chatId, role, content, imageData = null) {
  const id = generateId();
  const serializedImage = imageData ? JSON.stringify(imageData) : null;
  const stmt = db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, image_data, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(id, chatId, role, content, serializedImage);
  touchChat(chatId);
  return {
    id,
    chat_id: chatId,
    role,
    content,
    image_data: imageData,
    created_at: new Date().toISOString()
  };
}

function getMessagesByChat(chatId) {
  const stmt = db.prepare(`
    SELECT id, chat_id, role, content, image_data, created_at
    FROM messages
    WHERE chat_id = ?
    ORDER BY created_at ASC
  `);
  const rows = stmt.all(chatId);
  return rows.map(r => {
    let parsedImage = null;
    if (r.image_data) {
      try { parsedImage = JSON.parse(r.image_data); } catch (e) { parsedImage = null; }
    }
    return {
      ...r,
      image_data: parsedImage
    };
  });
}

// Upload Helpers
function addUpload(userId, { filename, originalName, mimeType, sizeBytes, filePath, thumbnailPath, meta = {} }) {
  const id = generateId();
  const stmt = db.prepare(`
    INSERT INTO uploads (id, user_id, filename, original_name, mime_type, size_bytes, file_path, thumbnail_path, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(id, userId, filename, originalName, mimeType, sizeBytes, filePath, thumbnailPath || null, JSON.stringify(meta));
  return getUploadById(id, userId);
}

function getUploadsByUser(userId) {
  const stmt = db.prepare(`
    SELECT id, filename, original_name, mime_type, size_bytes, thumbnail_path, meta, created_at
    FROM uploads
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  const rows = stmt.all(userId);
  return rows.map(r => {
    let parsedMeta = {};
    if (r.meta) {
      try { parsedMeta = JSON.parse(r.meta); } catch (e) { parsedMeta = {}; }
    }
    return { ...r, meta: parsedMeta };
  });
}

function getUploadById(id, userId) {
  const stmt = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?');
  const r = stmt.get(id, userId);
  if (r && r.meta) {
    try { r.meta = JSON.parse(r.meta); } catch (e) { r.meta = {}; }
  }
  return r;
}

function deleteUpload(id, userId) {
  const upload = getUploadById(id, userId);
  if (upload) {
    if (fs.existsSync(upload.file_path)) {
      try { fs.unlinkSync(upload.file_path); } catch (e) {}
    }
    if (upload.thumbnail_path && fs.existsSync(upload.thumbnail_path)) {
      try { fs.unlinkSync(upload.thumbnail_path); } catch (e) {}
    }
    const stmt = db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ?');
    stmt.run(id, userId);
    return true;
  }
  return false;
}

// Purpose Override History Helpers
function recordOverride(userId, keyword, proposedPurpose, chosenPurpose) {
  if (!userId || !keyword || !chosenPurpose) return null;
  const id = generateId();
  const stmt = db.prepare(`
    INSERT INTO purpose_overrides (id, user_id, keyword, proposed_purpose, chosen_purpose)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, userId, keyword.toLowerCase().trim(), proposedPurpose, chosenPurpose);
  return id;
}

function findRepeatedOverride(userId, keyword) {
  if (!userId || !keyword) return null;
  const stmt = db.prepare(`
    SELECT chosen_purpose, COUNT(*) as count
    FROM purpose_overrides
    WHERE user_id = ? AND keyword = ?
    GROUP BY chosen_purpose
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 1
  `);
  return stmt.get(userId, keyword.toLowerCase().trim());
}

function resetUserOverrides(userId) {
  if (!userId) return false;
  const stmt = db.prepare('DELETE FROM purpose_overrides WHERE user_id = ?');
  stmt.run(userId);
  return true;
}

function getUserOverrides(userId) {
  if (!userId) return [];
  const stmt = db.prepare('SELECT * FROM purpose_overrides WHERE user_id = ? ORDER BY created_at DESC');
  return stmt.all(userId);
}

module.exports = {
  db,
  createUser,
  createGuestUser,
  findUserByEmail,
  findUserById,
  incrementGuestUsage,
  updateUserSettings,
  createChat,
  getChatsByUser,
  getChatById,
  renameChat,
  deleteChat,
  addMessage,
  getMessagesByChat,
  addUpload,
  getUploadsByUser,
  getUploadById,
  deleteUpload,
  recordOverride,
  findRepeatedOverride,
  resetUserOverrides,
  getUserOverrides
};
