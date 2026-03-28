// --- БЛОК МОНИТОРИНГА СИСТЕМЫ ---
let offlineTimer = 0; 
let pingStartTimes = {}; // Хранилище для замера пинга

async function updateConnectionStats() {
    const deviceEl = document.getElementById('info-device');
    const netEl = document.getElementById('info-net');
    const ipEl = document.getElementById('info-ip');
    const ua = navigator.userAgent;
    
    let dev = /android/i.test(ua) ? "ANDR" : (/iPad|iPhone|iPod/.test(ua) ? "iOS" : "PC");
    if (deviceEl) deviceEl.innerHTML = `SYS: ${dev}`;

    if (navigator.onLine) {
        offlineTimer = 0;
        const netType = navigator.connection ? navigator.connection.effectiveType.toUpperCase() : 'ON';
        if (netEl) {
            netEl.innerHTML = `NET: ${netType}`;
            netEl.style.color = "#4caf50";
        }
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            if (ipEl) ipEl.innerHTML = `IP: ${data.ip}`;
        } catch (e) { if (ipEl) ipEl.innerHTML = `IP: ERR`; }
    } else {
        offlineTimer += 10;
        if (netEl) {
            netEl.innerHTML = `NET: OFF (${offlineTimer}s)`;
            netEl.style.color = "#f44336";
        }
        if (offlineTimer >= 30) {
            rebootMessenger();
            offlineTimer = 0;
        }
    }
}
setInterval(updateConnectionStats, 10000);
updateConnectionStats();

// --- ПЕРЕМЕННЫЕ И СОСТОЯНИЕ ---
let peer;
let connections = {}; 
let activePeerId = null; 
let typingTimer;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

let myUserName = localStorage.getItem('p2p_nickname') || "User_" + Math.floor(Math.random() * 1000);
let myAvatar = localStorage.getItem('p2p_avatar') || null;

const chatWindow = document.getElementById('chat-window');
const tabsContainer = document.getElementById('chat-tabs');
const messageInput = document.getElementById('message-input');
const peerInput = document.getElementById('peer-id-input');
const typingIndicator = document.getElementById('typing-indicator');
const notificationSound = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU1vT19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX18=");

// --- ИНИЦИАЛИЗАЦИЯ ---
function init() {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    
    const myIdInp = document.getElementById('my-id-input');
    if (myIdInp) {
        myIdInp.value = myUserName;
        myIdInp.addEventListener('keypress', (e) => { if (e.key === 'Enter') changeMyId(); });
    }

    if (myAvatar) updateAvatarPreview(myAvatar);

    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes('Архив')) {
        list.unshift('Архив');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list));
    }

    startPeer(myUserName);
    refreshTabs();
    openChat('Архив');
}

// --- СЕТЕВОЕ ЯДРО (PEERJS) ---
function startPeer(id) {
    if (peer) { peer.off('connection'); peer.destroy(); }

    const config = {
        host: '0.peerjs.com', port: 443, secure: true, debug: 1,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    };

    peer = new Peer(id, config);
    peer.on('connection', (conn) => { setupConnection(conn); });
    peer.on('open', (newId) => { 
        addSystemMessage(`🌐 Сеть готова. Ваш ID: ${newId}`); 
        refreshTabs(); 
    });

    peer.on('error', (err) => {
        let errorInfo = "⚠️ ";
        switch (err.type) {
            case 'id-taken': errorInfo += "Ник уже занят!"; break;
            case 'peer-unavailable': 
                errorInfo += `Пользователь [${activePeerId}] не найден. Возможно, он оффлайн.`; 
                // Ставим статус "оффлайн" в табах
                if (connections[activePeerId]) connections[activePeerId].isAccepted = false;
                refreshTabs();
                break;
            case 'network': errorInfo += "Проблема с сетью. Проверьте интернет."; break;
            default: errorInfo += "Ошибка: " + err.type;
        }
        addSystemMessage(errorInfo);
    });
}

