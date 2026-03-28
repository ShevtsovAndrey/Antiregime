// --- БЛОК МОНИТОРИНГА ---
let offlineTimer = 0; 

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

// --- ПЕРЕМЕННЫЕ ---
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
        // Слушатель Enter для смены ника
        myIdInp.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') changeMyId();
        });
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

// --- УВЕДОМЛЕНИЯ ---
function sendPushNotification(user, text, isImg, isAud) {
    if (document.visibilityState !== 'visible' || activePeerId !== user) {
        notificationSound.play().catch(() => {});
    }

    if (document.visibilityState === 'visible' && activePeerId === user) return;

    if (Notification.permission === 'granted') {
        let bodyText = isImg ? "📷 Фотография" : (isAud ? "🎤 Голосовое сообщение" : text);
        const notification = new Notification(`Новое сообщение от ${user}`, {
            body: bodyText,
            icon: myAvatar || 'https://cdn-icons-png.flaticon.com/512/733/733585.png',
            tag: user 
        });

        notification.onclick = () => {
            window.focus();
            openChat(user);
            notification.close();
        };
    }
}

// --- ПЕРЕЗАГРУЗКА ---
function rebootMessenger() {
    const btn = document.getElementById('reboot-btn');
    if (btn) btn.style.transform = "rotate(360deg)";
    
    addSystemMessage("🔄 Перезагрузка модулей связи...");

    if (connections) {
        Object.values(connections).forEach(conn => { if (conn && conn.close) conn.close(); });
    }
    connections = {};

    if (peer) {
        peer.disconnect();
        peer.destroy();
    }

    setTimeout(() => {
        startPeer(myUserName);
        updateConnectionStats();
        openChat('Архив');
        if (btn) btn.style.transform = "rotate(0deg)";
        addSystemMessage("✅ Связь перезапущена");
    }, 1000);
}

function startPeer(id) {
    if (peer) { peer.off('connection'); peer.destroy(); }

    const config = {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1,
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
        addSystemMessage(`Вы в сети как "${newId}"`); 
        refreshTabs(); 
    });

    peer.on('error', (err) => {
        if (err.type === 'id-taken') alert('Этот ник занят!');
        if (err.type === 'peer-unavailable') addSystemMessage(`Ошибка: Собеседник оффлайн`);
        console.error('PeerJS Error:', err.type, err);
    });
}

// --- ЯДРО СВЯЗИ ---
function setupConnection(conn) {
    if (conn.peer === myUserName) { conn.close(); return; } // Защита от самоподключения
    if (connections[conn.peer]) connections[conn.peer].close();
    
    connections[conn.peer] = conn;
    connections[conn.peer].isAccepted = false;
    connections[conn.peer].unreadCount = 0;

    conn.on('data', (data) => {
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
            addSystemMessage(`Собеседник ${conn.peer} принял запрос ✅`);
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

            if (activePeerId !== conn.peer) {
                connections[conn.peer].unreadCount = (connections[conn.peer].unreadCount || 0) + 1;
            }

            saveMessage(data.user || conn.peer, content, 'peer-msg', data.msgId, isImg, isAud, conn.peer);
            if (activePeerId === conn.peer) {
                addMessage(data.user || conn.peer, content, 'peer-msg', data.msgId, isImg, isAud);
            }
            refreshTabs();
        }
    });

    conn.on('close', () => {
        addSystemMessage(`❌ Связь с ${conn.peer} потеряна`);
        if (connections[conn.peer]) connections[conn.peer].isAccepted = false;
        refreshTabs();
    });
}

// [Функции showIncomingAlert, sendMessage, uploadChatImage, toggleRecording, sendAudio остаются без изменений...]

