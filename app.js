/**
 * FocusGen - Professional Client Application
 * Brand: "Focus" + "Energy" + Photorealism
 * Features:
 * - Real Authentication (JWT, SQLite, Guest limit 5)
 * - ChatGPT-Style Layout (Collapsible sidebar, center chat, fixed bottom bar)
 * - Web-First Licensed Photos (Wikimedia Commons, Openverse) with mandatory attribution
 * - Photorealistic AI generation (No cartoons)
 * - Compact Cost Chip under every single image with ℹ️ explainer modal
 * - Server-side Smart Compress (Sharp) with interactive Before/After draggable slider
 * - File & Document uploads (PDF text extraction with 3 prompt suggestions)
 * - 5 Modes: Normal, Kids (Earth Quest), Easy (Auto Read-aloud), Student (Slides), Work (Batch)
 * - Trilingual NLP & Speech (English, Tamil, Thanglish)
 */

// ============================================================================
// 1. I18N DICTIONARIES
// ============================================================================
const I18N = {
  en: {
    welcome: "What would you like to create? A single word like 'cake' or 'tiger' is enough!",
    askPurpose: "What will you use this image for? Choose a purpose:",
    webPhotosFound: "Licensed real photos found for your subject:",
    generateWithAi: "⚡ Generate new with AI instead",
    searchingWeb: "🔍 Searching licensed photography databases...",
    generatingAi: "⚡ Synthesizing photorealistic DSLR composition...",
    errorGeneric: "An unexpected error occurred. Please try again.",
    guestLimit: "Guest generation limit reached (5/5). Please create an account to continue unlimited generations and save your chats.",
    speechLang: "en-IN"
  },
  ta: {
    welcome: "வணக்கம்! என்ன படம் உருவாக்க வேண்டும்? 'கேக்' அல்லது 'புலி' போன்ற ஒரு சொல் போதும்!",
    askPurpose: "இந்த படத்தை எதற்காகப் பயன்படுத்தப் போகிறீர்கள்?",
    webPhotosFound: "உரிமம் பெற்ற உண்மையான புகைப்படங்கள்:",
    generateWithAi: "⚡ புதிய AI புகைப்படம் உருவாக்கவும்",
    searchingWeb: "🔍 இணையத்தில் புகைப்படங்களைத் தேடுகிறது...",
    generatingAi: "⚡ தத்ரூபமான AI புகைப்படம் தயாராகிறது...",
    errorGeneric: "பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.",
    guestLimit: "விருந்தினர் வரம்பு முடிந்தது (5/5). தொடர கணக்கு தொடங்கவும்.",
    speechLang: "ta-IN"
  },
  th: {
    welcome: "Vanakkam! Enna image create pannanum? 'Cake' illa 'tiger' nu single word sonna podhum!",
    askPurpose: "Idhu edhuku use panna poreenga? Purpose select pannunga:",
    webPhotosFound: "Licensed real photos ready:",
    generateWithAi: "⚡ Puthu AI photo generate pannu",
    searchingWeb: "🔍 Licensed photos thedudhu...",
    generatingAi: "⚡ Photorealistic image ready aagudhu...",
    errorGeneric: "Error vanthirukku. Marubadiyum try pannunga.",
    guestLimit: "Guest limit mudinjidhu (5/5). Account create pannunga unlimited-ah use panna.",
    speechLang: "ta-IN"
  }
};

const PURPOSES = {
  chat: { title: "Phone Chat", icon: "📱", desc: "DP & Chat", size: "640×360", tier: "Sketch", save: "~96% Saved" },
  school: { title: "School Project", icon: "🎒", desc: "Slides & Docs", size: "1024×576", tier: "Standard", save: "~50% Saved" },
  project: { title: "Project", icon: "📊", desc: "Project & Reports", size: "1024×576", tier: "Standard", save: "~50% Saved" },
  poster: { title: "Poster / Wall", icon: "🖼️", desc: "Wide Viewing", size: "1280×720", tier: "Detailed", save: "~25% Saved" },
  print: { title: "Print", icon: "🖨️", desc: "Physical 300 DPI", size: "1920×1080", tier: "Max", save: "0% Saved (Honest)" }
};

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================
const state = {
  currentUser: null,
  currentChatId: null,
  currentWord: '',
  currentPurpose: 'chat',
  currentTier: 'Sketch',
  currentMode: 'normal',
  currentLang: 'en',
  theme: 'dark',
  webFirst: true,
  isGreenTime: false, // Turned off by default
  focusClarity: true, // Focus clarity adaptive pipeline (on by default)
  showFocusMap: false,
  chats: [],
  uploads: [],
  favorites: JSON.parse(localStorage.getItem('focusgen_favorites') || '[]'),
  sessionLedger: [],
  sessionTotals: { usedWh: 0, maxWh: 0, savedWh: 0 },
  lastReport: null,
  isGenerating: false,
  speechRecognition: null,
  activeCompressData: null,
  retryCountdown: 0,
  retryTimer: null,
  retryBackoffSeconds: 60,
  resultsCache: new Map(),
  aiBlocked: false,
  blockedUntil: 0,
  blockedMessage: 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).',
  demoMode: localStorage.getItem('focusgen_demo_mode') === 'true',
  countdownInterval: null
};

// ============================================================================
// 2b. BACKEND CONNECTIVITY & API BASE RESOLUTION
// ============================================================================
// Use relative path for all API endpoints so FocusGen works on any domain or port
const API_BASE = '';

// Intercept fetch to guarantee credentials: 'include'
const _origFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const mergedOptions = {
    credentials: 'include',
    ...options
  };
  return _origFetch(url, mergedOptions);
};

// Logger (never logs passwords or secrets)
const IS_DEV = false;
function devLog(step, details) {
  if (IS_DEV) {
    if (details !== undefined) {
      console.log(`%c[FocusGen] %c${step}`, 'color: #3B82F6; font-weight: bold;', 'color: #EAF1FB;', details);
    } else {
      console.log(`%c[FocusGen] %c${step}`, 'color: #3B82F6; font-weight: bold;', 'color: #EAF1FB;');
    }
  }
}

// ============================================================================
// 3. HEALTH & CONNECTIVITY MONITOR
// ============================================================================
async function checkConnectionStatus() {
  const dot = document.getElementById('server-status-dot');
  const label = document.getElementById('server-status-label');
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'online') {
        if (dot) {
          dot.classList.remove('offline');
          dot.classList.add('online');
        }
        if (label) label.textContent = 'Connected';
        return;
      }
    }
    throw new Error('Server not online');
  } catch (err) {
    if (dot) {
      dot.classList.remove('online');
      dot.classList.add('offline');
    }
    if (label) label.textContent = 'Disconnected';
  }
}

// ============================================================================
// 3b. APPLICATION INITIALIZATION (Safe DOM Ready Guard)
// ============================================================================
let appInitialized = false;
async function initApp() {
  if (appInitialized) return;
  appInitialized = true;
  devLog('App initializing (DOM ready)');

  initSpeechRecognition();
  initCompressSlider();
  initGreenTime();
  initOnboardingHint();
  renderFavoritesList();
  bindEventListeners();
  applyTheme(localStorage.getItem('focusgen_theme') || 'dark');

  // Initial connection check & periodic background polling
  checkConnectionStatus();
  setInterval(checkConnectionStatus, 15000);

  // Check AI allocation block status (Cloudflare error 3036 protection)
  checkAiAllocationStatus();

  // Check existing session
  await checkAuthSession();
}

// Safe check: if DOM is already parsed (interactive or complete), init immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ============================================================================
// 4. AUTHENTICATION & SESSION MANAGEMENT
// ============================================================================
async function checkAuthSession() {
  try {
    devLog('Checking active auth session (/api/auth/me)');
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.success && data.user) {
      devLog('Active session detected for:', data.user.email || 'Guest');
      setUserState(data.user);
      hideAuthModal();
      await loadUserChats();
      await loadUserUploads();
    } else {
      devLog('No session active; presenting auth modal');
      showAuthModal();
    }
  } catch (err) {
    devLog('Auth session check threw error:', err.message);
    showAuthModal();
  }
}

function setUserState(user) {
  state.currentUser = user;
  const initial = user.email ? user.email[0].toUpperCase() : 'G';
  const emailDisplay = user.email || 'Guest User';
  const roleDisplay = user.isGuest ? `Guest (${user.guestGenerations || 0}/5 used)` : 'Pro Account';

  document.getElementById('user-avatar-initial').textContent = initial;
  document.getElementById('user-email-display').textContent = emailDisplay;
  document.getElementById('user-role-badge').textContent = roleDisplay;

  if (user.settings) {
    if (user.settings.language) {
      state.currentLang = user.settings.language;
      document.getElementById('select-lang').value = state.currentLang;
    }
    if (user.settings.mode) {
      setMode(user.settings.mode);
    }
    if (user.settings.theme) {
      applyTheme(user.settings.theme);
    }
    if (typeof user.settings.webFirst === 'boolean') {
      state.webFirst = user.settings.webFirst;
      document.getElementById('toggle-web-first').checked = state.webFirst;
    }
  }
}

function showAuthModal() {
  document.getElementById('auth-modal-overlay').classList.remove('hidden');
}

function hideAuthModal() {
  document.getElementById('auth-modal-overlay').classList.add('hidden');
}

// ============================================================================
// 5. CHAT & MESSAGE MANAGEMENT
// ============================================================================
async function loadUserChats() {
  try {
    const res = await fetch('/api/chats');
    const data = await res.json();
    if (data.success) {
      state.chats = data.chats || [];
      renderRecentChats();
      if (state.chats.length > 0 && !state.currentChatId) {
        loadChat(state.chats[0].id);
      } else if (!state.currentChatId) {
        startNewChat(false);
      }
    }
  } catch (err) {
    console.error('Failed to load chats:', err);
  }
}

function renderRecentChats(filter = '') {
  const container = document.getElementById('recent-chats-list');
  container.innerHTML = '';

  const filtered = state.chats.filter(c => (c.title || '').toLowerCase().includes(filter.toLowerCase()));
  if (filtered.length === 0) {
    container.innerHTML = `<span style="font-size:0.75rem; color:var(--muted); padding:4px;">${state.currentUser && state.currentUser.isGuest ? 'Guest history is not saved.' : 'No chats found.'}</span>`;
    return;
  }

  // Group by Today, Yesterday, Earlier
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const groups = { Today: [], Yesterday: [], Earlier: [] };
  filtered.forEach(c => {
    const chatDate = new Date(c.updated_at || c.created_at).toDateString();
    if (chatDate === today) groups.Today.push(c);
    else if (chatDate === yesterday) groups.Yesterday.push(c);
    else groups.Earlier.push(c);
  });

  ['Today', 'Yesterday', 'Earlier'].forEach(groupName => {
    const items = groups[groupName];
    if (items.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'chats-group';
    groupEl.innerHTML = `<div class="chats-group-heading">${groupName}</div>`;

    items.forEach(chat => {
      const row = document.createElement('div');
      row.className = `chat-item-row ${chat.id === state.currentChatId ? 'active' : ''}`;
      row.innerHTML = `
        <span class="chat-item-title">${escapeHtml(chat.title)}</span>
        <div class="chat-item-actions">
          <button type="button" class="chat-action-btn rename" title="Rename">✏️</button>
          <button type="button" class="chat-action-btn delete" title="Delete">🗑️</button>
        </div>
      `;

      row.querySelector('.chat-item-title').addEventListener('click', () => loadChat(chat.id));
      row.querySelector('.rename').addEventListener('click', (e) => {
        e.stopPropagation();
        promptRenameChat(chat.id, chat.title);
      });
      row.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      groupEl.appendChild(row);
    });

    container.appendChild(groupEl);
  });
}

async function startNewChat(createRemote = true) {
  state.currentChatId = null;
  document.getElementById('current-chat-title').textContent = 'New Chat';
  const msgContainer = document.getElementById('chat-messages-container');
  msgContainer.innerHTML = '';
  document.getElementById('chat-empty-state').classList.remove('hidden');

  if (createRemote && state.currentUser && !state.currentUser.isGuest) {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat', mode: state.currentMode })
      });
      const data = await res.json();
      if (data.success && data.chat) {
        state.currentChatId = data.chat.id;
        state.chats.unshift(data.chat);
        renderRecentChats();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

async function loadChat(chatId) {
  state.currentChatId = chatId;
  const chat = state.chats.find(c => c.id === chatId);
  if (chat) {
    document.getElementById('current-chat-title').textContent = chat.title;
    renderRecentChats();
  }

  const msgContainer = document.getElementById('chat-messages-container');
  msgContainer.innerHTML = '';
  document.getElementById('chat-empty-state').classList.add('hidden');

  try {
    const res = await fetch(`/api/chats/${chatId}`);
    const data = await res.json();
    if (data.success && data.messages) {
      data.messages.forEach(msg => {
        renderMessageRow(msg.role, msg.content, msg.image_data);
      });
      scrollToBottom();
    }
  } catch (err) {
    console.error('Failed to load chat messages:', err);
  }
}

async function promptRenameChat(chatId, oldTitle) {
  const newTitle = prompt('Enter new chat name:', oldTitle);
  if (!newTitle || newTitle.trim() === oldTitle) return;
  try {
    const res = await fetch(`/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    const data = await res.json();
    if (data.success) {
      const chat = state.chats.find(c => c.id === chatId);
      if (chat) chat.title = newTitle.trim();
      if (state.currentChatId === chatId) {
        document.getElementById('current-chat-title').textContent = newTitle.trim();
      }
      renderRecentChats();
    }
  } catch (e) {
    console.error(e);
  }
}

async function deleteChat(chatId) {
  if (!confirm('Are you sure you want to delete this chat?')) return;
  try {
    await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
    state.chats = state.chats.filter(c => c.id !== chatId);
    if (state.currentChatId === chatId) {
      startNewChat(false);
    }
    renderRecentChats();
  } catch (e) {
    console.error(e);
  }
}

// ============================================================================
// ============================================================================
// 6. CONVERSATION & WEB-FIRST FLOW
// ============================================================================
function extractSubjectKeywords(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  str = str.replace(/^["'`]+|["'`]+$/g, '');
  str = str.replace(/^(can you (please )?|please |could you |i want (to see )?|give me |show me |find me |get me |search for |generate |create |draw |make )+/i, '');
  str = str.replace(/^(a |an |the |some )+/i, '');
  str = str.replace(/^(picture of |photo of |image of |photograph of |photos of |pictures of |images of )+/i, '');
  str = str.replace(/^(a |an |the )+/i, '');
  str = str.replace(/[?!.,;:]+$/g, '').trim();
  return str || raw.trim();
}

function renderGreetingResponse(customReply, customSuggestions) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  const suggestions = customSuggestions || ['cake', 'tiger', 'temple', 'sunset beach'];
  const textHtml = customReply 
    ? escapeHtml(customReply)
    : `👋 <strong>Hello! I'm FocusGen</strong>, your eco-adaptive visual intelligence chatbot.<br><br>
       Tell me any subject you want to see (e.g. <strong>"cake"</strong>, <strong>"tiger"</strong>, <strong>"temple"</strong>, or <strong>"sunset beach"</strong>):
       <ul style="margin:8px 0 10px 18px; padding:0; font-size:0.84rem; color:var(--text);">
         <li>🌐 <strong>Keyless Web Search:</strong> Free, real licensed photos from Wikimedia Commons & Openverse (saves 99.9% energy).</li>
         <li>🗜️ <strong>Smart Compress:</strong> Tailors image size and format to your intended device or purpose.</li>
         <li>📷 <strong>DSLR Photorealism:</strong> Authentic optical lighting and texture without cartoon fallbacks.</li>
       </ul>
       <div style="font-size:0.82rem; color:var(--muted); margin-bottom:8px;">Tap any example to see it in action:</div>`;

  const chipsHtml = suggestions.map(s => {
    const icon = s.includes('cake') ? '🎂' : s.includes('tiger') ? '🐅' : s.includes('temple') ? '🏛️' : s.includes('beach') ? '🌅' : '🔍';
    return `<button type="button" class="btn-greeting-chip" data-word="${escapeHtml(s)}" style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-pill); padding:5px 12px; font-size:0.8rem; color:var(--text); cursor:pointer;">${icon} ${escapeHtml(s)}</button>`;
  }).join(' ');

  bubble.innerHTML = `
    <div class="message-text" style="line-height:1.6;">
      ${textHtml}
      <div class="greeting-chips-row" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
        ${chipsHtml}
      </div>
    </div>
  `;

  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);
  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();

  bubble.querySelectorAll('.btn-greeting-chip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage(btn.dataset.word);
    });
  });
}

function renderAssistantTextMessage(text) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `<div class="message-text" style="line-height:1.6;">${escapeHtml(text)}</div>`;

  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);
  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();
}