function setupConnection(conn) {
    if (conn.peer === myUserName) { conn.close(); return; }
    if (connections[conn.peer]) connections[conn.peer].close();
    
    connections[conn.peer] = conn;
    connections[conn.peer].isAccepted = false;
    connections[conn.peer].unreadCount = 0;

    conn.on('data', (data) => {
        // ОБРАБОТКА PING-PONG (Отладчик)
        if (data.type === 'pong') {
            const rtt = Date.now() - pingStartTimes[data.msgId];
            const pingEl = document.getElementById(`ping-${data.msgId}`);
            if (pingEl) {
                pingEl.innerText = `${rtt}ms`;
                pingEl.style.color = rtt < 150 ? "#4caf50" : (rtt < 400 ? "#ff9800" : "#f44336");
            }
            delete pingStartTimes[data.msgId];
            return;
        }

        // Автоматический ответ на входящий запрос пинга
        if (data.msgId && data.type === 'chat-msg') {
            conn.send({ type: 'pong', msgId: data.msgId });
        }

        if (data.type === 'request-chat') {
            openChat(conn.peer, false); 
            if (data.pendingMsg) conn.pendingMsgData = data.pendingMsg;
            showIncomingAlert(conn, data);
            return;
        }

        if (data.type === 'handshake-ok') {
            if (connections[conn.peer]) {
                connections[conn.peer].isAccepted = true;
                if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
            }
            addSystemMessage(`✅ ${conn.peer} принял запрос`);
            refreshTabs();
            return;
        }

        if (data.type === 'typing') {
            if (activePeerId === conn.peer) {
                typingIndicator.style.opacity = data.isTyping ? "1" : "0";
                if (data.isTyping) typingIndicator.innerText = `${conn.peer} печатает...`;
            }
            return;
        }

        if (data.type === 'delete') { removeData(data.msgId); return; }

        if (connections[conn.peer]?.isAccepted) {
            let isImg = !!(data.image || data.isImage);
            let isAud = !!(data.audio || data.isAudio);
            let content = data.text || data.image || data.audio;
            
            sendPushNotification(data.user || conn.peer, content, isImg, isAud);
            if (activePeerId !== conn.peer) connections[conn.peer].unreadCount++;
            
            saveMessage(data.user || conn.peer, content, 'peer-msg', data.msgId, isImg, isAud, conn.peer);
            if (activePeerId === conn.peer) addMessage(data.user || conn.peer, content, 'peer-msg', data.msgId, isImg, isAud);
            refreshTabs();
        }
    });

    conn.on('close', () => {
        addSystemMessage(`❌ Потеряно соединение с ${conn.peer}`);
        if (connections[conn.peer]) connections[conn.peer].isAccepted = false;
        refreshTabs();
    });
}

// --- ОТПРАВКА СООБЩЕНИЙ ---
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activePeerId) return;
    const msgId = Date.now();

    if (activePeerId === 'Архив') {
        saveMessage(myUserName, text, 'my-msg', msgId, false, false, 'Архив');
        addMessage(myUserName, text, 'my-msg', msgId, false, false);
        messageInput.value = ''; return;
    }

    let conn = connections[activePeerId];

    // Диагностика перед отправкой
    if (!conn || !conn.open) {
        addSystemMessage(`🔍 Отладчик: Канал с ${activePeerId} закрыт. Пробую восстановить...`);
        reconnectToID(activePeerId);
        return;
    }

    if (!conn.isAccepted) {
        addSystemMessage(`⏳ Ожидание подтверждения от ${activePeerId}...`);
        return;
    }

    try {
        pingStartTimes[msgId] = Date.now(); // Засекаем старт для Ping
        conn.send({ user: myUserName, text: text, msgId: msgId, type: 'chat-msg' });
        
        saveMessage(myUserName, text, 'my-msg', msgId, false, false, activePeerId);
        addMessage(myUserName, text, 'my-msg', msgId, false, false);
        messageInput.value = '';
    } catch (e) {
        addSystemMessage(`❌ Ошибка отправки: ${e.message}`);
    }
}

// --- ОТОБРАЖЕНИЕ ---
function addMessage(user, content, className, id, isImg, isAud) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    if (id) div.setAttribute('data-id', id);

    let av = (className.includes('peer-msg') ? connections[activePeerId]?.peerAvatar : myAvatar);
    let avHtml = av ? `<img src="${av}" class="avatar-mini">` : `<span class="avatar-mini">👤</span>`;
    
    let body = content;
    if (isImg) body = `<img src="${content}" class="chat-img" onclick="window.openLightbox('${content}')">`;
    if (isAud) body = `<audio controls src="${content}" style="max-width:200px"></audio>`;
    
    // Пинг-метка
    let pingHtml = (className === 'my-msg' && activePeerId !== 'Archive') 
        ? `<span id="ping-${id}" class="ping-tag">...</span>` 
        : '';

    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}${pingHtml}`;
    if (id) div.innerHTML += `<br><span class="del-btn" onclick="window.deleteMsg(${id})">Удалить</span>`;
    
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function addSystemMessage(t) { 
    const d = document.createElement('div'); 
    d.className = 'system-msg'; 
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    d.innerText = `[${time}] ${t}`; 
    chatWindow.appendChild(d); 
    chatWindow.scrollTop = chatWindow.scrollHeight; 
}

function rebootMessenger() {
    const btn = document.getElementById('reboot-btn');
    if (btn) btn.style.transform = "rotate(360deg)";
    addSystemMessage("🔄 Перезапуск модулей связи...");
    
    Object.values(connections).forEach(c => { if(c) c.close(); });
    connections = {};
    if (peer) peer.destroy();

    setTimeout(() => {
        startPeer(myUserName);
        if (btn) btn.style.transform = "rotate(0deg)";
        addSystemMessage("✅ Система онлайн");
    }, 1000);
}

function reconnectToID(id) {
    if (id === 'Архив') return;
    const conn = peer.connect(id, { reliable: true });
    setupConnection(conn);
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
    });
}

function openChat(pId, shouldFocus = true) {
    if (shouldFocus) {
        activePeerId = pId;
        if (connections[pId]) connections[pId].unreadCount = 0;
    }
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes(pId)) { list.push(pId); localStorage.setItem('p2p_chat_list', JSON.stringify(list)); }
    refreshTabs(); 
    if (shouldFocus) {
        loadHistory();
        // Авто-диагностика канала при входе
        if (pId !== 'Архив' && (!connections[pId] || !connections[pId].open)) {
            addSystemMessage(`🔎 Канал с ${pId} не активен. Нажмите 🔄 для вызова.`);
        }
    }
}

function loadHistory() {
    chatWindow.innerHTML = ''; if (!activePeerId) return;
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.filter(m => m.chatWith === activePeerId).forEach(m => addMessage(m.user, m.text, m.className, m.id, m.isImage, m.isAudio));
}

function saveMessage(u, t, c, id, isImg, isAud, chatWith) {
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: chatWith });
    localStorage.setItem('p2p_history', JSON.stringify(hist.slice(-300)));
}

function refreshTabs() {
    tabsContainer.innerHTML = '';
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        const isNotes = id === 'Архив';
        const conn = connections[id];
        const isOnline = !isNotes && (conn?.open && conn?.isAccepted);
        const unread = (!isNotes && conn && conn.unreadCount > 0) ? conn.unreadCount : 0;
        
        const tab = document.createElement('div');
        tab.className = `tab ${id === activePeerId ? 'active' : ''}`;
        const badge = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';
        
        tab.innerHTML = `
            <span>${id}</span>${badge}<span class="status-dot ${isOnline ? 'online' : ''}"></span>
            ${!isNotes ? `<span class="reconnect-tab" onclick="event.stopPropagation(); reconnectToID('${id}')">🔄</span>` : ''}
            ${!isNotes ? `<span class="close-tab" onclick="closeChat('${id}', event)">×</span>` : ''}
        `;
        tab.onclick = () => openChat(id);
        tabsContainer.appendChild(tab);
    });
}

function connectToPeer() {
    const id = peerInput.value.trim();
    if (!id || id === myUserName) return;
    openChat(id);
    const conn = peer.connect(id, { reliable: true });
    setupConnection(conn);
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
    });
    peerInput.value = '';
}

function closeChat(id, e) {
    if (e) e.stopPropagation();
    if (confirm(`Удалить чат с ${id}?`)) {
        if (connections[id]) connections[id].close();
        delete connections[id];
        let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list.filter(i => i !== id)));
        if (activePeerId === id) activePeerId = 'Архив';
        refreshTabs(); loadHistory();
    }
}

function changeMyId() { 
    const inp = document.getElementById('my-id-input');
    const newId = inp ? inp.value.trim() : null; 
    if (!newId || newId === myUserName) return;
    myUserName = newId;
    localStorage.setItem('p2p_nickname', myUserName); 
    rebootMessenger();
    if (inp) inp.blur();
}

function sendTypingStatus() {
    const conn = connections[activePeerId];
    if (conn?.open && conn?.isAccepted) {
        conn.send({ type: 'typing', isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { 
            if(connections[activePeerId]?.open) connections[activePeerId].send({ type: 'typing', isTyping: false });
        }, 2000);
    }
}

function showIncomingAlert(conn, data) {
    const alertId = `alert-${conn.peer}`;
    if (document.getElementById(alertId)) return;
    const div = document.createElement('div');
    div.id = alertId; div.className = 'system-msg';
    div.style.cssText = "background:#222; border-left:4px solid #4caf50; padding:10px; margin:10px 0;";
    div.innerHTML = `
        <div>Запрос связи: <b>${data.from}</b></div>
        <button onclick="acceptChat('${conn.peer}', '${data.avatar || ''}')" style="background:#4caf50; color:white; border:none; padding:5px 10px; margin-top:5px; cursor:pointer;">Принять</button>
    `;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

window.acceptChat = (peerId, avatar) => {
    const c = connections[peerId];
    if (c) {
        c.isAccepted = true;
        c.peerAvatar = avatar;
        c.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });
        if (c.pendingMsgData) {
            const p = c.pendingMsgData;
            saveMessage(p.user, p.text, 'peer-msg', p.msgId, false, false, peerId);
            if (activePeerId === peerId) addMessage(p.user, p.text, 'peer-msg', p.msgId, false, false);
            else c.unreadCount++;
            delete c.pendingMsgData;
        }
    }
    const alert = document.getElementById(`alert-${peerId}`);
    if (alert) alert.remove();
    refreshTabs();
};

window.deleteMsg = (id) => { 
    removeData(id); 
    if (connections[activePeerId]?.isAccepted) connections[activePeerId].send({ type: 'delete', msgId: id }); 
};

function removeData(id) { 
    const el = document.querySelector(`[data-id="${id}"]`); if (el) el.remove();
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    localStorage.setItem('p2p_history', JSON.stringify(hist.filter(m => m.id != id)));
}

function updateAvatarPreview(src) { 
    const prev = document.getElementById('my-avatar-preview');
    if (prev) prev.innerHTML = `<img src="${src}">`; 
}

function uploadAvatar(input) {
    const reader = new FileReader();
    reader.onload = (e) => { myAvatar = e.target.result; localStorage.setItem('p2p_avatar', myAvatar); updateAvatarPreview(myAvatar); };
    reader.readAsDataURL(input.files[0]);
}

// ЗАПУСК
init();
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
messageInput.addEventListener("input", sendTypingStatus);
peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });

// Лайтбокс и стили для пинга (добавь в CSS если нужно)
window.openLightbox = (src) => {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = src; lb.classList.add('open');
};