function showIncomingAlert(conn, data) {
    const alertId = `alert-${conn.peer}`;
    if (document.getElementById(alertId)) return;
    const div = document.createElement('div');
    div.id = alertId; div.className = 'system-msg';
    div.style.cssText = "background:#333; padding:15px; border:1px solid var(--accent); border-radius:10px; margin:10px 0; text-align:center;";
    div.innerHTML = `<div style="margin-bottom:10px">Чат от <b>${data.from}</b>?</div>
        <button class="main-btn" id="acc-${conn.peer}" style="background:#4caf50; color:white; margin-right:5px;">Принять</button>
        <button class="main-btn" id="rej-${conn.peer}" style="background:#f44336; color:white;">Отклонить</button>`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    document.getElementById(`acc-${conn.peer}`).onclick = () => {
        if (connections[conn.peer]) {
            const currentConn = connections[conn.peer];
            currentConn.isAccepted = true;
            if (data.avatar) currentConn.peerAvatar = data.avatar;
            currentConn.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });
            const pMsg = currentConn.pendingMsgData;
            if (pMsg) {
                saveMessage(pMsg.user, pMsg.text, 'peer-msg', pMsg.msgId, false, false, conn.peer);
                if (activePeerId === conn.peer) addMessage(pMsg.user, pMsg.text, 'peer-msg', pMsg.msgId, false, false);
                else currentConn.unreadCount = (currentConn.unreadCount || 0) + 1;
                delete currentConn.pendingMsgData;
            }
        }
        div.innerHTML = "✅ Соединение установлено";
        setTimeout(() => { div.remove(); refreshTabs(); }, 1500);
    };
    document.getElementById(`rej-${conn.peer}`).onclick = () => {
        if (connections[conn.peer]) { connections[conn.peer].send({ type: 'reject-chat' }); connections[conn.peer].close(); delete connections[conn.peer]; }
        div.remove(); refreshTabs();
    };
}

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
    if (!conn || !conn.open || !conn.isAccepted) {
        if (!conn || !conn.open) { conn = peer.connect(activePeerId, { reliable: true }); setupConnection(conn); }
        conn.on('open', () => {
            conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar, pendingMsg: { user: myUserName, text: text, msgId: msgId, type: 'chat-msg' } });
            addSystemMessage(`Запрос отправлен к ${activePeerId}...`);
        }, { once: true });
        saveMessage(myUserName, text, 'my-msg', msgId, false, false, activePeerId);
        addMessage(myUserName, text, 'my-msg', msgId, false, false);
        messageInput.value = ''; return;
    }
    conn.send({ user: myUserName, text: text, msgId: msgId, type: 'chat-msg' });
    saveMessage(myUserName, text, 'my-msg', msgId, false, false, activePeerId);
    addMessage(myUserName, text, 'my-msg', msgId, false, false);
    messageInput.value = '';
}

function uploadChatImage(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        const msgId = Date.now();
        if (activePeerId === 'Архив') {
            saveMessage(myUserName, base64, 'my-msg', msgId, true, false, 'Архив');
            addMessage(myUserName, base64, 'my-msg', msgId, true, false);
        } else {
            const conn = connections[activePeerId];
            if (conn?.isAccepted) {
                conn.send({ user: myUserName, image: base64, isImage: true, msgId: msgId, type: 'chat-msg' });
                saveMessage(myUserName, base64, 'my-msg', msgId, true, false, activePeerId);
                addMessage(myUserName, base64, 'my-msg', msgId, true, false);
            }
        }
    };
    reader.readAsDataURL(file);
}

async function toggleRecording() {
    const btn = document.getElementById('voice-btn');
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => sendAudio(reader.result);
                stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorder.start();
            isRecording = true; btn.classList.add('recording');
        } catch (e) { alert("Доступ к микрофону запрещен"); }
    } else {
        mediaRecorder.stop(); isRecording = false; btn.classList.remove('recording');
    }
}

function sendAudio(base64) {
    const msgId = Date.now();
    if (activePeerId === 'Архив') {
        saveMessage(myUserName, base64, 'my-msg', msgId, false, true, 'Архив');
        addMessage(myUserName, base64, 'my-msg', msgId, false, true);
    } else {
        const conn = connections[activePeerId];
        if (conn?.isAccepted) {
            conn.send({ user: myUserName, audio: base64, isAudio: true, msgId: msgId, type: 'chat-msg' });
            saveMessage(myUserName, base64, 'my-msg', msgId, false, true, activePeerId);
            addMessage(myUserName, base64, 'my-msg', msgId, false, true);
        }
    }
}