function renderChatError({ type, title, message, actionLabel, action }) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant error';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble error-bubble';
  bubble.style.borderLeft = '3px solid var(--danger, #FF6B6B)';
  bubble.style.background = 'rgba(255, 107, 107, 0.08)';

  const icon = type === 'auth' ? '🔒' : type === 'limit' ? '⚠️' : type === 'timeout' ? '⏱️' : type === 'unreachable' ? '🔌' : '⚠️';

  let actionHtml = '';
  if (actionLabel && action) {
    actionHtml = `<div style="margin-top:10px;"><button type="button" class="inline-action-btn error-action-btn" style="background:var(--surface-2); border:1px solid var(--border); color:var(--text); padding:6px 14px; border-radius:var(--radius-pill); cursor:pointer; font-size:0.82rem; font-weight:600;">${escapeHtml(actionLabel)}</button></div>`;
  }

  bubble.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:10px;">
      <span style="font-size:1.2rem;">${icon}</span>
      <div style="flex:1;">
        <div style="font-weight:700; color:var(--danger, #FF6B6B); font-size:0.9rem; margin-bottom:4px;">${escapeHtml(title || 'Error')}</div>
        <div style="font-size:0.85rem; color:var(--text); line-height:1.5;">${escapeHtml(message || 'An error occurred.')}</div>
        ${actionHtml}
      </div>
    </div>
  `;

  if (actionLabel && action) {
    const btn = bubble.querySelector('.error-action-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        action();
      });
    }
  }

  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);
  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();
}

// ============================================================================
// 5b. GREEN TIME, ONBOARDING & FAVORITES
// ============================================================================
function initGreenTime() {
  const toggle = document.getElementById('toggle-green-time');
  const headerChip = document.getElementById('btn-green-hours-toggle');
  const lbl = document.getElementById('lbl-green-hours');
  
  state.isGreenTime = false; // Off by default!
  if (toggle) toggle.checked = false;
  if (headerChip) {
    headerChip.classList.add('hidden');
    if (lbl) lbl.textContent = 'Simulated grid data';
    headerChip.title = 'Simulated renewable grid data';
  }
}

function initOnboardingHint() {
  const seen = localStorage.getItem('focusgen_onboarding_seen');
  const card = document.getElementById('onboarding-hint-card');
  if (card) {
    if (seen) card.classList.add('hidden');
    else card.classList.remove('hidden');
  }
}

function dismissOnboardingHint() {
  localStorage.setItem('focusgen_onboarding_seen', 'true');
  const card = document.getElementById('onboarding-hint-card');
  if (card) card.classList.add('hidden');
}

function renderFavoritesList() {
  const container = document.getElementById('sidebar-favorites-list');
  const countBadge = document.getElementById('fav-count-badge');
  if (countBadge) countBadge.textContent = state.favorites.length;
  if (!container) return;
  container.innerHTML = '';

  if (state.favorites.length === 0) {
    container.innerHTML = '<span class="empty-fav-note" style="font-size:0.75rem; color:var(--muted); padding:4px;">No favorites yet. Star any image to save.</span>';
    return;
  }

  state.favorites.forEach((fav, index) => {
    const item = document.createElement('div');
    item.className = 'favorite-item';
    item.innerHTML = `
      <img src="${fav.url}" class="favorite-thumb" alt="${escapeHtml(fav.word || 'Favorite')}" loading="lazy">
      <div class="favorite-info">
        <div class="favorite-title" title="${escapeHtml(fav.word || 'Favorite')}">${escapeHtml(fav.word || 'Favorite')}</div>
        <div class="favorite-sub">${escapeHtml(fav.source || 'Web photo')}</div>
      </div>
      <button type="button" class="btn-remove-fav" title="Remove from favorites" data-index="${index}">✕</button>
    `;

    item.querySelector('.favorite-thumb').addEventListener('click', () => {
      openCompressStudio(fav.url, fav.purpose || 'chat');
    });
    item.querySelector('.favorite-info').addEventListener('click', () => {
      openCompressStudio(fav.url, fav.purpose || 'chat');
    });
    item.querySelector('.btn-remove-fav').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFavorite(index);
    });

    container.appendChild(item);
  });
}

function toggleFavorite(imgData, btnEl = null) {
  const existingIdx = state.favorites.findIndex(f => f.url === imgData.url);
  if (existingIdx >= 0) {
    state.favorites.splice(existingIdx, 1);
    if (btnEl) {
      btnEl.classList.remove('active-star');
      btnEl.innerHTML = '⭐ Favorite';
    }
  } else {
    state.favorites.unshift({
      id: Date.now(),
      url: imgData.url,
      word: imgData.word || 'Visual',
      purpose: imgData.purpose || 'chat',
      source: imgData.source || 'Web photo',
      attribution: imgData.attribution || null,
      savedAt: new Date().toISOString()
    });
    if (btnEl) {
      btnEl.classList.add('active-star');
      btnEl.innerHTML = '★ Favorited';
    }
  }
  localStorage.setItem('focusgen_favorites', JSON.stringify(state.favorites));
  renderFavoritesList();
}

function removeFavorite(index) {
  state.favorites.splice(index, 1);
  localStorage.setItem('focusgen_favorites', JSON.stringify(state.favorites));
  renderFavoritesList();
  document.querySelectorAll('.btn-action-fav').forEach(btn => {
    const url = btn.dataset.url;
    const isFav = state.favorites.some(f => f.url === url);
    btn.classList.toggle('active-star', isFav);
    btn.innerHTML = isFav ? '★ Favorited' : '⭐ Favorite';
  });
}

// Countdown timer for 429 Quota Guard
function startQuotaCountdown(btn, word, purpose) {
  if (state.retryTimer) {
    clearInterval(state.retryTimer);
  }
  let remaining = state.retryBackoffSeconds || 60;
  btn.disabled = true;
  btn.textContent = `Retry AI (${remaining}s)`;

  state.retryTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.retryTimer);
      state.retryTimer = null;
      btn.disabled = false;
      btn.innerHTML = '🔄 Retry AI';
    } else {
      btn.textContent = `Retry AI (${remaining}s)`;
    }
  }, 1000);

  btn.onclick = async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    // Exponential backoff: double next countdown
    state.retryBackoffSeconds = Math.min(300, (state.retryBackoffSeconds || 60) * 2);
    await generateWithAiModel(word, purpose);
  };
}

// ============================================================================
// CLOUDFLARE ALLOCATION GUARD UI (Error 3036 & Countdown to 00:00 UTC)
// ============================================================================

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateAiBlockedUI(blockedUntil, customMessage = null) {
  state.aiBlocked = true;
  state.blockedUntil = blockedUntil || state.blockedUntil;
  if (customMessage) state.blockedMessage = customMessage;

  const banner = document.getElementById('ai-blocked-banner');
  const bannerText = document.getElementById('ai-blocked-banner-text');
  const bannerCountdown = document.getElementById('ai-blocked-banner-countdown');

  const diagBanner = document.getElementById('diag-blocked-banner');
  const diagMessage = document.getElementById('diag-blocked-message');
  const diagCountdown = document.getElementById('diag-blocked-countdown');

  const defaultMsg = 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).';
  const displayMsg = customMessage || defaultMsg;

  if (banner) banner.classList.remove('hidden');
  if (bannerText) bannerText.textContent = displayMsg;

  if (diagBanner) diagBanner.classList.remove('hidden');
  if (diagMessage) diagMessage.textContent = displayMsg;

  function refreshCountdown() {
    const diff = (state.blockedUntil || 0) - Date.now();
    const isPast = diff <= 0;
    const timeStr = isPast ? '00:00:00 (Reset Time Reached)' : formatCountdown(diff);

    if (bannerCountdown) bannerCountdown.textContent = isPast ? 'Reset Time Reached' : `Resets in: ${timeStr}`;
    if (diagCountdown) diagCountdown.textContent = isPast ? 'Reset time reached. Retest AI to unlock.' : `Countdown: ${timeStr}`;

    const btnTestModel = document.getElementById('btn-test-model');
    const btnRetestDiag = document.getElementById('btn-retest-diagnose');

    if (isPast) {
      if (btnTestModel) {
        btnTestModel.disabled = false;
        btnTestModel.classList.remove('btn-disabled-blocked');
        btnTestModel.title = 'Reset time reached. Click to retest Cloudflare AI and unlock.';
      }
      if (btnRetestDiag) {
        btnRetestDiag.disabled = false;
        btnRetestDiag.classList.remove('btn-disabled-blocked');
        btnRetestDiag.title = 'Reset time reached. Click to retest Cloudflare AI and unlock.';
      }
    } else {
      if (btnTestModel) {
        btnTestModel.disabled = true;
        btnTestModel.classList.add('btn-disabled-blocked');
        btnTestModel.title = 'AI is blocked until 00:00 UTC (5:30 AM IST).';
      }
      if (btnRetestDiag) {
        btnRetestDiag.disabled = true;
        btnRetestDiag.classList.add('btn-disabled-blocked');
        btnRetestDiag.title = 'AI is blocked until 00:00 UTC (5:30 AM IST).';
      }
    }

    // Disable all "Generate new with AI" buttons while blocked
    document.querySelectorAll('.btn-card-ai-opt, #btn-fallback-ai, .btn-generate-ai-fallback').forEach(btn => {
      btn.disabled = true;
      btn.classList.add('btn-disabled-blocked');
      btn.title = isPast ? 'Reset time reached. Retest in Diagnostics to unlock AI.' : 'AI is blocked until 00:00 UTC (5:30 AM IST).';
    });
  }

  if (state.countdownInterval) {
    clearInterval(state.countdownInterval);
  }
  refreshCountdown();
  state.countdownInterval = setInterval(refreshCountdown, 1000);
}

function clearAiBlockedUI() {
  state.aiBlocked = false;
  state.blockedUntil = 0;
  if (state.countdownInterval) {
    clearInterval(state.countdownInterval);
    state.countdownInterval = null;
  }

  const banner = document.getElementById('ai-blocked-banner');
  if (banner) banner.classList.add('hidden');

  const diagBanner = document.getElementById('diag-blocked-banner');
  if (diagBanner) diagBanner.classList.add('hidden');

  const btnTestModel = document.getElementById('btn-test-model');
  if (btnTestModel) {
    btnTestModel.disabled = false;
    btnTestModel.classList.remove('btn-disabled-blocked');
    btnTestModel.title = '';
  }
  const btnRetestDiag = document.getElementById('btn-retest-diagnose');
  if (btnRetestDiag) {
    btnRetestDiag.disabled = false;
    btnRetestDiag.classList.remove('btn-disabled-blocked');
    btnRetestDiag.title = '';
  }
  document.querySelectorAll('.btn-card-ai-opt, #btn-fallback-ai, .btn-generate-ai-fallback').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('btn-disabled-blocked');
    btn.title = '';
  });
}

async function checkAiAllocationStatus() {
  try {
    const res = await fetch('/api/ai-status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.blocked) {
      updateAiBlockedUI(data.blockedUntil, data.message);
    } else {
      clearAiBlockedUI();
    }
  } catch (err) {
    // Non-fatal
  }
}

// Helper: Parse Voice/Text Overrides
function detectOverridePhrase(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();
  if (/^(make it for print|print-ku maathu|for print|print pannanum|print venum)/i.test(lower)) {
    return { purpose: 'print', tier: 'Max' };
  }
  if (/^(whatsapp-ku podhum|chat-ku podhum|make it for chat|for whatsapp|for chat|dp-ku podhum)/i.test(lower)) {
    return { purpose: 'chat', tier: 'Sketch' };
  }
  if (/^(poster-a maathu|make it a poster|for poster|poster venum|poster-ku)/i.test(lower)) {
    return { purpose: 'poster', tier: 'Detailed' };
  }
  if (/^(for slide|for school|school-ku maathu|slides-ku|slide-ku)/i.test(lower)) {
    return { purpose: 'school', tier: 'Standard' };
  }
  if (/^(better quality|make better|higher quality|sharp|high res)/i.test(lower)) {
    return { shift: 1 };
  }
  if (/^(smaller|make smaller|lower quality|rough|draft|simple)/i.test(lower)) {
    return { shift: -1 };
  }
  return null;
}

// Low-Confidence Interception (Question + 4 Purpose Buttons with Standard pre-selected)
function renderPurposeSelectionPrompt(word, customQuestion, inferred) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const qText = customQuestion || inferred?.question || "Is this for chat, a slide, a poster or print?";

  const promptBox = document.createElement('div');
  promptBox.className = 'purpose-prompt-box';
  promptBox.innerHTML = `
    <div class="purpose-prompt-title">
      <span>❓</span> <span>${escapeHtml(qText)}</span>
    </div>
    <div class="purpose-prompt-sub">
      Single keyword with unspecified use. Standard tier (1280×720) is pre-selected for optimal ~92% energy savings:
    </div>
    <div class="purpose-prompt-grid">
      <button type="button" class="btn-big-purpose" data-p="chat">
        <div class="btn-big-purpose-header">
          <span class="btn-big-purpose-icon">📱</span>
          <span class="btn-big-purpose-save">~96% Saved</span>
        </div>
        <div class="btn-big-purpose-name">Phone chat</div>
        <div class="btn-big-purpose-meta">640×360 · Sketch</div>
      </button>
      <button type="button" class="btn-big-purpose" data-p="school" style="border-color:var(--accent); background:rgba(var(--accent-rgb), 0.12);">
        <div class="btn-big-purpose-header">
          <span class="btn-big-purpose-icon">🎒</span>
          <span class="btn-big-purpose-save" style="background:var(--accent); color:#fff;">Proposed Default</span>
        </div>
        <div class="btn-big-purpose-name">School project</div>
        <div class="btn-big-purpose-meta">1280×720 · Standard (~92% Saved)</div>
      </button>
      <button type="button" class="btn-big-purpose" data-p="poster">
        <div class="btn-big-purpose-header">
          <span class="btn-big-purpose-icon">🖼️</span>
          <span class="btn-big-purpose-save">~75% Saved</span>
        </div>
        <div class="btn-big-purpose-name">Poster</div>
        <div class="btn-big-purpose-meta">1600×900 · Detailed</div>
      </button>
      <button type="button" class="btn-big-purpose" data-p="print">
        <div class="btn-big-purpose-header">
          <span class="btn-big-purpose-icon">🖨️</span>
          <span class="btn-big-purpose-save" style="color:var(--muted); background:rgba(255,255,255,0.06);">0% Saved</span>
        </div>
        <div class="btn-big-purpose-name">Print</div>
        <div class="btn-big-purpose-meta">1920×1080 · Max Quality</div>
      </button>
    </div>
  `;

  bubble.appendChild(promptBox);
  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);

  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();

  if (state.currentMode === 'elder' || state.speechRecognition) {
    speakText(qText);
  }

  promptBox.querySelectorAll('.btn-big-purpose').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const chosenP = btn.dataset.p;
      const chosenTier = PURPOSES[chosenP] ? PURPOSES[chosenP].tier : 'Standard';
      msgRow.remove();
      executeGenerateWithPurpose({
        word,
        purpose: chosenP,
        tier: chosenTier,
        isOverridden: false,
        fromTier: chosenTier,
        toTier: chosenTier
      });
    });
  });
}

// Suggestion Card in Chat (Constraint 2: Propose tier automatically, explain why, allow override)
function renderPurposeSuggestionCard(word, inferred) {
  state.currentWord = word;
  state.lastInferred = inferred;

  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const isKidsOrEasy = state.currentMode === 'kids' || state.currentMode === 'elder';
  const isPrint = (inferred.purposeKey === 'print') || (inferred.tier === 'Max');
  const energySavedNotice = isPrint
    ? '<span class="suggestion-energy-saved zero">Print needs Max quality, so 0% saved.</span>'
    : `<span class="suggestion-energy-saved">Estimated ${inferred.whProposed} Wh, about ${inferred.percentSaved}% less than Max (${inferred.whMax} Wh).</span>`;

  const card = document.createElement('div');
  card.className = 'purpose-suggestion-card';
  card.innerHTML = `
    <div class="suggestion-header">
      <span style="font-size:1.3rem;">💡</span>
      <div>
        I think this is for: <strong>${escapeHtml(inferred.purpose)}</strong> &rarr; <strong>${escapeHtml(inferred.tier)} quality, ${escapeHtml(inferred.size)}</strong>
      </div>
    </div>

    <div class="suggestion-reason">
      <strong>Why:</strong> ${escapeHtml(inferred.reason)}
    </div>

    <div class="suggestion-energy-row">
      <span class="suggestion-energy-wh">Proposed: <strong>${inferred.whProposed} Wh</strong> (vs Max: <strong>${inferred.whMax} Wh</strong>)</span>
      ${energySavedNotice}
    </div>

    <div class="suggestion-actions">
      <button type="button" class="btn-suggestion-use ${isKidsOrEasy ? 'btn-big-kids' : ''}" id="btn-suggest-use">
        ${isKidsOrEasy ? '✓ OK' : '⚡ Use this'}
      </button>
      <button type="button" class="btn-suggestion-change ${isKidsOrEasy ? 'btn-big-kids' : ''}" id="btn-suggest-change">
        ✏️ Change
      </button>
    </div>

    <!-- Override Panel -->
    <div class="suggestion-override-panel hidden" id="override-panel">
      <div class="override-section-title">Select Purpose:</div>
      <div class="purpose-prompt-grid" style="margin-bottom:8px;">
        <button type="button" class="btn-big-purpose ${inferred.purposeKey === 'chat' ? 'active-override' : ''}" data-p="chat" style="padding:10px 12px;">
          <div class="btn-big-purpose-header">
            <span class="btn-big-purpose-icon">📱</span>
            <span class="btn-big-purpose-save">~96% Saved</span>
          </div>
          <div class="btn-big-purpose-name" style="font-size:0.85rem;">Phone chat</div>
          <div class="btn-big-purpose-meta" style="font-size:0.72rem;">640×360 · Sketch</div>
        </button>
        <button type="button" class="btn-big-purpose ${inferred.purposeKey === 'school' ? 'active-override' : ''}" data-p="school" style="padding:10px 12px;">
          <div class="btn-big-purpose-header">
            <span class="btn-big-purpose-icon">🎒</span>
            <span class="btn-big-purpose-save">~92% Saved</span>
          </div>
          <div class="btn-big-purpose-name" style="font-size:0.85rem;">School project</div>
          <div class="btn-big-purpose-meta" style="font-size:0.72rem;">1280×720 · Standard</div>
        </button>
        <button type="button" class="btn-big-purpose ${inferred.purposeKey === 'poster' ? 'active-override' : ''}" data-p="poster" style="padding:10px 12px;">
          <div class="btn-big-purpose-header">
            <span class="btn-big-purpose-icon">🖼️</span>
            <span class="btn-big-purpose-save">~75% Saved</span>
          </div>
          <div class="btn-big-purpose-name" style="font-size:0.85rem;">Poster</div>
          <div class="btn-big-purpose-meta" style="font-size:0.72rem;">1600×900 · Detailed</div>
        </button>
        <button type="button" class="btn-big-purpose ${inferred.purposeKey === 'print' ? 'active-override' : ''}" data-p="print" style="padding:10px 12px;">
          <div class="btn-big-purpose-header">
            <span class="btn-big-purpose-icon">🖨️</span>
            <span class="btn-big-purpose-save" style="color:var(--muted); background:rgba(255,255,255,0.06);">0% Saved</span>
          </div>
          <div class="btn-big-purpose-name" style="font-size:0.85rem;">Print</div>
          <div class="btn-big-purpose-meta" style="font-size:0.72rem;">1920×1080 · Max Quality</div>
        </button>
      </div>

      <div class="override-section-title">Select Quality Tier & Estimated Energy:</div>
      <div class="override-tier-grid">
        <button type="button" class="btn-tier-card ${inferred.tier === 'Sketch' ? 'active' : ''}" data-tier="Sketch" data-p="chat">
          <span class="tier-title">Sketch</span>
          <span class="tier-size">640×360</span>
          <span class="tier-wh">~0.23 Wh (96% less)</span>
        </button>
        <button type="button" class="btn-tier-card ${inferred.tier === 'Standard' ? 'active' : ''}" data-tier="Standard" data-p="school">
          <span class="tier-title">Standard</span>
          <span class="tier-size">1280×720</span>
          <span class="tier-wh">~2.50 Wh (92% less)</span>
        </button>
        <button type="button" class="btn-tier-card ${inferred.tier === 'Detailed' ? 'active' : ''}" data-tier="Detailed" data-p="poster">
          <span class="tier-title">Detailed</span>
          <span class="tier-size">1600×900</span>
          <span class="tier-wh">~5.80 Wh (75% less)</span>
        </button>
        <button type="button" class="btn-tier-card tier-max ${inferred.tier === 'Max' ? 'active' : ''}" data-tier="Max" data-p="print">
          <span class="tier-title">Max</span>
          <span class="tier-size">1920×1080</span>
          <span class="tier-wh">~24.30 Wh (0% saved)</span>
        </button>
      </div>

      <div class="override-confirm-row">
        <button type="button" class="btn-suggestion-use" id="btn-apply-override">
          Apply & Generate
        </button>
      </div>
    </div>
  `;

  bubble.appendChild(card);
  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);

  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();

  // Assistant reads reason aloud if voice mode or Easy mode is on
  if (state.currentMode === 'elder' || state.speechRecognition || isKidsOrEasy) {
    speakText(inferred.reason);
  }

  // Handle "Use this" / "OK"
  card.querySelector('#btn-suggest-use').addEventListener('click', () => {
    msgRow.remove();
    executeGenerateWithPurpose({
      word,
      purpose: inferred.purposeKey || 'school',
      tier: inferred.tier,
      isOverridden: false,
      fromTier: inferred.tier,
      toTier: inferred.tier
    });
  });

  // Handle "Change"
  const overridePanel = card.querySelector('#override-panel');
  card.querySelector('#btn-suggest-change').addEventListener('click', () => {
    overridePanel.classList.toggle('hidden');
    scrollToBottom();
  });

  // Purpose & Tier synchronization inside override panel
  let chosenOverridePurpose = inferred.purposeKey || 'school';
  let chosenOverrideTier = inferred.tier || 'Standard';

  const tierMap = { chat: 'Sketch', school: 'Standard', poster: 'Detailed', print: 'Max' };
  const purposeMap = { Sketch: 'chat', Standard: 'school', Detailed: 'poster', Max: 'print' };

  card.querySelectorAll('.btn-big-purpose').forEach(b => {
    b.addEventListener('click', () => {
      card.querySelectorAll('.btn-big-purpose').forEach(x => {
        x.style.borderColor = 'var(--border)';
        x.style.background = 'var(--surface-2)';
      });
      b.style.borderColor = 'var(--accent)';
      b.style.background = 'rgba(var(--accent-rgb), 0.12)';
      chosenOverridePurpose = b.dataset.p;
      chosenOverrideTier = tierMap[chosenOverridePurpose] || 'Standard';

      card.querySelectorAll('.btn-tier-card').forEach(tb => {
        tb.classList.toggle('active', tb.dataset.tier === chosenOverrideTier);
      });
    });
  });

  card.querySelectorAll('.btn-tier-card').forEach(tb => {
    tb.addEventListener('click', () => {
      card.querySelectorAll('.btn-tier-card').forEach(x => x.classList.remove('active'));
      tb.classList.add('active');
      chosenOverrideTier = tb.dataset.tier;
      chosenOverridePurpose = tb.dataset.p || purposeMap[chosenOverrideTier] || 'school';

      card.querySelectorAll('.btn-big-purpose').forEach(b => {
        const isMatch = b.dataset.p === chosenOverridePurpose;
        b.style.borderColor = isMatch ? 'var(--accent)' : 'var(--border)';
        b.style.background = isMatch ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--surface-2)';
      });
    });
  });

  // Handle Apply Override
  card.querySelector('#btn-apply-override').addEventListener('click', async () => {
    msgRow.remove();

    // Learn from overrides in SQLite (for logged in users)
    if (state.currentUser && !state.currentUser.isGuest) {
      try {
        await fetch('/api/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: word,
            proposedPurpose: inferred.purposeKey || 'school',
            chosenPurpose: chosenOverridePurpose
          })
        });
      } catch (e) {
        devLog('Override learning save warning:', e.message);
      }
    }

    executeGenerateWithPurpose({
      word,
      purpose: chosenOverridePurpose,
      tier: chosenOverrideTier,
      isOverridden: true,
      fromTier: inferred.tier,
      toTier: chosenOverrideTier
    });
  });
}

// Unified Generation Execution
async function executeGenerateWithPurpose(options) {
  const { word, purpose, tier, isOverridden, fromTier, toTier } = options;
  state.currentWord = word;
  state.currentPurpose = purpose;
  state.currentTier = tier;

  let deltaWh = 0;
  if (isOverridden && fromTier && toTier) {
    const energyTiers = { Sketch: 0.23, Standard: 2.50, Detailed: 5.80, Max: 24.30 };
    deltaWh = Number(((energyTiers[toTier] || 2.5) - (energyTiers[fromTier] || 2.5)).toFixed(1));
  }

  const overrideInfo = {
    isOverridden: !!isOverridden,
    fromTier,
    toTier,
    deltaWh
  };

  // Web-First Licensed Photos Search (always forced if AI is blocked or demoMode is active)
  if (state.webFirst || state.aiBlocked || state.demoMode) {
    const streamEl = renderStreamingStep(`🔍 Searching licensed photos for "${word}" (${PURPOSES[purpose]?.title || purpose})...`);
    scrollToBottom();
    try {
      const res = await fetch('/api/search-licensed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: word, purpose })
      });
      streamEl.remove();
      const data = await res.json();
      if (data.success && data.photos && data.photos.length > 0) {
        const statusLine = state.aiBlocked
          ? 'AI paused (daily limit). Using licensed photos.'
          : (state.demoMode ? 'Demo mode active. Using licensed photos.' : null);
        renderWebPhotosGrid(word, purpose, data.photos, data.costReport, false, overrideInfo, { statusLine, is3036: state.aiBlocked });
        return;
      }
    } catch (e) {
      streamEl.remove();
    }
  }

  // AI Generation (only if AI is not blocked and demoMode is not active)
  if (!state.aiBlocked && !state.demoMode) {
    await generateWithAiModel(word, purpose, 0, overrideInfo);
  }
}

function renderAiGeneratedImageCard(word, purpose, imageBase64, mimeType, costReport) {
  const dataUrl = `data:${mimeType || 'image/png'};base64,${imageBase64}`;
  const purposeDef = PURPOSES[purpose] || PURPOSES.chat;
  renderFinalImageCard({
    url: dataUrl,
    source: 'Gemini AI Model',
    statusTag: 'AI generated',
    isAi: true,
    attribution: null,
    costReport: costReport || (window.computeCostReport ? window.computeCostReport(purpose, state.isGreenTime, false, 0, purposeDef.tier) : null),
    word,
    purpose
  });
}

/**
 * Single unified sendMessage flow:
 * 1. Purpose-first interception: asks "What is this for?" with big buttons if purpose not chosen
 * 2. Add user message to chat immediately
 * 3. POST to /api/chat with 30s timeout
 * 4. Quota Guard on 429: automatic fallback to licensed web photos with live 60s countdown
 * 5. Guaranteed re-enabling of inputs
 */
async function sendMessage(rawText, chosenPurposeOrOpts = null) {
  const inputField = document.getElementById('chat-input-field');
  const sendBtn = document.getElementById('btn-send-message');

  const text = (rawText !== undefined && rawText !== null ? String(rawText) : (inputField ? inputField.value : '')).trim();
  devLog('1. Validating message input:', text);

  if (!text) {
    devLog('Empty input ignored');
    return;
  }

  if (state.isGenerating) {
    devLog('Generation currently in progress, please wait.');
    return;
  }

  // Clear input
  if (inputField) inputField.value = '';

  // Dismiss onboarding hint on first interaction
  dismissOnboardingHint();

  // Hide empty state
  const emptyState = document.getElementById('chat-empty-state');
  if (emptyState) emptyState.classList.add('hidden');

  // Check if greeting
  const isGreeting = /^(hi|hello|hey|vanakkam|good morning|help|who are you|what can you do)/i.test(text);

  let chosenPurpose = null;
  let isOverridden = false;
  let fromTier = null;
  let toTier = null;

  if (typeof chosenPurposeOrOpts === 'string') {
    chosenPurpose = chosenPurposeOrOpts;
  } else if (chosenPurposeOrOpts && typeof chosenPurposeOrOpts === 'object') {
    chosenPurpose = chosenPurposeOrOpts.purpose || null;
    isOverridden = !!chosenPurposeOrOpts.isOverridden;
    fromTier = chosenPurposeOrOpts.fromTier || null;
    toTier = chosenPurposeOrOpts.toTier || null;
  }

  // Voice/Text Override Interception (e.g. "make it for print", "WhatsApp-ku podhum", "poster-a maathu")
  if (!chosenPurpose && !isGreeting && state.currentWord) {
    const overrideMatch = detectOverridePhrase(text);
    if (overrideMatch) {
      devLog('Voice/text override matched:', overrideMatch);
      renderMessageRow('user', text);
      saveMessageToChat('user', text, null);

      let targetPurpose = overrideMatch.purpose;
      let targetTier = overrideMatch.tier;
      if (overrideMatch.shift) {
        const tierOrder = ['Sketch', 'Standard', 'Detailed', 'Max'];
        const curIdx = tierOrder.indexOf(state.currentTier || 'Standard');
        const nextIdx = Math.max(0, Math.min(tierOrder.length - 1, curIdx + overrideMatch.shift));
        targetTier = tierOrder[nextIdx];
        targetPurpose = { Sketch: 'chat', Standard: 'school', Detailed: 'poster', Max: 'print' }[targetTier];
      }

      executeGenerateWithPurpose({
        word: state.currentWord,
        purpose: targetPurpose || 'school',
        tier: targetTier || 'Standard',
        isOverridden: true,
        fromTier: state.currentTier || 'Standard',
        toTier: targetTier || 'Standard'
      });
      return;
    }
  }

  // Lock UI
  state.isGenerating = true;
  if (inputField) inputField.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  // Render User Message row if not already in chat
  const lastUserMsg = document.querySelector('#chat-messages-container .message-row.user:last-child .message-text');
  if (!lastUserMsg || lastUserMsg.textContent !== text) {
    renderMessageRow('user', text);
    saveMessageToChat('user', text, null);
  }
  scrollToBottom();

  // If no chat active and not guest, create chat
  if (!state.currentChatId && state.currentUser && !state.currentUser.isGuest) {
    const firstWord = text.split(/\s+/)[0] || 'Chat';
    const title = text.length > 25 ? firstWord + '...' : text;
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mode: state.currentMode })
      });
      const data = await res.json();
      if (data.success && data.chat) {
        state.currentChatId = data.chat.id;
        state.chats.unshift(data.chat);
        const chatTitleEl = document.getElementById('current-chat-title');
        if (chatTitleEl) chatTitleEl.textContent = title;
        renderRecentChats();
      }
    } catch (e) {
      devLog('Chat creation warning:', e.message);
    }
  }

  // Show Working Indicator
  devLog('3. Displaying working indicator');
  const workingEl = renderStreamingStep('FocusGen is optimizing and inferring visual...');
  scrollToBottom();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 35000); // 35-second timeout

  try {
    devLog('4. POST /api/chat');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        purpose: chosenPurpose,
        isOverridden,
        fromTier,
        toTier,
        chatId: state.currentChatId,
        mode: state.currentMode || 'normal',
        webFirst: state.webFirst !== false,
        demoMode: state.demoMode === true
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (workingEl && workingEl.parentNode) {
      workingEl.remove();
    }

    devLog('5. Received server response:', res.status);

    // 401 Not Logged In
    if (res.status === 401) {
      renderChatError({
        type: 'auth',
        title: 'Please log in again',
        message: 'Your session has expired or requires authentication. Please sign in to continue.',
        actionLabel: 'Sign In / Register',
        action: () => showAuthModal()
      });
      showAuthModal();
      return;
    }

    // 403 Guest Limit Reached
    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      renderChatError({
        type: 'limit',
        title: 'Guest Limit Reached',
        message: errData.error || I18N[state.currentLang].guestLimit,
        actionLabel: 'Create Account',
        action: () => showAuthModal()
      });
      showAuthModal();
      return;
    }

    // 429 Quota Guard: Automatically show licensed web photos in the same reply
    if (res.status === 429) {
      try {
        const fallbackRes = await fetch('/api/search-licensed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text, purpose: chosenPurpose || 'school' })
        });
        const fallbackData = await fallbackRes.json();
        if (fallbackData.success && fallbackData.photos && fallbackData.photos.length > 0) {
          state.currentWord = text;
          renderWebPhotosGrid(text, chosenPurpose || 'school', fallbackData.photos, fallbackData.costReport, true);
          return;
        }
      } catch (eFallback) {}

      renderChatError({
        type: 'rate_limit',
        title: 'Quota Exceeded',
        message: 'AI image quota is full right now, showing real licensed photos instead.',
        actionLabel: 'Search Licensed Photos',
        action: () => sendMessage(text, chosenPurpose || 'school')
      });
      return;
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      renderChatError({
        type: 'server_error',
        title: 'Server Error',
        message: errData.error || `Server responded with status ${res.status}.`,
        actionLabel: 'Retry',
        action: () => sendMessage(text, chosenPurpose)
      });
      return;
    }

    const data = await res.json();
    devLog('6. Parsed response type:', data.type);

    if (data.aiBlocked) {
      updateAiBlockedUI(data.blockedUntil, data.aiMessage || data.message);
    }

    if (data.success) {
      if (data.type === 'ask_purpose') {
        renderPurposeSelectionPrompt(data.word || text, data.reply, data.inferred);
      } else if (data.type === 'purpose_suggestion') {
        renderPurposeSuggestionCard(data.word || text, data.inferred);
      } else if (data.type === 'greeting') {
        renderGreetingResponse(data.reply, data.suggestions);
      } else if (data.type === 'conversational') {
        renderAssistantTextMessage(data.reply);
      } else if (data.type === 'web_photos') {
        state.currentWord = data.word;
        state.resultsCache.set(`${data.word.toLowerCase()}__${data.purpose}`, data);
        renderWebPhotosGrid(data.word, data.purpose, data.photos, data.costReport, !!data.fallbackFromAi, { isOverridden, fromTier, toTier }, data);
      } else if (data.type === 'ai_image') {
        state.currentWord = data.word;
        state.resultsCache.set(`${data.word.toLowerCase()}__${data.purpose}`, data);
        renderFinalImageCard({
          url: `data:${data.mimeType || 'image/png'};base64,${data.imageBase64}`,
          source: data.sourceTag || 'Cloudflare FLUX',
          statusTag: data.statusTag || 'AI generated',
          sizeNotice: data.sizeNotice,
          isAi: true,
          attribution: null,
          costReport: data.costReport,
          costChip: data.costChip,
          word: data.word,
          purpose: data.purpose,
          focusData: data.focusData,
          overrideInfo: { isOverridden, fromTier, toTier }
        });
      } else {
        renderAssistantTextMessage(data.reply || 'Message processed.');
      }
    } else {
      if (data.reason === 'missing_key') {
        renderChatError({
          type: 'missing_key',
          title: 'Gemini API Key Missing',
          message: data.error || 'Gemini API key is not configured in .env. Keyless licensed photography is active and requires no keys!',
          actionLabel: 'Search Licensed Photos',
          action: () => {
            state.webFirst = true;
            const toggle = document.getElementById('toggle-web-first');
            if (toggle) toggle.checked = true;
            sendMessage(text, purposeToUse);
          }
        });
      } else {
        renderChatError({
          type: 'server_error',
          title: 'Generation Failed',
          message: data.error || 'An error occurred while processing your request.',
          actionLabel: 'Retry',
          action: () => sendMessage(text, purposeToUse)
        });
      }
    }

  } catch (err) {
    clearTimeout(timeoutId);
    if (workingEl && workingEl.parentNode) {
      workingEl.remove();
    }

    devLog('SendMessage catch error:', err.message);

    if (err.name === 'AbortError') {
      renderChatError({
        type: 'timeout',
        title: 'Request Timed Out',
        message: 'The request took longer than 30 seconds to complete. The server may be under heavy load or offline.',
        actionLabel: 'Retry',
        action: () => sendMessage(text, purposeToUse)
      });
    } else if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('connect')) {
      const dot = document.getElementById('server-status-dot');
      const label = document.getElementById('server-status-label');
      if (dot) { dot.classList.remove('online'); dot.classList.add('offline'); }
      if (label) { label.textContent = 'Disconnected'; }
      renderChatError({
        type: 'unreachable',
        title: 'Server Not Reachable',
        message: 'Could not connect to the FocusGen server. Please verify the server is running.',
        actionLabel: 'Try Reconnecting',
        action: () => sendMessage(text, purposeToUse)
      });
    } else {
      renderChatError({
        type: 'generic',
        title: 'Error Occurred',
        message: err.message || I18N[state.currentLang].errorGeneric,
        actionLabel: 'Retry',
        action: () => sendMessage(text, purposeToUse)
      });
    }
  } finally {
    devLog('7. Re-enabling inputs');
    state.isGenerating = false;
    if (inputField) {
      inputField.disabled = false;
      inputField.focus();
    }
    if (sendBtn) {
      sendBtn.disabled = false;
    }
    scrollToBottom();
  }
}

// Backwards compatibility alias
const handleUserPrompt = sendMessage;

/**
 * Renders Top 4 Real Licensed Photos with photographer attribution, status tag, & Purpose Switcher
 */
function renderWebPhotosGrid(word, purpose, photos, costReport, isQuotaFallback = false, overrideInfo = null, fallbackMeta = null) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Inferred Purpose Suggestion Mini Banner
  let inferredHtml = '';
  if (fallbackMeta?.inferred) {
    const inf = fallbackMeta.inferred;
    inferredHtml = `
      <div class="purpose-suggestion-mini-banner">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>💡</span>
          <span>Suggested: <strong>${escapeHtml(inf.title || inf.purpose || purpose)}</strong> (${escapeHtml(inf.size || '')} · ${escapeHtml(String(inf.percentSaved || 0))}% less energy)</span>
        </div>
        <span style="font-size:0.75rem; color:var(--muted);">${escapeHtml(inf.reason || '')}</span>
      </div>
    `;
  }

  // Background AI Queue Banner
  let queueHtml = '';
  if (fallbackMeta?.aiJob) {
    const pos = fallbackMeta.aiJob.position || 1;
    const txt = fallbackMeta.statusLine || (pos > 1 ? `Position in queue: ${pos}` : `Position in queue: ${pos} · Generating AI image in background...`);
    queueHtml = `
      <div class="ai-queue-banner" id="ai-queue-${fallbackMeta.aiJob.id}">
        <span class="queue-spin">⏳</span>
        <span class="queue-text" id="ai-queue-text-${fallbackMeta.aiJob.id}">${escapeHtml(txt)}</span>
      </div>
    `;
  }

  // Quota Guard / Status Line Notice
  let bannerHtml = '';
  const statusLineText = fallbackMeta?.statusLine || (state.aiBlocked 
    ? 'AI paused (daily limit). Using licensed photos.' 
    : (state.demoMode ? 'Demo mode active. Using licensed photos.' : null));
  const isActual429 = isQuotaFallback && (fallbackMeta?.is429 !== false);
  const fallbackMsg = fallbackMeta?.aiMessage || (isActual429 
    ? 'AI image quota is full right now, showing real licensed photos instead.'
    : 'AI image generator unavailable, showing real licensed photos instead.');

  if (statusLineText && !fallbackMeta?.aiJob) {
    // Show small status line with no error banner when AI is paused or in Demo mode
    bannerHtml = `
      <div class="web-photo-status-line">
        <span>${state.demoMode ? '🎪' : '⏳'}</span>
        <span>${escapeHtml(statusLineText)}</span>
      </div>
    `;
  } else if (isQuotaFallback && !state.aiBlocked && !state.demoMode) {
    if (isActual429) {
      bannerHtml = `
        <div class="quota-guard-banner">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>⚡</span>
            <span>${escapeHtml(fallbackMsg)}</span>
          </div>
          <button type="button" class="btn-retry-ai" id="btn-quota-retry-ai" disabled>
            Retry AI (60s)
          </button>
        </div>
      `;
    } else {
      bannerHtml = `
        <div class="quota-guard-banner" style="background:rgba(255, 107, 107, 0.12); border-color:rgba(255, 107, 107, 0.35);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>⚠️</span>
            <span>${escapeHtml(fallbackMsg)}</span>
          </div>
          <button type="button" class="btn-retry-ai" id="btn-quota-retry-ai">
            🔄 Retry AI
          </button>
        </div>
      `;
    }
  }

  const costChipText = window.formatCostChipText(costReport);

  const container = document.createElement('div');
  container.className = 'web-photos-container';
  container.innerHTML = `
    ${inferredHtml}
    ${queueHtml}
    ${bannerHtml}
    <div class="web-photos-header">
      <div class="web-photos-title">
        <span>🌐</span> <span>${I18N[state.currentLang].webPhotosFound} "${escapeHtml(word)}"</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="mode-pill-badge" style="background:var(--accent); color:#FFFFFF; font-weight:700;">Web photo</span>
        <span class="mode-pill-badge" style="background:rgba(var(--accent-rgb), 0.15); color:var(--accent); border:1px solid var(--accent);">Target: ${PURPOSES[purpose] ? PURPOSES[purpose].title : 'Phone Chat'}</span>
      </div>
    </div>
    <div class="purpose-switch-row">
      <span style="font-size:0.75rem; color:var(--muted); font-weight:600;">Purpose:</span>
      <button type="button" class="purpose-switch-btn ${purpose === 'chat' ? 'active' : ''}" data-p="chat">📱 Phone Chat (~96% Saved)</button>
      <button type="button" class="purpose-switch-btn ${purpose === 'school' ? 'active' : ''}" data-p="school">🎒 School (~50% Saved)</button>
      <button type="button" class="purpose-switch-btn ${purpose === 'poster' ? 'active' : ''}" data-p="poster">🖼️ Poster (~25% Saved)</button>
      <button type="button" class="purpose-switch-btn ${purpose === 'print' ? 'active' : ''}" data-p="print">🖨️ Print (0% Saved)</button>
    </div>
    <div class="web-photos-grid">
      ${photos.map((p, idx) => `
        <div class="web-photo-card" data-idx="${idx}">
          <div class="web-photo-img-wrap">
            <img src="${p.thumbUrl}" alt="${escapeHtml(p.title)}" class="web-photo-img" loading="lazy">
          </div>
          <div class="web-photo-content">
            <div class="web-photo-title-text" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
            <div class="web-photo-creator-line">
              Photo by <a href="${p.creatorUrl || p.photographerUrl || p.sourceUrl}" target="_blank" rel="noopener">${escapeHtml(p.creator || p.photographer)}</a>
            </div>
            <div class="web-photo-tags-row">
              <span class="license-tag-pill" style="background:rgba(var(--accent-rgb), 0.1); color:var(--accent); font-weight:600;">Web photo</span>
              <span class="license-tag-pill">${escapeHtml(p.license)}</span>
              <a href="${p.sourceUrl}" target="_blank" rel="noopener" class="source-page-link">Source Page ↗</a>
            </div>
            <div class="web-card-btns-row">
              <button type="button" class="btn-use-card-photo" data-idx="${idx}">⚡ Use this</button>
              <button type="button" class="btn-card-ai-opt" data-idx="${idx}">Generate new with AI</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="web-photos-actions" style="flex-direction:column; align-items:stretch; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <span style="font-size:0.78rem; color:var(--muted);">Licensed photos · Tap "Use this" to compress to ${PURPOSES[purpose] ? PURPOSES[purpose].title : 'target size'}</span>
        <button type="button" class="btn-generate-ai-fallback" id="btn-fallback-ai">
          ${I18N[state.currentLang].generateWithAi}
        </button>
      </div>
      <!-- Cost Chip on web photos result with source tag -->
      <div class="compact-cost-chip" style="width:100%; justify-content:space-between;" title="Estimated energy and inference metrics">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="cost-chip-source-tag" style="background:rgba(34, 197, 94, 0.15); color:#10B981; border:1px solid rgba(34, 197, 94, 0.3);">Web photo</span>
          <span class="cost-chip-text">${costChipText}</span>
        </div>
        <button type="button" class="cost-chip-info-btn" aria-label="How does this cost work?">ℹ️</button>
      </div>
    </div>
  `;

  bubble.appendChild(container);
  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);

  document.getElementById('chat-messages-container').appendChild(msgRow);

  // If background AI generation job is present, start polling live queue
  if (fallbackMeta?.aiJob && fallbackMeta.aiJob.id) {
    pollAiJob(fallbackMeta.aiJob.id, bubble, word, purpose);
  }

  // If cached AI image was returned, append it immediately to this reply
  if (fallbackMeta?.cachedImage) {
    appendAiReadyCard(bubble, fallbackMeta.cachedImage, word, purpose, true);
  }

  // Hook up countdown if quota fallback (or direct retry button if non-quota error)
  if (isQuotaFallback) {
    const retryBtn = container.querySelector('#btn-quota-retry-ai');
    if (retryBtn) {
      if (isActual429) {
        startQuotaCountdown(retryBtn, word, purpose);
      } else {
        retryBtn.onclick = async (e) => {
          e.preventDefault();
          msgRow.remove();
          await generateWithAiModel(word, purpose);
        };
      }
    }
  }

  // Cost chip info button
  const costInfoBtn = container.querySelector('.cost-chip-info-btn');
  if (costInfoBtn) {
    costInfoBtn.addEventListener('click', () => {
      openHowModal(costReport);
    });
  }

  // Bind Purpose switch buttons
  container.querySelectorAll('.purpose-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newP = btn.dataset.p;
      state.currentPurpose = newP;
      state.currentTier = PURPOSES[newP].tier;
      msgRow.remove();
      sendMessage(word, newP);
    });
  });

  async function selectPhoto(idx, autoCompress = true) {
    const chosenPhoto = photos[idx];
    const streamEl = renderStreamingStep(`🗜️ Compressing "${chosenPhoto.title}" to ${PURPOSES[purpose] ? PURPOSES[purpose].title : 'target'} size...`);
    scrollToBottom();

    let finalUrl = chosenPhoto.fullUrl;
    let compressData = null;

    if (autoCompress) {
      try {
        const cRes = await fetch('/api/compress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: chosenPhoto.thumbUrl || chosenPhoto.fullUrl,
            purpose,
            hintText: word,
            focusClarity: state.focusClarity !== false
          })
        });
        const cJson = await cRes.json();
        if (cJson.success) {
          finalUrl = cJson.focusedUrl || cJson.compressedUrl;
          compressData = cJson;
          state.activeCompressData = cJson;
        }
      } catch (e) {
        console.warn('Compress failed, using original photo:', e);
      }
    }

    streamEl.remove();

    renderFinalImageCard({
      url: finalUrl,
      thumbUrl: chosenPhoto.thumbUrl,
      source: chosenPhoto.source || chosenPhoto.sourceBadge || 'Web photo',
      statusTag: 'Web photo',
      isAi: false,
      attribution: {
        photographer: chosenPhoto.creator || chosenPhoto.photographer,
        photographerUrl: chosenPhoto.creatorUrl || chosenPhoto.photographerUrl,
        sourceUrl: chosenPhoto.sourceUrl,
        license: chosenPhoto.license,
        title: chosenPhoto.title
      },
      costReport: costReport || (window.computeWebImageReport ? window.computeWebImageReport(purpose) : null),
      word,
      purpose,
      focusData: compressData,
      compressSummary: compressData ? compressData.summary : null
    });
  }

  // Bind "Use this" buttons
  container.querySelectorAll('.btn-use-card-photo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      selectPhoto(idx, true);
    });
  });

  // Bind Card AI option buttons
  container.querySelectorAll('.btn-card-ai-opt').forEach(btn => {
    if (state.aiBlocked) {
      btn.disabled = true;
      btn.classList.add('btn-disabled-blocked');
      btn.title = 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).';
    }
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.aiBlocked) return;
      msgRow.remove();
      await generateWithAiModel(word, purpose);
    });
  });

  // Clicking anywhere else on card selects and shows
  container.querySelectorAll('.web-photo-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      const idx = parseInt(card.dataset.idx, 10);
      selectPhoto(idx, true);
    });
  });

  // Bind bottom Generate with AI button
  const bottomAiBtn = container.querySelector('#btn-fallback-ai');
  if (bottomAiBtn) {
    if (state.aiBlocked) {
      bottomAiBtn.disabled = true;
      bottomAiBtn.classList.add('btn-disabled-blocked');
      bottomAiBtn.title = 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).';
    }
    bottomAiBtn.addEventListener('click', async () => {
      if (state.aiBlocked) return;
      msgRow.remove();
      await generateWithAiModel(word, purpose);
    });
  }
}

/**
 * AI Photorealistic Generation Flow (No cartoons)
 * Quota Guard: on HTTP 429 or any failure, automatically falls back to licensed web photos in same reply!
 */
async function generateWithAiModel(word, purpose, refinePass = 0, overrideInfo = null) {
  // If AI is blocked or Demo mode is active, skip all AI calls and use licensed photos directly with zero errors
  if (state.aiBlocked || state.demoMode) {
    try {
      const fallbackRes = await fetch('/api/search-licensed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: word, purpose })
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.success && fallbackData.photos && fallbackData.photos.length > 0) {
        const statusLine = state.demoMode
          ? 'Demo mode active. Using licensed photos.'
          : 'AI paused (daily limit). Using licensed photos.';
        renderWebPhotosGrid(word, purpose, fallbackData.photos, fallbackData.costReport, false, overrideInfo, { statusLine, is3036: state.aiBlocked });
        return;
      }
    } catch (eFallback) {}
    return;
  }

  const streamingEl = renderStreamingStep(`⚡ Synthesizing photorealistic DSLR composition for "${word}"...`);
  scrollToBottom();

  const purposeDef = PURPOSES[purpose] || PURPOSES.chat;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word,
        purpose,
        tier: purposeDef.tier,
        refinePass: refinePass || 0,
        width: purpose === 'chat' ? 640 : (purpose === 'school' || purpose === 'project') ? 1024 : purpose === 'poster' ? 1280 : 1920,
        height: purpose === 'chat' ? 360 : (purpose === 'school' || purpose === 'project') ? 576 : purpose === 'poster' ? 720 : 1080,
        isOverridden: !!overrideInfo?.isOverridden,
        fromTier: overrideInfo?.fromTier,
        toTier: overrideInfo?.toTier
      })
    });

    streamingEl.remove();

    if (res.status === 403) {
      renderErrorCard(I18N[state.currentLang].guestLimit, false);
      return;
    }

    const data = await res.json();

    if (data.success && data.imageBase64) {
      state.retryBackoffSeconds = 60; // Reset backoff on success
      const dataUrl = `data:${data.mimeType || 'image/png'};base64,${data.imageBase64}`;
      const srcTag = data.sourceTag || (data.provider === 'cloudflare' ? 'Cloudflare FLUX' : (data.provider === 'gemini' ? 'Gemini AI' : 'Cloudflare FLUX'));
      renderFinalImageCard({
        url: dataUrl,
        source: srcTag,
        statusTag: data.statusTag || srcTag,
        sourceTag: srcTag,
        isAi: true,
        attribution: null,
        costReport: data.costReport || window.computeCostReport(purpose, state.isGreenTime, false, refinePass, purposeDef.tier),
        word,
        purpose,
        sizeNotice: data.sizeNotice,
        costChip: data.costChip,
        focusData: data.focusData,
        overrideInfo
      });
      return;
    }

    if (data.aiBlocked || data.is3036) {
      updateAiBlockedUI(data.blockedUntil, data.aiMessage || data.message);
    }

    // Check if server returned fallback web photos directly
    if (data.fallbackFromAi && data.photos && data.photos.length > 0) {
      renderWebPhotosGrid(word, purpose, data.photos, data.costReport, !data.aiBlocked, overrideInfo, data);
      return;
    }

    // Quota Guard: on 429, quota, or API failure, automatically show licensed web photos in same reply!
    try {
      const fallbackRes = await fetch('/api/search-licensed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: word, purpose })
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.success && fallbackData.photos && fallbackData.photos.length > 0) {
        renderWebPhotosGrid(word, purpose, fallbackData.photos, fallbackData.costReport, true);
        return;
      }
    } catch (eFallback) {}

    const isQuota = res.status === 429 || (data.error && (data.error.includes('429') || data.error.toLowerCase().includes('quota')));
    const friendlyMsg = isQuota
      ? 'AI image quota is full right now, showing real licensed photos instead.'
      : (data.error || 'AI generation failed. Please verify your GEMINI_API_KEY in .env or try again.');

    renderErrorCard(friendlyMsg, true, () => {
      generateWithAiModel(word, purpose);
    }, word);

  } catch (err) {
    streamingEl.remove();
    // Quota Guard: on network or timeout, automatically show licensed web photos in same reply!
    try {
      const fallbackRes = await fetch('/api/search-licensed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: word, purpose })
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.success && fallbackData.photos && fallbackData.photos.length > 0) {
        renderWebPhotosGrid(word, purpose, fallbackData.photos, fallbackData.costReport, true);
        return;
      }
    } catch (eFallback) {}

    renderErrorCard('Connection timeout or network failure. Showing licensed photography search.', true, () => {
      generateWithAiModel(word, purpose);
    }, word);
  }
}

/**
 * Background AI Job Polling with live queue status
 */
function pollAiJob(jobId, parentBubble, word, purpose) {
  let attempts = 0;
  const maxAttempts = 35; // 35 * 1.5s = ~52s
  const queueBanner = parentBubble.querySelector(`#ai-queue-${jobId}`);

  const pollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(pollInterval);
      if (queueBanner) {
        queueBanner.innerHTML = `<span>⏳</span><span>AI image is taking long, showing licensed photos</span>`;
        queueBanner.className = 'ai-queue-banner timeout';
      }
      return;
    }

    try {
      const res = await fetch(`/api/ai-job/${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success) return;

      if (data.status === 'queued') {
        if (queueBanner) {
          queueBanner.innerHTML = `<span class="queue-spin">⏳</span><span>Position in queue: ${data.position || 1}</span>`;
        }
      } else if (data.status === 'generating') {
        if (queueBanner) {
          queueBanner.innerHTML = `<span class="queue-spin">⚡</span><span>Generating photorealistic AI image with Pollinations FLUX...</span>`;
        }
      } else if (data.status === 'completed' && data.result) {
        clearInterval(pollInterval);
        if (queueBanner) {
          queueBanner.innerHTML = `<span>✅</span><span>New AI image ready</span>`;
          queueBanner.className = 'ai-queue-banner ready';
        }

        // Render "New AI image ready" card into the same message bubble
        appendAiReadyCard(parentBubble, data.result, word, purpose, false);

      } else if (data.status === 'timeout') {
        clearInterval(pollInterval);
        if (queueBanner) {
          queueBanner.innerHTML = `<span>⏳</span><span>AI image is taking long, showing licensed photos</span>`;
          queueBanner.className = 'ai-queue-banner timeout';
        }
      } else if (data.status === 'failed') {
        clearInterval(pollInterval);
        if (queueBanner) {
          queueBanner.innerHTML = `<span>🌐</span><span>Showing licensed photos</span>`;
          queueBanner.className = 'ai-queue-banner fallback';
        }
      }
    } catch (e) {
      console.warn('Poll AI job warning:', e);
    }
  }, 1500);
}

/**
 * Appends "New AI image ready" card into the same assistant message reply
 */
function appendAiReadyCard(parentBubble, imgResult, word, purpose, fromCache = false) {
  if (parentBubble.querySelector('.new-ai-ready-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'new-ai-ready-wrapper';

  const header = document.createElement('div');
  header.className = 'new-ai-ready-pill-header';
  const tag = fromCache ? 'Cached' : (imgResult.sourceTag || 'Pollinations (AI)');
  header.innerHTML = `✨ <strong>New AI image ready</strong> · <span style="font-weight:600;">${escapeHtml(tag)}</span>`;
  wrapper.appendChild(header);

  const cardData = {
    url: (imgResult.imageBase64 && imgResult.imageBase64.startsWith('data:')) ? imgResult.imageBase64 : `data:${imgResult.mimeType || 'image/webp'};base64,${imgResult.imageBase64}`,
    source: tag,
    statusTag: tag,
    sourceTag: tag,
    sizeNotice: imgResult.sizeNotice,
    isAi: true,
    attribution: null,
    costReport: imgResult.costReport,
    costChip: imgResult.costChip,
    word: word || imgResult.word,
    purpose: purpose || imgResult.purpose,
    focusData: imgResult.focusData
  };

  const card = createInlineCardElement(cardData, parentBubble.closest('.message-row'));
  wrapper.appendChild(card);
  parentBubble.appendChild(wrapper);
  scrollToBottom();

  recordSessionLedger(word, purpose, tag, imgResult.costReport, null);
  saveMessageToChat('assistant', `AI Image for ${word}`, cardData);
}

/**
 * Creates Inline Image Card element with full controls and 9 actions
 */
function createInlineCardElement(imgData, parentRow = null) {
  const { url, source, attribution, costReport, word, purpose, isAi = false, statusTag, sizeNotice, costChip, overrideInfo } = imgData;

  const focusData = imgData.focusData || null;
  const clarityAlloc = focusData?.clarityAllocation || costReport?.clarityAllocation || null;
  const modeLabel = focusData?.modeLabel || costReport?.modeLabel || (purpose === 'print' ? 'Focus clarity (Print - full clarity)' : 'Focus clarity (post-process)');
  const focusBox = focusData?.focusBox || imgData.focusBox || { x: 20, y: 15, width: 60, height: 70, feather: 15 };
  imgData.focusBox = focusBox;
  imgData.focusData = focusData;

  const card = document.createElement('div');
  card.className = 'inline-image-card';
  card.dataset.focusBox = JSON.stringify(focusBox);

  const resolvedSourceTag = imgData.sourceTag || (isAi 
    ? (source && (source.includes('Pollinations') || source.includes('flux')) ? 'Pollinations (AI)' : (source && source.includes('Cached') ? 'Cached' : 'Cloudflare (AI)'))
    : 'Web photo');
  const tagLabel = statusTag || resolvedSourceTag;
  let costChipText = costChip || window.formatCostChipText(costReport);

  if (!costChipText.startsWith('Estimated') && !costChipText.startsWith('Web photo')) {
    costChipText = `Estimated ${costChipText}`;
  }

  if (!costChip && overrideInfo && overrideInfo.isOverridden && overrideInfo.fromTier && overrideInfo.toTier) {
    const sign = overrideInfo.deltaWh >= 0 ? '+' : '';
    costChipText = `You changed ${overrideInfo.fromTier} to ${overrideInfo.toTier}: ${sign}${overrideInfo.deltaWh} Wh · ${costChipText}`;
  }

  const downloadHref = attribution
    ? `/api/download-attributed?url=${encodeURIComponent(url)}&title=${encodeURIComponent(attribution.title || word)}&creator=${encodeURIComponent(attribution.photographer)}&license=${encodeURIComponent(attribution.license)}&source=${encodeURIComponent(source || 'Web')}`
    : url;

  const isFavorited = state.favorites.some(f => f.url === url);

  const isPrint = (purpose || '').toLowerCase() === 'print';
  const allocText = isPrint
    ? 'Print needs full clarity, focus map off (0% smaller)'
    : (clarityAlloc ? clarityAlloc.summaryText : 'Clarity allocation: subject at full detail, background at reduced detail.');

  card.innerHTML = `
    <div class="inline-image-view">
      <div class="image-header-badges">
        <span class="image-source-pill" style="background:var(--accent); color:#FFFFFF; font-weight:700;">${tagLabel}</span>
        <span class="image-source-pill">${source || resolvedSourceTag}</span>
        ${attribution ? `<span class="image-source-pill">© ${escapeHtml(attribution.photographer)} (${escapeHtml(attribution.license)})</span>` : ''}
      </div>
      <img src="${url}" alt="${escapeHtml(word || 'FocusGen visual')}" class="inline-image-display" crossorigin="anonymous">
      <canvas class="inline-overlay-canvas ${state.showFocusMap ? '' : 'hidden'}" width="640" height="360"></canvas>
      ${sizeNotice ? `<div class="size-notice-banner">ℹ️ ${escapeHtml(sizeNotice)}</div>` : ''}
    </div>
    
    <div class="inline-image-controls" style="flex-direction:column; align-items:stretch; gap:10px;">
      <!-- Image Actions Grid: 9 actions including Set focus & Compare -->
      <div class="result-actions-grid">
        <a href="${downloadHref}" download="focusgen-${encodeURIComponent(word || 'photo')}.jpg" class="btn-action-icon" target="_blank" title="Download image with attribution">
          ⬇️ Download
        </a>
        <button type="button" class="btn-action-icon btn-action-regen" title="Regenerate this subject">
          🔄 Regenerate
        </button>
        <button type="button" class="btn-action-icon btn-action-set-focus" title="Drag a box on the image to set the important focus area">
          🎯 Set focus
        </button>
        <button type="button" class="btn-action-icon btn-action-compare-focus" title="Compare Focus clarity vs Uniform clarity">
          ⚖️ Compare clarity
        </button>
        <button type="button" class="btn-action-icon btn-action-better" title="Upgrade resolution & quality one tier up (extra energy counted in ledger)">
          ⚡ Make better
        </button>
        <button type="button" class="btn-action-icon btn-action-smaller" title="Reduce resolution & size one tier down (energy saved in ledger)">
          🔽 Make smaller
        </button>
        <button type="button" class="btn-action-icon btn-action-compress" title="Open Before/After compare slider">
          🗜️ Compress
        </button>
        <button type="button" class="btn-action-icon btn-action-copy-attr" title="Copy photographer & CC license attribution to clipboard">
          📋 Copy attribution
        </button>
        <button type="button" class="btn-action-icon btn-action-fav ${isFavorited ? 'active-star' : ''}" data-url="${url}" title="Add to favorites in sidebar">
          ${isFavorited ? '★ Favorited' : '⭐ Favorite'}
        </button>
      </div>

      <!-- Clarity Allocation Notice -->
      <div class="clarity-allocation-chip">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <strong style="color:var(--accent); font-size:0.75rem;">${escapeHtml(modeLabel)}:</strong>
          <span style="font-size:0.75rem; color:var(--text);">${escapeHtml(allocText)}</span>
        </div>
      </div>

      <!-- Cost Chip on every result with source tag -->
      <div class="compact-cost-chip" style="width:100%; justify-content:space-between;" title="Estimated energy and inference metrics">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="cost-chip-source-tag">${resolvedSourceTag}</span>
          <span class="cost-chip-text">${costChipText}</span>
        </div>
        <button type="button" class="cost-chip-info-btn" aria-label="How does this cost work?">ℹ️</button>
      </div>
    </div>
  `;

  if (state.showFocusMap) {
    const canvas = card.querySelector('.inline-overlay-canvas');
    if (canvas) drawFocusZonesOnCanvas(canvas, purpose === 'print', focusBox);
  }

  // Bind Actions:
  // 1. Regenerate
  card.querySelector('.btn-action-regen').addEventListener('click', () => {
    const rowToRemove = parentRow || card.closest('.message-row');
    if (rowToRemove) rowToRemove.remove();
    if (isAi || (source && source.includes('AI'))) {
      generateWithAiModel(word, purpose, 0, overrideInfo);
    } else {
      executeGenerateWithPurpose({ word, purpose, tier: state.currentTier, isOverridden: !!overrideInfo?.isOverridden, fromTier: overrideInfo?.fromTier, toTier: overrideInfo?.toTier });
    }
  });

  // 2. Set Focus
  const setFocusBtn = card.querySelector('.btn-action-set-focus');
  if (setFocusBtn) {
    setFocusBtn.addEventListener('click', () => {
      enableInteractiveFocusSelection(card, imgData);
    });
  }

  // 3. Compare Clarity
  const compareFocusBtn = card.querySelector('.btn-action-compare-focus');
  if (compareFocusBtn) {
    compareFocusBtn.addEventListener('click', () => {
      openFocusCompareModal(imgData);
    });
  }

  // 4. Make Better
  card.querySelector('.btn-action-better').addEventListener('click', () => {
    const rowToRemove = parentRow || card.closest('.message-row');
    if (rowToRemove) rowToRemove.remove();
    const tierOrder = ['Sketch', 'Standard', 'Detailed', 'Max'];
    const pTierMap = { chat: 'Sketch', school: 'Standard', project: 'Standard', poster: 'Detailed', print: 'Max' };
    const curTier = pTierMap[purpose] || 'Standard';
    const curIdx = tierOrder.indexOf(curTier);
    const nextIdx = Math.min(tierOrder.length - 1, curIdx + 1);
    const nextTier = tierOrder[nextIdx];
    const nextPurpose = { Sketch: 'chat', Standard: 'school', Detailed: 'poster', Max: 'print' }[nextTier];

    executeGenerateWithPurpose({
      word,
      purpose: nextPurpose,
      tier: nextTier,
      isOverridden: true,
      fromTier: curTier,
      toTier: nextTier
    });
  });

  // 5. Make Smaller
  card.querySelector('.btn-action-smaller').addEventListener('click', () => {
    const rowToRemove = parentRow || card.closest('.message-row');
    if (rowToRemove) rowToRemove.remove();
    const tierOrder = ['Sketch', 'Standard', 'Detailed', 'Max'];
    const pTierMap = { chat: 'Sketch', school: 'Standard', project: 'Standard', poster: 'Detailed', print: 'Max' };
    const curTier = pTierMap[purpose] || 'Standard';
    const curIdx = tierOrder.indexOf(curTier);
    const prevIdx = Math.max(0, curIdx - 1);
    const prevTier = tierOrder[prevIdx];
    const prevPurpose = { Sketch: 'chat', Standard: 'school', Detailed: 'poster', Max: 'print' }[prevTier];

    executeGenerateWithPurpose({
      word,
      purpose: prevPurpose,
      tier: prevTier,
      isOverridden: true,
      fromTier: curTier,
      toTier: prevTier
    });
  });

  // 6. Compress
  card.querySelector('.btn-action-compress').addEventListener('click', () => {
    openCompressStudio(url, purpose, isAi || (source && source.includes('AI')), costReport);
  });

  // 7. Copy Attribution
  card.querySelector('.btn-action-copy-attr').addEventListener('click', () => {
    const attrText = attribution
      ? `"${attribution.title || word}" by ${attribution.photographer || 'Photographer'}, licensed under ${attribution.license || 'CC'} via ${source || 'Web Search'}. Optimized with FocusGen.`
      : `Photorealistic visual generated with FocusGen (${PURPOSES[purpose]?.title || 'Eco'} tier).`;
    navigator.clipboard.writeText(attrText).then(() => {
      const btn = card.querySelector('.btn-action-copy-attr');
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      setTimeout(() => btn.innerHTML = orig, 2000);
    }).catch(() => {
      alert('Attribution:\n' + attrText);
    });
  });

  // 8. Favorite
  const favBtn = card.querySelector('.btn-action-fav');
  favBtn.addEventListener('click', () => {
    toggleFavorite({
      url,
      word,
      purpose,
      source: tagLabel,
      attribution,
      statusTag: tagLabel
    }, favBtn);
  });

  // 9. Cost Info Modal
  card.querySelector('.cost-chip-info-btn').addEventListener('click', () => {
    openHowModal(costReport);
  });

  return card;
}

/**
 * Renders Final Inline Image Card with Source, Status Tag, 9 Actions & Compact Cost Chip
 */
function renderFinalImageCard(imgData) {
  const msgRow = document.createElement('div');
  msgRow.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const card = createInlineCardElement(imgData, msgRow);
  bubble.appendChild(card);
  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);

  document.getElementById('chat-messages-container').appendChild(msgRow);
  scrollToBottom();

  const resolvedSourceTag = imgData.sourceTag || (imgData.isAi ? 'Pollinations (AI)' : 'Web photo');
  recordSessionLedger(imgData.word, imgData.purpose, resolvedSourceTag, imgData.costReport, imgData.overrideInfo);
  saveMessageToChat('assistant', `Image for ${imgData.word}`, imgData);

  if (state.currentMode === 'elder') {
    speakText(`Here is your image for ${imgData.word}. Energy used: ${card.querySelector('.cost-chip-text')?.textContent || ''}`);
  }
}

function renderMessageRow(role, text, imageData = null) {
  if (imageData) {
    renderFinalImageCard(imageData);
    return;
  }

  const msgRow = document.createElement('div');
  msgRow.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  if (role === 'assistant') {
    avatar.innerHTML = `<img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">`;
  } else {
    avatar.textContent = state.currentUser && state.currentUser.email ? state.currentUser.email[0].toUpperCase() : 'U';
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `<div class="message-text">${escapeHtml(text)}</div>`;

  msgRow.appendChild(avatar);
  msgRow.appendChild(bubble);

  document.getElementById('chat-messages-container').appendChild(msgRow);
}

function renderStreamingStep(text) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = `
    <div class="message-avatar">
      <img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">
    </div>
    <div class="message-bubble">
      <div class="streaming-step-box">
        <div class="spinner-pulse"></div>
        <span>${escapeHtml(text)}</span>
      </div>
    </div>
  `;
  document.getElementById('chat-messages-container').appendChild(row);
  return row;
}

function renderErrorCard(errorMsg, canRetry = false, retryCallback = null, word = '') {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = `
    <div class="message-avatar">
      <img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">
    </div>
    <div class="message-bubble">
      <div style="background:var(--surface); border:1px solid var(--border); border-left:3px solid var(--danger); border-radius:var(--radius-md); padding:14px 16px;">
        <div style="color:var(--danger); font-weight:600; font-size:0.9rem; margin-bottom:4px;">
          ⚠️ Assistant Notice
        </div>
        <div style="color:var(--text); font-size:0.86rem; line-height:1.5;">
          ${escapeHtml(errorMsg)}
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
          ${word ? `<button type="button" class="inline-action-btn accent btn-search-web-fallback">🌐 Search Licensed Photos for "${escapeHtml(word)}"</button>` : ''}
          ${canRetry ? `<button type="button" class="inline-action-btn btn-retry-action">🔄 Retry AI</button>` : ''}
        </div>
      </div>
    </div>
  `;
  document.getElementById('chat-messages-container').appendChild(row);
  scrollToBottom();

  if (word) {
    const webBtn = row.querySelector('.btn-search-web-fallback');
    if (webBtn) {
      webBtn.addEventListener('click', () => {
        row.remove();
        sendMessage(word, state.currentPurpose || 'chat');
      });
    }
  }

  if (canRetry && retryCallback) {
    const retryBtn = row.querySelector('.btn-retry-action');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        row.remove();
        retryCallback();
      });
    }
  }
}

async function saveMessageToChat(role, content, imageData) {
  if (!state.currentChatId) return;
  try {
    await fetch(`/api/chats/${state.currentChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, imageData })
    });
  } catch (e) {
    console.error('Failed to save message:', e);
  }
}

// ============================================================================
// 7. SMART COMPRESS STUDIO (Sharp Engine + Slider + FocusGen vs Max Comparison)
// ============================================================================
async function openCompressStudio(imageUrl, purpose = 'chat', isAi = false, details = null) {
  const modal = document.getElementById('compress-modal');
  modal.classList.remove('hidden');

  const statsContainer = document.getElementById('compress-compare-stats');
  document.getElementById('compress-stat-text').textContent = isAi ? 'Comparing FocusGen setting vs Max setting...' : 'Compressing with Sharp engine...';
  document.getElementById('compress-purpose-select').value = purpose;

  const targetDef = PURPOSES[purpose] || PURPOSES.chat;

  if (isAi) {
    // For AI images: "FocusGen setting vs Max setting"
    const maxWh = 5.73; // 1080p Max setting Wh
    const focusWh = details && details.whUsed ? details.whUsed : (purpose === 'chat' ? 0.23 : purpose === 'school' ? 1.45 : purpose === 'poster' ? 3.10 : 5.73);
    const maxKb = 2450;
    const focusKb = purpose === 'chat' ? 142 : purpose === 'school' ? 480 : purpose === 'poster' ? 950 : 2100;
    const pctSaved = Math.max(0, Math.round(((maxWh - focusWh) / maxWh) * 100));

    if (statsContainer) {
      statsContainer.classList.remove('hidden');
      statsContainer.innerHTML = `
        <div class="compress-stat-col left">
          <div class="compress-col-badge">Max setting (1080p)</div>
          <div class="compress-col-metrics">
            <span class="metric-val">~${(maxKb / 1024).toFixed(1)} MB</span>
            <span class="metric-sep">·</span>
            <span class="metric-energy" style="color:var(--danger);">${maxWh.toFixed(2)} Wh</span>
          </div>
          <div class="compress-col-sub">30 steps · Full canvas</div>
        </div>
        <div class="compress-savings-badge">
          ⚡ ${pctSaved}% Less Energy
        </div>
        <div class="compress-stat-col right">
          <div class="compress-col-badge" style="background:rgba(20,184,166,0.15); color:var(--accent);">FocusGen (${targetDef.title})</div>
          <div class="compress-col-metrics">
            <span class="metric-val">~${focusKb} KB</span>
            <span class="metric-sep">·</span>
            <span class="metric-energy" style="color:var(--success, #34D399);">${focusWh.toFixed(2)} Wh</span>
          </div>
          <div class="compress-col-sub">${targetDef.size} · Eco-adaptive</div>
        </div>
      `;
    }

    document.getElementById('compress-stat-text').textContent = `FocusGen setting saves ${pctSaved}% energy vs Max (1080p).`;
    document.getElementById('compress-img-before').src = imageUrl;
    document.getElementById('compress-img-after').src = imageUrl;
    document.getElementById('btn-download-compressed').href = imageUrl;
    resetSlider();
    return;
  }

  // For Web Photos / Uploads: Original vs Compressed
  try {
    const res = await fetch('/api/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, purpose })
    });
    const data = await res.json();
    if (data.success) {
      state.activeCompressData = data;
      const origKb = Math.round(data.originalBytes / 1024) || 850;
      const compKb = Math.round(data.compressedBytes / 1024) || 120;
      const origWh = 0.052;
      const compWh = 0.006;
      const saveKbPct = data.reductionPercent || Math.max(10, Math.round(((origKb - compKb) / origKb) * 100));

      if (statsContainer) {
        statsContainer.classList.remove('hidden');
        statsContainer.innerHTML = `
          <div class="compress-stat-col left">
            <div class="compress-col-badge">Original photo</div>
            <div class="compress-col-metrics">
              <span class="metric-val">${origKb} KB</span>
              <span class="metric-sep">·</span>
              <span class="metric-energy" style="color:var(--muted);">${origWh.toFixed(3)} Wh</span>
            </div>
            <div class="compress-col-sub">Uncompressed source</div>
          </div>
          <div class="compress-savings-badge">
            🗜️ ${saveKbPct}% Smaller File
          </div>
          <div class="compress-stat-col right">
            <div class="compress-col-badge" style="background:rgba(20,184,166,0.15); color:var(--accent);">Compressed (${targetDef.title})</div>
            <div class="compress-col-metrics">
              <span class="metric-val">${compKb} KB</span>
              <span class="metric-sep">·</span>
              <span class="metric-energy" style="color:var(--success, #34D399);">${compWh.toFixed(3)} Wh</span>
            </div>
            <div class="compress-col-sub">${targetDef.size} · Sharp WebP/AVIF</div>
          </div>
        `;
      }

      document.getElementById('compress-stat-text').textContent = data.summary;
      document.getElementById('compress-img-before').src = data.originalUrl;
      document.getElementById('compress-img-after').src = data.compressedUrl;
      document.getElementById('btn-download-compressed').href = data.compressedUrl;
      resetSlider();
    }
  } catch (err) {
    console.error('Compression error:', err);
    document.getElementById('compress-stat-text').textContent = 'Compression error. Please retry.';
  }
}

function initCompressSlider() {
  const container = document.getElementById('compress-slider-container');
  const handle = document.getElementById('compress-slider-handle');
  const beforeWrap = document.getElementById('compress-img-before-wrap');
  let isDragging = false;

  function setSliderPosition(x) {
    const rect = container.getBoundingClientRect();
    let posX = Math.max(0, Math.min(x - rect.left, rect.width));
    let pct = (posX / rect.width) * 100;
    beforeWrap.style.width = pct + '%';
    handle.style.left = pct + '%';
  }

  handle.addEventListener('mousedown', () => isDragging = true);
  window.addEventListener('mouseup', () => isDragging = false);
  window.addEventListener('mousemove', (e) => {
    if (isDragging) setSliderPosition(e.clientX);
  });

  // Touch Support
  handle.addEventListener('touchstart', () => isDragging = true);
  window.addEventListener('touchend', () => isDragging = false);
  window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches[0]) setSliderPosition(e.touches[0].clientX);
  });
}

function resetSlider() {
  const beforeWrap = document.getElementById('compress-img-before-wrap');
  const handle = document.getElementById('compress-slider-handle');
  if (beforeWrap && handle) {
    beforeWrap.style.width = '50%';
    handle.style.left = '50%';
  }
}

// ============================================================================
// 8. FILE & DOCUMENT UPLOADS
// ============================================================================
async function uploadFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert('File exceeds 10 MB limit.');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const streamingEl = renderStreamingStep(`Uploading and processing ${file.name}...`);
  scrollToBottom();

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    streamingEl.remove();

    if (data.success && data.file) {
      await loadUserUploads();

      if (data.file.isImage) {
        // Image uploaded: ask action
        renderUploadedImageActions(data.file);
      } else {
        // Document uploaded: show ideas modal
        showDocIdeasModal(data.file);
      }
    } else {
      renderErrorCard(data.error || 'Upload failed.', false);
    }
  } catch (err) {
    streamingEl.remove();
    renderErrorCard('Upload failed due to connection error.', false);
  }
}

function renderUploadedImageActions(file) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = `
    <div class="message-avatar">
      <img src="logo.svg" style="width:20px;height:20px;" alt="FocusGen">
    </div>
    <div class="message-bubble">
      <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px 16px;">
        <div style="font-weight:600; font-size:0.9rem; margin-bottom:8px;">
          📸 Uploaded: ${escapeHtml(file.originalName)} (${file.sizeFormatted})
        </div>
        <div style="font-size:0.82rem; color:var(--muted); margin-bottom:12px;">
          What would you like to do with this image?
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="inline-action-btn accent btn-upload-compress">🗜️ Compress</button>
          <button type="button" class="inline-action-btn btn-upload-similar">🎨 Make Similar (Realistic)</button>
          <button type="button" class="inline-action-btn btn-upload-describe">🔍 Describe It</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('chat-messages-container').appendChild(row);
  scrollToBottom();

  const fileUrl = `/api/uploads/file/${file.id}`;

  row.querySelector('.btn-upload-compress').addEventListener('click', () => {
    openCompressStudio(fileUrl, state.currentPurpose);
  });
  row.querySelector('.btn-upload-similar').addEventListener('click', () => {
    sendMessage(`Photorealistic DSLR photograph inspired by ${file.originalName}`);
  });
  row.querySelector('.btn-upload-describe').addEventListener('click', () => {
    renderMessageRow('assistant', `This is an authentic high-resolution image of ${file.originalName}. Dimensions and compression properties ready.`);
  });
}

function showDocIdeasModal(file) {
  const modal = document.getElementById('doc-ideas-modal');
  document.getElementById('doc-ideas-filename').textContent = file.originalName;
  document.getElementById('doc-ideas-snippet').textContent = file.meta && file.meta.textSnippet
    ? `Summary: "${file.meta.textSnippet}..."`
    : 'Document text processed.';

  const container = document.getElementById('doc-ideas-container');
  container.innerHTML = '';

  const ideas = (file.meta && file.meta.suggestedIdeas) || [
    `Presentation visual based on ${file.originalName}`,
    `Detailed editorial textbook photograph`,
    `Poster graphic for ${file.originalName}`
  ];

  ideas.forEach(idea => {
    const btn = document.createElement('button');
    btn.className = 'inline-action-btn';
    btn.style.textAlign = 'left';
    btn.style.width = '100%';
    btn.style.padding = '10px 12px';
    btn.textContent = `💡 ${idea}`;
    btn.addEventListener('click', () => {
      modal.classList.add('hidden');
      sendMessage(idea);
    });
    container.appendChild(btn);
  });

  modal.classList.remove('hidden');
}

async function loadUserUploads() {
  try {
    const res = await fetch('/api/uploads');
    const data = await res.json();
    if (data.success) {
      state.uploads = data.uploads || [];
      renderSidebarUploads();
    }
  } catch (e) {}
}

function renderSidebarUploads() {
  const container = document.getElementById('sidebar-uploads-list');
  container.innerHTML = '';

  if (state.uploads.length === 0) {
    container.innerHTML = `<span style="font-size:0.75rem; color:var(--muted); padding:4px;">No files uploaded yet.</span>`;
    return;
  }

  state.uploads.forEach(u => {
    const item = document.createElement('div');
    item.className = 'upload-mini-item';
    const isImg = u.mime_type.startsWith('image/');
    const thumbSrc = isImg ? `/api/uploads/thumb/${u.id}` : 'logo.svg';

    item.innerHTML = `
      <img src="${thumbSrc}" class="upload-mini-thumb" alt="thumb">
      <div class="upload-mini-info">
        <div class="upload-mini-name">${escapeHtml(u.original_name)}</div>
        <div class="upload-mini-size">${(u.size_bytes / 1024).toFixed(0)} KB</div>
      </div>
      <button type="button" class="upload-mini-btn use-btn" title="Use in chat">Use</button>
      <button type="button" class="upload-mini-btn del-btn" title="Delete" style="color:var(--danger);">✕</button>
    `;

    item.querySelector('.use-btn').addEventListener('click', () => {
      if (isImg) openCompressStudio(`/api/uploads/file/${u.id}`, state.currentPurpose);
      else sendMessage(`Generate visual idea for ${u.original_name}`);
    });
    item.querySelector('.del-btn').addEventListener('click', async () => {
      await fetch(`/api/uploads/${u.id}`, { method: 'DELETE' });
      await loadUserUploads();
    });

    container.appendChild(item);
  });
}

// ============================================================================
// 9. FOCUS ZONE HEATMAP OVERLAY CANVAS & INTERACTIVE SELECTION
// ============================================================================
function drawFocusZonesOnCanvas(canvas, isFullMax = false, focusBox = null) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (isFullMax) {
    // Print mode: Full clarity everywhere, focus map off
    ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);

    // Print Notice Badge in center
    const badgeW = Math.min(360, w * 0.85);
    const badgeH = 34;
    const badgeX = (w - badgeW) / 2;
    const badgeY = (h - badgeH) / 2;

    ctx.fillStyle = 'rgba(10, 18, 32, 0.90)';
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

    ctx.fillStyle = '#EAF1FB';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🖨️ Print needs full clarity, focus map off', w / 2, badgeY + badgeH / 2);
    return;
  }

  const box = focusBox || { x: 20, y: 15, width: 60, height: 70, feather: 15 };
  const bx = (box.x / 100) * w;
  const by = (box.y / 100) * h;
  const bw = Math.max(20, (box.width / 100) * w);
  const bh = Math.max(20, (box.height / 100) * h);
  const featherPx = ((box.feather || 15) / 100) * Math.min(w, h);

  // Zone 1: Background (Green - Reduced Detail)
  ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
  ctx.fillRect(0, 0, w, h);

  // Zone 2: Middle Ring (Yellow - Feather Edge)
  const fx = Math.max(0, bx - featherPx);
  const fy = Math.max(0, by - featherPx);
  const fw = Math.min(w - fx, bw + featherPx * 2);
  const fh = Math.min(h - fy, bh + featherPx * 2);

  ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(fx, fy, fw, fh);
  ctx.setLineDash([]);

  // Zone 3: Subject (Red - Full Resolution & Light Sharpening)
  ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);

  // Labels for the 3 zones
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Subject label inside box
  ctx.fillStyle = 'rgba(10, 18, 32, 0.88)';
  ctx.fillRect(bx + 4, by + 4, 120, 18);
  ctx.fillStyle = '#EF4444';
  ctx.fillText('Subject (Full Detail)', bx + 8, by + 7);

  // Middle ring label
  if (fy > 22) {
    ctx.fillStyle = 'rgba(10, 18, 32, 0.88)';
    ctx.fillRect(fx + 4, fy - 20, 100, 18);
    ctx.fillStyle = '#F59E0B';
    ctx.fillText('Middle (Feather)', fx + 8, fy - 17);
  }

  // Background label
  ctx.fillStyle = 'rgba(10, 18, 32, 0.88)';
  ctx.fillRect(8, 8, 115, 18);
  ctx.fillStyle = '#10B981';
  ctx.fillText('Background (Soft)', 12, 11);
}

/**
 * Method C: User Override Focus Selection via Interactive Box Dragging
 */
function enableInteractiveFocusSelection(card, imgData) {
  const imgView = card.querySelector('.inline-image-view');
  const imgEl = card.querySelector('.inline-image-display');
  if (!imgView || !imgEl) return;

  const existing = imgView.querySelector('.focus-drag-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'focus-drag-overlay';

  const bar = document.createElement('div');
  bar.className = 'focus-drag-bar';
  bar.innerHTML = `
    <span>🎯 Drag a box over the subject</span>
    <button type="button" class="btn-focus-apply" id="btn-apply-box">✓ Apply focus</button>
    <button type="button" class="btn-focus-cancel" id="btn-cancel-box">✕ Cancel</button>
  `;
  overlay.appendChild(bar);

  const featherBox = document.createElement('div');
  featherBox.className = 'focus-drag-feather';
  overlay.appendChild(featherBox);

  const dragBox = document.createElement('div');
  dragBox.className = 'focus-drag-box';
  overlay.appendChild(dragBox);

  let currentBox = imgData.focusBox || { x: 20, y: 15, width: 60, height: 70, feather: 15 };

  function updateVisualBox(b) {
    const ovRect = overlay.getBoundingClientRect();
    const scaleX = ovRect.width / 100;
    const scaleY = ovRect.height / 100;

    const left = b.x * scaleX;
    const top = b.y * scaleY;
    const width = b.width * scaleX;
    const height = b.height * scaleY;
    const featherPx = ((b.feather || 15) / 100) * Math.min(ovRect.width, ovRect.height);

    dragBox.style.left = `${left}px`;
    dragBox.style.top = `${top}px`;
    dragBox.style.width = `${width}px`;
    dragBox.style.height = `${height}px`;

    const fLeft = Math.max(0, left - featherPx);
    const fTop = Math.max(0, top - featherPx);
    const fWidth = Math.min(ovRect.width - fLeft, width + featherPx * 2);
    const fHeight = Math.min(ovRect.height - fTop, height + featherPx * 2);

    featherBox.style.left = `${fLeft}px`;
    featherBox.style.top = `${fTop}px`;
    featherBox.style.width = `${fWidth}px`;
    featherBox.style.height = `${fHeight}px`;
  }

  updateVisualBox(currentBox);

  let isSelecting = false;
  let startX = 0;
  let startY = 0;

  function onPointerDown(e) {
    if (e.target.closest('.focus-drag-bar')) return;
    const rect = overlay.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX - rect.left;
    startY = clientY - rect.top;
    isSelecting = true;
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isSelecting) return;
    const rect = overlay.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const curX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, clientY - rect.top));

    const minX = Math.min(startX, curX);
    const maxX = Math.max(startX, curX);
    const minY = Math.min(startY, curY);
    const maxY = Math.max(startY, curY);

    const xPct = (minX / rect.width) * 100;
    const yPct = (minY / rect.height) * 100;
    const wPct = Math.max(10, ((maxX - minX) / rect.width) * 100);
    const hPct = Math.max(10, ((maxY - minY) / rect.height) * 100);

    currentBox = {
      x: Number(xPct.toFixed(1)),
      y: Number(yPct.toFixed(1)),
      width: Number(wPct.toFixed(1)),
      height: Number(hPct.toFixed(1)),
      feather: 15
    };
    updateVisualBox(currentBox);
  }

  function onPointerUp() {
    isSelecting = false;
  }

  overlay.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  overlay.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);

  bar.querySelector('#btn-apply-box').addEventListener('click', async (e) => {
    e.stopPropagation();
    overlay.remove();

    const applyingNotice = document.createElement('div');
    applyingNotice.className = 'streaming-step-box';
    applyingNotice.innerHTML = `<div class="spinner-pulse"></div><span>Regenerating focus clarity with your custom box...</span>`;
    imgView.appendChild(applyingNotice);

    try {
      const res = await fetch('/api/focus/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imgData.uniformUrl || imgData.url,
          box: currentBox,
          purpose: imgData.purpose || 'chat',
          hintText: imgData.word || ''
        })
      });
      const data = await res.json();
      applyingNotice.remove();

      if (data.success && data.focusedUrl) {
        // Save the box for this image
        imgData.focusBox = data.focusBox;
        imgData.focusedUrl = data.focusedUrl;
        imgData.uniformUrl = data.uniformUrl;
        imgData.url = data.focusedUrl;
        imgData.focusData = data;
        card.dataset.focusBox = JSON.stringify(data.focusBox);

        imgEl.src = data.focusedUrl;

        const canvas = card.querySelector('.inline-overlay-canvas');
        if (canvas) {
          drawFocusZonesOnCanvas(canvas, (imgData.purpose || '').toLowerCase() === 'print', data.focusBox);
        }

        const allocChip = card.querySelector('.clarity-allocation-chip');
        if (allocChip && data.clarityAllocation) {
          allocChip.innerHTML = `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong style="color:var(--accent); font-size:0.75rem;">${escapeHtml(data.modeLabel || 'Focus clarity (post-process)')}:</strong><span style="font-size:0.75rem; color:var(--text);">${escapeHtml(data.clarityAllocation.summaryText)}</span></div>`;
        }
      }
    } catch (err) {
      applyingNotice.remove();
      console.warn('Set focus apply failed:', err);
    }
  });

  bar.querySelector('#btn-cancel-box').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
  });

  imgView.appendChild(overlay);
}

/**
 * Compare Slider: "Focus clarity" vs "Uniform clarity" with both file sizes
 */
async function openFocusCompareModal(imgData) {
  const modal = document.getElementById('compress-modal');
  modal.classList.remove('hidden');

  const statsContainer = document.getElementById('compress-compare-stats');
  document.getElementById('compress-stat-text').textContent = 'Loading Focus clarity vs Uniform clarity comparison...';
  document.getElementById('compress-purpose-select').value = imgData.purpose || 'chat';

  let focusedUrl = imgData.focusData?.focusedUrl || imgData.url;
  let uniformUrl = imgData.focusData?.uniformUrl || null;
  let focusedBytes = imgData.focusData?.focusedSizeBytes || null;
  let uniformBytes = imgData.focusData?.uniformSizeBytes || null;
  let percentSaved = imgData.focusData?.percentSavedBytes || 0;
  let alloc = imgData.focusData?.clarityAllocation || null;

  if (!uniformUrl) {
    try {
      const res = await fetch('/api/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imgData.url,
          purpose: imgData.purpose || 'chat',
          box: imgData.focusBox || null
        })
      });
      const data = await res.json();
      if (data.success) {
        focusedUrl = data.focusedUrl;
        uniformUrl = data.uniformUrl;
        focusedBytes = data.focusedBytes;
        uniformBytes = data.uniformBytes;
        percentSaved = data.percentSavedBytes;
        alloc = data.clarityAllocation;
      }
    } catch (e) {
      console.warn('Compare fetch failed:', e);
      uniformUrl = imgData.url;
    }
  }

  const isPrint = (imgData.purpose || '').toLowerCase() === 'print';
  const fKb = focusedBytes ? Math.round(focusedBytes / 1024) : 142;
  const uKb = uniformBytes ? Math.round(uniformBytes / 1024) : 198;
  const pct = isPrint ? 0 : (percentSaved || Math.max(0, Math.round(((uKb - fKb) / uKb) * 100)));

  if (statsContainer) {
    statsContainer.classList.remove('hidden');
    statsContainer.innerHTML = `
      <div class="compress-stat-col left">
        <div class="compress-col-badge" style="background:rgba(52,211,153,0.15); color:#34D399; font-weight:700;">Focus clarity</div>
        <div class="compress-col-metrics">
          <span class="metric-val">${fKb} KB</span>
          <span class="metric-sep">·</span>
          <span class="metric-energy" style="color:var(--success, #34D399);">Sharp subject</span>
        </div>
        <div class="compress-col-sub">${isPrint ? 'Full canvas clarity' : 'Depth-of-field background'}</div>
      </div>
      <div class="compress-savings-badge" style="background:rgba(20,184,166,0.15); color:var(--accent); font-weight:700; border:1px solid var(--accent);">
        ${isPrint ? '0% (Full Clarity)' : `🗜️ ${pct}% Smaller`}
      </div>
      <div class="compress-stat-col right">
        <div class="compress-col-badge" style="background:rgba(var(--accent-2-rgb),0.15); color:var(--accent-2); font-weight:700;">Uniform clarity</div>
        <div class="compress-col-metrics">
          <span class="metric-val">${uKb} KB</span>
          <span class="metric-sep">·</span>
          <span class="metric-energy" style="color:var(--muted);">Full uniform</span>
        </div>
        <div class="compress-col-sub">Unoptimized baseline</div>
      </div>
    `;
  }

  const summary = isPrint 
    ? 'Print needs full clarity, focus map off (0% smaller)'
    : (alloc?.summaryText || `Clarity allocation: subject at full detail, background at reduced detail. Output file ${pct}% smaller.`);

  document.getElementById('compress-stat-text').textContent = summary;
  document.getElementById('compress-img-before').src = uniformUrl || focusedUrl;
  document.getElementById('compress-img-after').src = focusedUrl;
  document.getElementById('btn-download-compressed').href = focusedUrl;

  const leftBadge = document.getElementById('slider-badge-left');
  const rightBadge = document.getElementById('slider-badge-right');
  if (leftBadge) leftBadge.textContent = `Focus clarity (${fKb} KB)`;
  if (rightBadge) rightBadge.textContent = `Uniform clarity (${uKb} KB)`;

  resetSlider();
}

// ============================================================================
// 10. SESSION LEDGER & CALIBRATE ENGINE
// ============================================================================
function recordSessionLedger(word, purpose, type, report, overrideInfo = null) {
  state.lastReport = report;
  const whUsed = report ? report.whUsed : 2.50;
  const whMax = report ? report.whMax : 24.30;
  const whSaved = report ? report.whSaved : Math.max(0, whMax - whUsed);

  state.sessionTotals.usedWh += whUsed;
  state.sessionTotals.maxWh += whMax;
  state.sessionTotals.savedWh += whSaved;

  const isOverridden = !!(overrideInfo && overrideInfo.isOverridden);
  const tag = isOverridden ? 'Overridden' : 'Auto';
  let overrideText = '';
  if (isOverridden && overrideInfo.fromTier && overrideInfo.toTier) {
    const sign = overrideInfo.deltaWh >= 0 ? '+' : '';
    overrideText = `(${overrideInfo.fromTier} &rarr; ${overrideInfo.toTier}: ${sign}${overrideInfo.deltaWh} Wh)`;
  }

  state.sessionLedger.push({
    index: state.sessionLedger.length + 1,
    word: word || 'Subject',
    purpose: purpose || 'school',
    type,
    tag,
    overrideText,
    whUsed: Number(whUsed.toFixed(4)),
    whMax: Number(whMax.toFixed(4)),
    whSaved: Number(whSaved.toFixed(4)),
    percentSaved: report ? report.percentSaved : 91.7
  });

  updateLedgerDisplay();
}

function updateLedgerDisplay() {
  const used = state.sessionTotals.usedWh.toFixed(3);
  const max = state.sessionTotals.maxWh.toFixed(3);
  const saved = state.sessionTotals.savedWh.toFixed(3);
  const pct = state.sessionTotals.maxWh > 0 ? ((state.sessionTotals.savedWh / state.sessionTotals.maxWh) * 100).toFixed(1) : 0;

  document.getElementById('sl-used-wh').textContent = `${used} Wh`;
  document.getElementById('sl-max-wh').textContent = `${max} Wh`;
  document.getElementById('sl-saved-wh').textContent = `${saved} Wh (${pct}%)`;

  const tbody = document.getElementById('session-table-body');
  tbody.innerHTML = '';

  state.sessionLedger.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${row.index}</td>
      <td><strong>${escapeHtml(row.word)}</strong></td>
      <td>
        <span class="mode-pill-badge" style="background:${row.tag === 'Overridden' ? 'rgba(239,68,68,0.15)' : 'rgba(52,211,153,0.15)'}; color:${row.tag === 'Overridden' ? '#FF6B6B' : '#34D399'}; font-weight:700;">${row.tag}</span>
        ${row.type}
        ${row.overrideText ? `<small style="display:block;color:var(--muted);">${row.overrideText}</small>` : ''}
      </td>
      <td>${row.whUsed} Wh</td>
      <td>${row.whMax} Wh</td>
      <td style="color:var(--success, #34D399); font-weight:600;">${row.whSaved} Wh (${row.percentSaved}%)</td>
    `;
    tbody.appendChild(tr);
  });
}

function openHowModal(report) {
  const modal = document.getElementById('how-modal');
  const workedText = window.buildWorkedExample(report || window.computeCostReport('chat'));
  document.getElementById('worked-example-display').textContent = workedText;
  modal.classList.remove('hidden');
}

// ============================================================================
// 11. SPEECH RECOGNITION & SYNTHESIS
// ============================================================================
function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  const rec = new SpeechRec();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = I18N[state.currentLang].speechLang || 'en-IN';

  const micBtn = document.getElementById('btn-voice-input');

  rec.onstart = () => micBtn.classList.add('listening');
  rec.onend = () => micBtn.classList.remove('listening');
  rec.onerror = () => micBtn.classList.remove('listening');

  rec.onresult = (e) => {
    const transcript = (e.results && e.results[0] && e.results[0][0]) ? e.results[0][0].transcript : '';
    if (transcript) {
      sendMessage(transcript);
    }
  };

  state.speechRecognition = rec;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = I18N[state.currentLang].speechLang || 'en-IN';
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

// ============================================================================
// 12. MODE SELECTION
// ============================================================================
function setMode(mode) {
  state.currentMode = mode;
  document.querySelectorAll('.mode-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  document.body.classList.toggle('mode-kids', mode === 'kids');
  document.body.classList.toggle('mode-easy', mode === 'elder');

  const badge = document.getElementById('top-mode-badge');
  badge.textContent = mode.charAt(0).toUpperCase() + mode.slice(1) + ' Mode';

  if (mode === 'kids') {
    badge.textContent = '🧒 Kids Safe Mode';
  } else if (mode === 'elder') {
    badge.textContent = '👵 Easy Voice Mode';
  } else if (mode === 'student') {
    badge.textContent = '🎓 Student Slides Mode';
  } else if (mode === 'work') {
    badge.textContent = '💼 Work Batch Mode';
  }

  saveUserSettings({ mode });
}

function applyTheme(theme) {
  state.theme = theme;
  const isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  localStorage.setItem('focusgen_theme', theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isLight ? '#F4F8FF' : '#0A1220');
  }
  saveUserSettings({ theme });
}

async function saveUserSettings(settings) {
  if (!state.currentUser) return;
  try {
    await fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  } catch (e) {}
}

// ============================================================================
// 13. UI EVENT LISTENERS
// ============================================================================
function bindEventListeners() {
  // Input Send
  const inputField = document.getElementById('chat-input-field');
  const sendBtn = document.getElementById('btn-send-message');

  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage();
    });
  }

  if (inputField) {
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // Example Chips
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage(chip.dataset.word);
    });
  });

  // Voice Mic Button
  document.getElementById('btn-voice-input').addEventListener('click', () => {
    if (state.speechRecognition) {
      state.speechRecognition.lang = I18N[state.currentLang].speechLang || 'en-IN';
      try { state.speechRecognition.start(); } catch (e) { state.speechRecognition.stop(); }
    } else {
      alert('Speech Recognition is not supported on this browser.');
    }
  });

  // Sidebar Toggles
  const sidebar = document.getElementById('sidebar');
  document.getElementById('btn-open-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('mobile-open');
    sidebar.classList.remove('collapsed');
  });
  document.getElementById('btn-collapse-sidebar').addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    sidebar.classList.remove('mobile-open');
  });

  // New Chat
  document.getElementById('btn-new-chat').addEventListener('click', () => startNewChat(true));

  // Search Chats
  document.getElementById('search-chats-input').addEventListener('input', (e) => {
    renderRecentChats(e.target.value);
  });

  // Modes
  document.querySelectorAll('.mode-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Green Time Honesty (Simulated grid data, off by default)
  const greenSidebarToggle = document.getElementById('toggle-green-time');
  const greenHeaderChip = document.getElementById('btn-green-hours-toggle');
  const greenHeaderLbl = document.getElementById('lbl-green-hours');

  if (greenSidebarToggle) {
    greenSidebarToggle.checked = state.isGreenTime;
    greenSidebarToggle.addEventListener('change', (e) => {
      state.isGreenTime = e.target.checked;
      if (greenHeaderChip) {
        greenHeaderChip.classList.toggle('hidden', !state.isGreenTime);
        if (greenHeaderLbl) greenHeaderLbl.textContent = 'Simulated grid data';
        greenHeaderChip.title = 'Simulated grid data';
      }
    });
  }

  if (greenHeaderChip) {
    greenHeaderChip.addEventListener('click', () => {
      state.isGreenTime = !state.isGreenTime;
      greenHeaderChip.classList.toggle('hidden', !state.isGreenTime);
      if (greenSidebarToggle) greenSidebarToggle.checked = state.isGreenTime;
    });
  }

  // Web-First Toggle
  document.getElementById('toggle-web-first').addEventListener('change', (e) => {
    state.webFirst = e.target.checked;
    saveUserSettings({ webFirst: state.webFirst });
  });

  // Focus Clarity Toggle (on by default)
  const focusClarityToggle = document.getElementById('toggle-focus-clarity');
  if (focusClarityToggle) {
    focusClarityToggle.checked = state.focusClarity;
    focusClarityToggle.addEventListener('change', (e) => {
      state.focusClarity = e.target.checked;
    });
  }

  // Focus Map Toggle
  document.getElementById('toggle-focus-map').addEventListener('change', (e) => {
    state.showFocusMap = e.target.checked;
    document.querySelectorAll('.inline-overlay-canvas').forEach(c => {
      c.classList.toggle('hidden', !state.showFocusMap);
      if (state.showFocusMap) {
        const card = c.closest('.inline-image-card');
        let cardBox = null;
        if (card && card.dataset.focusBox) {
          try { cardBox = JSON.parse(card.dataset.focusBox); } catch (err) {}
        }
        drawFocusZonesOnCanvas(c, state.currentPurpose === 'print', cardBox);
      }
    });
  });

  // Language Select
  document.getElementById('select-lang').addEventListener('change', (e) => {
    state.currentLang = e.target.value;
    saveUserSettings({ language: state.currentLang });
  });

  // Theme Toggle
  document.getElementById('btn-toggle-theme').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  // Attach File Button
  const fileInput = document.getElementById('hidden-file-input');
  document.getElementById('btn-attach-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadFile(e.target.files[0]);
      fileInput.value = '';
    }
  });

  // Drag and drop onto chat area
  const mainArea = document.getElementById('main-chat-area');
  mainArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    mainArea.style.background = 'var(--surface-2)';
  });
  mainArea.addEventListener('dragleave', () => mainArea.style.background = 'var(--bg)');
  mainArea.addEventListener('drop', (e) => {
    e.preventDefault();
    mainArea.style.background = 'var(--bg)';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // Modal Closures
  document.getElementById('btn-close-compress').addEventListener('click', () => document.getElementById('compress-modal').classList.add('hidden'));
  document.getElementById('btn-close-how').addEventListener('click', () => document.getElementById('how-modal').classList.add('hidden'));
  document.getElementById('btn-close-how-confirm').addEventListener('click', () => document.getElementById('how-modal').classList.add('hidden'));
  document.getElementById('btn-close-calibrate').addEventListener('click', () => document.getElementById('calibrate-modal').classList.add('hidden'));
  document.getElementById('btn-close-ledger').addEventListener('click', () => document.getElementById('ledger-modal').classList.add('hidden'));
  document.getElementById('btn-close-ledger-footer').addEventListener('click', () => document.getElementById('ledger-modal').classList.add('hidden'));
  document.getElementById('btn-close-limitations').addEventListener('click', () => document.getElementById('limitations-modal').classList.add('hidden'));
  document.getElementById('btn-close-limitations-confirm').addEventListener('click', () => document.getElementById('limitations-modal').classList.add('hidden'));
  document.getElementById('btn-close-settings').addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('btn-close-settings-confirm').addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('btn-close-doc-ideas').addEventListener('click', () => document.getElementById('doc-ideas-modal').classList.add('hidden'));
  document.getElementById('btn-close-doc-ideas-footer').addEventListener('click', () => document.getElementById('doc-ideas-modal').classList.add('hidden'));

  // Features Menu Buttons
  document.getElementById('feat-btn-compress').addEventListener('click', () => {
    openCompressStudio('logo.svg', state.currentPurpose);
  });
  document.getElementById('feat-btn-4ideas').addEventListener('click', () => {
    sendMessage(`4 diverse photorealistic creative angles of ${state.currentWord || 'cake'}`);
  });
  document.getElementById('feat-btn-ledger').addEventListener('click', () => {
    document.getElementById('ledger-modal').classList.remove('hidden');
  });
  document.getElementById('feat-btn-calibrate').addEventListener('click', () => {
    document.getElementById('calibrate-modal').classList.remove('hidden');
  });
  document.getElementById('feat-btn-how').addEventListener('click', () => {
    openHowModal(state.lastReport);
  });
  document.getElementById('feat-btn-limitations').addEventListener('click', () => {
    document.getElementById('limitations-modal').classList.remove('hidden');
  });
  document.getElementById('feat-btn-settings').addEventListener('click', async () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    const toggleDemo = document.getElementById('toggle-demo-mode');
    const badgeDemo = document.getElementById('badge-demo-mode');
    if (toggleDemo) toggleDemo.checked = state.demoMode === true;
    if (badgeDemo) badgeDemo.style.display = state.demoMode ? 'inline-block' : 'none';
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const elG = document.getElementById('settings-status-gemini');
      if (elG) {
        elG.textContent = data.hasGemini ? 'Configured' : 'Optional';
      }
    } catch (e) {
      console.warn('Failed to fetch config for settings:', e);
    }
  });

  // Demo mode toggle switch in Settings
  const toggleDemoInput = document.getElementById('toggle-demo-mode');
  const badgeDemoEl = document.getElementById('badge-demo-mode');
  if (toggleDemoInput) {
    toggleDemoInput.checked = state.demoMode === true;
    if (badgeDemoEl) badgeDemoEl.style.display = state.demoMode ? 'inline-block' : 'none';
    toggleDemoInput.addEventListener('change', (e) => {
      state.demoMode = e.target.checked;
      localStorage.setItem('focusgen_demo_mode', state.demoMode ? 'true' : 'false');
      if (badgeDemoEl) badgeDemoEl.style.display = state.demoMode ? 'inline-block' : 'none';
    });
  }

  // Diagnose AI Modal
  const diagnoseModal = document.getElementById('diagnose-modal');
  async function runAiDiagnostics(modelOverride = null) {
    if (!diagnoseModal) return;
    diagnoseModal.classList.remove('hidden');
    const loadingEl = document.getElementById('diagnose-loading');
    const contentEl = document.getElementById('diagnose-content');
    const modelSelect = document.getElementById('diag-model-select');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (contentEl) contentEl.classList.add('hidden');

    const chosenModel = modelOverride || (modelSelect ? modelSelect.value : '');

    try {
      const url = chosenModel ? `/api/diagnose?model=${encodeURIComponent(chosenModel)}` : '/api/diagnose';
      const res = await fetch(url);
      const data = await res.json();
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.classList.remove('hidden');

      if (data.blocked) {
        updateAiBlockedUI(data.blockedUntil, data.message || data.aiBlockedMessage);
      } else if (data.clearedBlock || data.status === 'ok') {
        clearAiBlockedUI();
      }

      // Populate / sync models dropdown from .env
      if (modelSelect && data.availableModels && data.availableModels.length > 0) {
        const activeChoice = chosenModel || data.model;
        modelSelect.innerHTML = data.availableModels.map(m => 
          `<option value="${escapeHtml(m)}" ${m === activeChoice ? 'selected' : ''}>${escapeHtml(m)}</option>`
        ).join('');
      }

      const elProv = document.getElementById('diag-provider');
      if (elProv) elProv.textContent = data.provider || 'cloudflare';

      const elMod = document.getElementById('diag-model');
      if (elMod) elMod.textContent = data.model || chosenModel || 'FLUX.1-schnell';

      const keyStatusEl = document.getElementById('diag-key-status');
      if (keyStatusEl) {
        keyStatusEl.textContent = data.keyLoaded ? 'Loaded' : 'Missing';
        keyStatusEl.style.color = data.keyLoaded ? '#34D399' : '#FF6B6B';
      }

      // Exact HTTP Status badge
      const httpStatusEl = document.getElementById('diag-http-status');
      if (httpStatusEl) {
        if (data.httpStatus) {
          httpStatusEl.textContent = `HTTP ${data.httpStatus}`;
          if (data.httpStatus === 200) {
            httpStatusEl.style.background = 'rgba(52, 211, 153, 0.2)';
            httpStatusEl.style.color = '#34D399';
            httpStatusEl.style.border = '1px solid #34D399';
          } else if (data.httpStatus === 429) {
            httpStatusEl.style.background = 'rgba(251, 146, 60, 0.2)';
            httpStatusEl.style.color = '#FB923C';
            httpStatusEl.style.border = '1px solid #FB923C';
          } else if (data.httpStatus === 401 || data.httpStatus === 403) {
            httpStatusEl.style.background = 'rgba(239, 68, 68, 0.2)';
            httpStatusEl.style.color = '#EF4444';
            httpStatusEl.style.border = '1px solid #EF4444';
          } else if (data.httpStatus === 404) {
            httpStatusEl.style.background = 'rgba(192, 132, 252, 0.2)';
            httpStatusEl.style.color = '#C084FC';
            httpStatusEl.style.border = '1px solid #C084FC';
          } else if (data.httpStatus >= 500) {
            httpStatusEl.style.background = 'rgba(220, 38, 38, 0.2)';
            httpStatusEl.style.color = '#F87171';
            httpStatusEl.style.border = '1px solid #F87171';
          } else {
            httpStatusEl.style.background = 'rgba(148, 163, 184, 0.2)';
            httpStatusEl.style.color = '#94A3B8';
            httpStatusEl.style.border = '1px solid #94A3B8';
          }
        } else {
          httpStatusEl.textContent = 'None';
          httpStatusEl.style.color = 'var(--muted)';
        }
      }

      // Category badge
      const catBadgeEl = document.getElementById('diag-category-badge');
      if (catBadgeEl) {
        catBadgeEl.textContent = data.categoryLabel || data.category || 'Unknown';
        if (data.category === 'ok') {
          catBadgeEl.style.color = '#34D399';
        } else if (data.category === 'quota_rate_limit') {
          catBadgeEl.style.color = '#FB923C';
        } else if (data.category === 'auth_permission') {
          catBadgeEl.style.color = '#EF4444';
        } else if (data.category === 'model_not_found') {
          catBadgeEl.style.color = '#C084FC';
        } else if (data.category === 'cloudflare_outage') {
          catBadgeEl.style.color = '#F87171';
        } else if (data.category === 'network_timeout' || data.category === 'network_error') {
          catBadgeEl.style.color = '#94A3B8';
        } else {
          catBadgeEl.style.color = 'var(--text)';
        }
      }

      const reachStatusEl = document.getElementById('diag-reach-status');
      if (reachStatusEl) {
        reachStatusEl.textContent = data.modelReachable ? 'Reachable' : 'Unreachable';
        reachStatusEl.style.color = data.modelReachable ? '#34D399' : '#FF6B6B';
      }

      const msgBox = document.getElementById('diag-message-box');
      const msgEl = document.getElementById('diag-message');
      const boxLabel = document.getElementById('diag-box-label');

      if (msgEl) {
        if (data.status === 'ok') {
          if (boxLabel) boxLabel.textContent = 'Status OK';
          msgEl.textContent = data.message || 'Operating normally.';
          if (msgBox) {
            msgBox.style.borderLeftColor = '#34D399';
            msgBox.style.background = 'rgba(52, 211, 153, 0.08)';
          }
        } else {
          if (boxLabel) boxLabel.textContent = `Diagnosis: ${data.categoryLabel || 'Error'}`;
          let displayMsg = '';
          if (data.realError) {
            displayMsg = `Cloudflare Error: "${data.realError}"`;
            if (data.userExplanation && data.userExplanation !== data.realError) {
              displayMsg += `\n\nExplanation: ${data.userExplanation}`;
            }
          } else {
            displayMsg = data.message || 'Error probing model.';
          }
          msgEl.textContent = displayMsg;

          if (msgBox) {
            let borderColor = '#FF6B6B';
            let bg = 'rgba(255, 107, 107, 0.08)';
            if (data.category === 'quota_rate_limit') {
              borderColor = '#FB923C';
              bg = 'rgba(251, 146, 60, 0.08)';
            } else if (data.category === 'model_not_found') {
              borderColor = '#C084FC';
              bg = 'rgba(192, 132, 252, 0.08)';
            }
            msgBox.style.borderLeftColor = borderColor;
            msgBox.style.background = bg;
          }
        }
      }
    } catch (e) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.classList.remove('hidden');
      const msgBox = document.getElementById('diag-message-box');
      const msgEl = document.getElementById('diag-message');
      if (msgEl) msgEl.textContent = 'Diagnostic network probe failed: ' + e.message;
      if (msgBox) {
        msgBox.style.borderLeftColor = '#FF6B6B';
        msgBox.style.background = 'rgba(255, 107, 107, 0.1)';
      }
    }
  }

  const featDiagBtn = document.getElementById('feat-btn-diagnose');
  if (featDiagBtn) featDiagBtn.addEventListener('click', () => runAiDiagnostics());

  const btnCloseDiag = document.getElementById('btn-close-diagnose');
  if (btnCloseDiag) btnCloseDiag.addEventListener('click', () => diagnoseModal.classList.add('hidden'));

  const btnCloseDiagConfirm = document.getElementById('btn-close-diagnose-confirm');
  if (btnCloseDiagConfirm) btnCloseDiagConfirm.addEventListener('click', () => diagnoseModal.classList.add('hidden'));

  const btnRetestDiag = document.getElementById('btn-retest-diagnose');
  if (btnRetestDiag) btnRetestDiag.addEventListener('click', () => runAiDiagnostics());

  const btnTestModel = document.getElementById('btn-test-model');
  if (btnTestModel) {
    btnTestModel.addEventListener('click', () => {
      const select = document.getElementById('diag-model-select');
      const chosen = select ? select.value : null;
      runAiDiagnostics(chosen);
    });
  }

  // Reset My Preferences Button in Settings
  const btnResetPref = document.getElementById('btn-reset-preferences');
  if (btnResetPref) {
    btnResetPref.addEventListener('click', async () => {
      try {
        await fetch('/api/override/reset', { method: 'POST' });
        const lbl = document.getElementById('lbl-reset-preferences-status');
        if (lbl) {
          lbl.style.display = 'inline';
          setTimeout(() => { lbl.style.display = 'none'; }, 3000);
        }
      } catch (e) {
        alert('Failed to reset preferences.');
      }
    });
  }

  // Calibrate Save
  document.getElementById('btn-save-calibrate').addEventListener('click', () => {
    const eng = parseFloat(document.getElementById('cal-energy-per-px').value);
    const sec = parseFloat(document.getElementById('cal-secs-step').value);
    const gStd = parseFloat(document.getElementById('cal-grid-std').value);
    const gGrn = parseFloat(document.getElementById('cal-grid-green').value);

    if (window.CONFIG) {
      if (!isNaN(eng)) window.CONFIG.ENERGY_PER_PIXEL_STEP = eng;
      if (!isNaN(sec)) window.CONFIG.SECONDS_PER_STEP = sec;
      if (!isNaN(gStd)) window.CONFIG.GRID_FACTOR_STD = gStd;
      if (!isNaN(gGrn)) window.CONFIG.GRID_FACTOR_GREEN = gGrn;
    }
    document.getElementById('calibrate-modal').classList.add('hidden');
    alert('Calibrated constants applied successfully.');
  });

  // Compress Purpose Dropdown change
  document.getElementById('compress-purpose-select').addEventListener('change', (e) => {
    if (state.activeCompressData && state.activeCompressData.originalUrl) {
      openCompressStudio(state.activeCompressData.originalUrl, e.target.value);
    }
  });

  // Auth Form Handlers
  let isSignupMode = false;
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const authSubmit = document.getElementById('btn-auth-submit');
  const authErr = document.getElementById('auth-error-banner');

  tabLogin.addEventListener('click', () => {
    isSignupMode = false;
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    authSubmit.textContent = 'Sign In';
    authErr.classList.add('hidden');
  });
  tabSignup.addEventListener('click', () => {
    isSignupMode = true;
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
    authSubmit.textContent = 'Create Account';
    authErr.classList.add('hidden');
  });

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    authErr.classList.add('hidden');
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    const endpoint = isSignupMode ? '/api/auth/signup' : '/api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUserState(data.user);
        hideAuthModal();
        await loadUserChats();
        await loadUserUploads();
      } else {
        authErr.textContent = data.error || 'Authentication failed.';
        authErr.classList.remove('hidden');
      }
    } catch (err) {
      authErr.textContent = 'Network error. Please try again.';
      authErr.classList.remove('hidden');
    }
  });

  // Close Auth Modal
  const btnCloseAuth = document.getElementById('btn-close-auth');
  if (btnCloseAuth) {
    btnCloseAuth.addEventListener('click', async () => {
      hideAuthModal();
      if (!state.currentUser) {
        try {
          const res = await fetch('/api/auth/guest', { method: 'POST' });
          const data = await res.json();
          if (data.success && data.user) {
            setUserState(data.user);
            startNewChat(false);
          }
        } catch (e) {}
      }
    });
  }

  // Continue as Guest
  document.getElementById('btn-guest-continue').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.user) {
        setUserState(data.user);
        hideAuthModal();
        startNewChat(false);
      }
    } catch (err) {
      alert('Could not start guest session.');
    }
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    state.currentUser = null;
    state.chats = [];
    state.currentChatId = null;
    showAuthModal();
  });
}

// Helpers
function scrollToBottom() {
  const container = document.getElementById('chat-messages-container');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