function addMessage(user, content, className, id, isImg, isAud) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    if (id) div.setAttribute('data-id', id);
    let av = (className.includes('peer-msg') ? connections[activePeerId]?.peerAvatar : myAvatar);
    let avHtml = av ? `<img src="${av}" class="avatar-mini">` : `<span class="avatar-mini">👤</span>`;
    let body = content;
    if (isImg) body = `<img src="${content}" class="chat-img" onclick="window.openLightbox('${content}')">`;
    if (isAud) body = `<audio controls src="${content}" style="max-width:200px"></audio>`;
    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}`;
    if (id) div.innerHTML += `<br><span style="font-size:9px;color:#888;cursor:pointer;" onclick="window.deleteMsg(${id})">Удалить</span>`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

window.openLightbox = (src) => {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = src; lb.classList.add('open');
};

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
        const badgeHtml = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';
        tab.innerHTML = `<span>${id}</span>${badgeHtml}<span class="status-dot ${isOnline ? 'online' : ''}"></span>
            ${!isNotes ? `<span class="reconnect-tab" onclick="event.stopPropagation(); reconnectToID('${id}')">🔄</span>` : ''}
            ${!isNotes ? `<span class="close-tab" onclick="closeChat('${id}', event)">×</span>` : ''}`;
        tab.onclick = () => openChat(id);
        tabsContainer.appendChild(tab);
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
    if (shouldFocus) loadHistory();
}

function loadHistory() {
    chatWindow.innerHTML = ''; if (!activePeerId) return;
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.filter(m => m.chatWith === activePeerId).forEach(m => addMessage(m.user, m.text, m.className, m.id, m.isImage, m.isAudio));
}

function connectToPeer() {
    const id = peerInput.value.trim();
    if (!id || id === myUserName) return;
    openChat(id);
    const conn = peer.connect(id, { reliable: true });
    setupConnection(conn);
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
        addSystemMessage(`Запрос отправлен к ${id}...`);
    });
}

function reconnectToID(id) {
    if (id === 'Архив') return;
    if (connections[id]) connections[id].close();
    const conn = peer.connect(id, { reliable: true });
    setupConnection(conn);
    conn.on('open', () => conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar }));
}

function closeChat(id, e, confirmNeeded = true) {
    if (e) e.stopPropagation();
    if (!confirmNeeded || confirm(`Удалить чат с ${id}?`)) {
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
    addSystemMessage(`Ник изменен на [${myUserName}]. Переподключение...`);
    if (inp) inp.blur();
}

function addSystemMessage(t) { 
    const d = document.createElement('div'); d.className = 'system-msg'; d.innerText = t; 
    chatWindow.appendChild(d); chatWindow.scrollTop = chatWindow.scrollHeight; 
}

function removeData(id) { 
    const el = document.querySelector(`[data-id="${id}"]`); if (el) el.remove();
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    localStorage.setItem('p2p_history', JSON.stringify(hist.filter(m => m.id != id)));
}

window.deleteMsg = (id) => { 
    removeData(id); 
    if (connections[activePeerId]?.isAccepted) connections[activePeerId].send({ type: 'delete', msgId: id }); 
};

function updateAvatarPreview(src) { 
    const prev = document.getElementById('my-avatar-preview');
    if (prev) prev.innerHTML = `<img src="${src}">`; 
}

function uploadAvatar(input) {
    const reader = new FileReader();
    reader.onload = (e) => { myAvatar = e.target.result; localStorage.setItem('p2p_avatar', myAvatar); updateAvatarPreview(myAvatar); };
    reader.readAsDataURL(input.files[0]);
}

function sendTypingStatus() {
    const conn = connections[activePeerId];
    if (conn && conn.open && conn.isAccepted) {
        conn.send({ type: 'typing', isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { 
            if(connections[activePeerId] && connections[activePeerId].open) {
                connections[activePeerId].send({ type: 'typing', isTyping: false });
            }
        }, 2000);
    }
}

// Запуск
init();
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
messageInput.addEventListener("input", sendTypingStatus);
peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });