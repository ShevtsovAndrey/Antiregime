let peer, mediaRecorder, typingTimer;
let connections = {}; 
let activePeerId = null; 
let audioChunks = [];
let isRecording = false;

// Инициализация данных
let myUserName = localStorage.getItem('p2p_nickname') || "User_" + Math.floor(Math.random() * 1000);
let myAvatar = localStorage.getItem('p2p_avatar') || null;

const chatWindow = document.getElementById('chat-window');
const tabsContainer = document.getElementById('chat-tabs');
const messageInput = document.getElementById('message-input');
const peerInput = document.getElementById('peer-id-input');
const typingIndicator = document.getElementById('typing-indicator');

document.getElementById('my-id-input').value = myUserName;
if (myAvatar) updateAvatarPreview(myAvatar);

// Старт
startPeer(myUserName);
initNotes(); // Создаем локальную вкладку

// --- СЛУШАТЕЛИ КЛАВИАТУРЫ ---
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });

// Вкладка "Заметки" (всегда первая)
function initNotes() {
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes('Заметки (Self)')) {
        list.unshift('Заметки (Self)');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list));
    }
    refreshTabs();
}

function startPeer(id) {
    if (peer) { peer.destroy(); }
    peer = new Peer(id, { debug: 1 });

    peer.on('open', (newId) => { 
        addSystemMessage(`Вы онлайн: ${newId}`); 
        refreshTabs(); 
        restoreConnections(); 
    });

    peer.on('connection', (conn) => setupConnection(conn));

    peer.on('error', (err) => { 
        if (err.type === 'unavailable-id') alert("Этот ID уже занят!"); 
        if (err.type === 'peer-unavailable') addSystemMessage("Пользователь не найден");
    });
}

function connectToPeer() {
    const id = peerInput.value.trim();
    if (!id || id === myUserName || id === 'Заметки (Self)') return alert("Некорректный ID");

    addSystemMessage(`Подключение к ${id}...`);
    const conn = peer.connect(id, { reliable: true });
    
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
        setupConnection(conn);
    });
}

function setupConnection(conn) {
    connections[conn.peer] = conn;
    refreshTabs();
    checkPendingButton(); // Проверяем черновики при подключении

    conn.on('data', (data) => {
        if (data.type === 'request-chat') { showIncomingAlert(conn, data); return; }
        
        if (data.type === 'handshake-ok' || data.type === 'reconnect-ping') {
            if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
            if (data.type === 'handshake-ok') {
                addSystemMessage(`Связь с ${conn.peer} установлена ✅`);
                openChat(conn.peer); 
            }
            refreshTabs(); return;
        }

        if (data.type === 'typing') {
            if (activePeerId === conn.peer) {
                typingIndicator.style.opacity = data.isTyping ? "1" : "0";
                typingIndicator.innerText = `${conn.peer} печатает...`;
            }
            return;
        }

        if (data.type === 'delete') { removeData(data.msgId); return; }

        if (data.user) {
            let content = data.text || data.image || data.audio;
            saveMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio, conn.peer, false);
            if (activePeerId === conn.peer) addMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio);
            else refreshTabs();
        }
    });

    conn.on('close', () => { refreshTabs(); });
}

// --- СООБЩЕНИЯ ---

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activePeerId) return;

    const id = Date.now();
    // Если это заметки - просто сохраняем локально
    if (activePeerId === 'Заметки (Self)') {
        addMessage('Я', text, 'my-msg', id, false, false);
        saveMessage('Я', text, 'my-msg', id, false, false, activePeerId, false);
        messageInput.value = ''; return;
    }

    const conn = connections[activePeerId];
    if (conn && conn.open) {
        addMessage('Я', text, 'my-msg', id, false, false);
        saveMessage('Я', text, 'my-msg', id, false, false, activePeerId, false);
        conn.send({ user: myUserName, text: text, msgId: id });
    } else {
        addMessage('Я', text, 'my-msg pending-msg', id, false, false);
        saveMessage('Я', text, 'my-msg', id, false, false, activePeerId, true);
        checkPendingButton();
    }
    messageInput.value = '';
}

function sendPendingMessages() {
    const conn = connections[activePeerId];
    if (!conn || !conn.open) return;

    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.forEach(m => {
        if (m.chatWith === activePeerId && m.isPending) {
            conn.send({ 
                user: myUserName, 
                text: m.isImage || m.isAudio ? null : m.text,
                image: m.isImage ? m.text : null,
                audio: m.isAudio ? m.text : null,
                isImage: m.isImage,
                isAudio: m.isAudio,
                msgId: m.id 
            });
            m.isPending = false;
        }
    });
    localStorage.setItem('p2p_history', JSON.stringify(hist));
    loadHistory();
}

function checkPendingButton() {
    const oldBtn = document.getElementById('send-pending-btn');
    if (oldBtn) oldBtn.remove();

    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    const hasPending = hist.some(m => m.chatWith === activePeerId && m.isPending);
    
    if (hasPending && connections[activePeerId]?.open) {
        const btn = document.createElement('button');
        btn.id = 'send-pending-btn';
        btn.style.cssText = 'background:#68afaf; color:#1a1a1a; width:100%; border:none; padding:10px; border-radius:8px; margin-bottom:10px; cursor:pointer; font-weight:bold;';
        btn.innerText = `🚀 Отправить черновики для ${activePeerId}`;
        btn.onclick = sendPendingMessages;
        chatWindow.prepend(btn);
    }
}

function addMessage(user, content, className, id, isImg, isAud) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    if (id) div.setAttribute('data-id', id);

    let av = (className.includes('peer-msg') ? connections[activePeerId]?.peerAvatar : myAvatar);
    let avHtml = av ? `<img src="${av}" class="avatar-mini">` : `<span class="avatar-mini" style="background:#555; display:inline-block; text-align:center; line-height:22px;">👤</span>`;
    
    let body = content;
    if (isImg) body = `<img src="${content}" class="chat-img" onclick="window.openLightbox('${content}')">`;
    else if (isAud) body = `<audio controls src="${content}" style="max-width:100%"></audio>`;

    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}`;
    if (id) div.innerHTML += `<br><span style="font-size:9px; cursor:pointer; color:#888;" onclick="window.deleteMsg(${id})">Удалить</span>`;
    
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- СЕРВИСНЫЕ ФУНКЦИИ ---

function saveMessage(u, t, c, id, isImg, isAud, p, isP = false) {
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: p, isPending: isP });
    localStorage.setItem('p2p_history', JSON.stringify(hist.slice(-300)));
}

function loadHistory() {
    chatWindow.innerHTML = '';
    if (!activePeerId) return;
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.filter(m => m.chatWith === activePeerId).forEach(m => {
        let fullClass = m.className;
        if (m.isPending) fullClass += " pending-msg";
        addMessage(m.user, m.text, fullClass, m.id, m.isImage, m.isAudio);
    });
    checkPendingButton();
}

function openChat(pId) {
    activePeerId = pId;
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes(pId)) { 
        list.push(pId); 
        localStorage.setItem('p2p_chat_list', JSON.stringify(list)); 
    }
    refreshTabs(); loadHistory();
}

function refreshTabs() {
    tabsContainer.innerHTML = '';
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        const isNotes = id === 'Заметки (Self)';
        const isOnline = !isNotes && (connections[id] && connections[id].open);
        const tab = document.createElement('div');
        tab.className = `tab ${id === activePeerId ? 'active' : ''}`;
        tab.innerHTML = `${id} <span class="status-dot ${isOnline ? 'online' : ''}"></span>
            ${isNotes ? '' : `<span class="close-tab" onclick="closeChat('${id}', event)">×</span>`}`;
        tab.onclick = () => openChat(id);
        tabsContainer.appendChild(tab);
    });
}

function closeChat(id, e) {
    e.stopPropagation();
    if (confirm(`Удалить чат с ${id}?`)) {
        if (connections[id]) { connections[id].close(); delete connections[id]; }
        let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list.filter(i => i !== id)));
        if (activePeerId === id) { activePeerId = null; chatWindow.innerHTML = ''; }
        refreshTabs();
    }
}

function changeMyId() {
    const inputId = document.getElementById('my-id-input').value.trim();
    if (!inputId) return;
    myUserName = inputId;
    localStorage.setItem('p2p_nickname', myUserName);
    startPeer(myUserName);
}

function uploadAvatar(input) {
    const file = input.files[0];
    resizeImage(file, 100, 100, 0.6, (b64) => {
        myAvatar = b64; localStorage.setItem('p2p_avatar', b64);
        updateAvatarPreview(b64);
        for (let id in connections) {
            if (connections[id].open) connections[id].send({ type: 'handshake-ok', avatar: b64, from: myUserName });
        }
    });
}

function uploadChatImage(input) {
    const file = input.files[0];
    if (!file || !activePeerId) return;
    resizeImage(file, 800, 800, 0.7, (b64) => {
        const id = Date.now();
        const conn = connections[activePeerId];
        if (conn && conn.open) {
            addMessage('Я', b64, 'my-msg', id, true, false);
            saveMessage('Я', b64, 'my-msg', id, true, false, activePeerId, false);
            conn.send({ user: myUserName, image: b64, isImage: true, msgId: id });
        } else {
            addMessage('Я', b64, 'my-msg pending-msg', id, true, false);
            saveMessage('Я', b64, 'my-msg', id, true, false, activePeerId, true);
            checkPendingButton();
        }
        input.value = '';
    });
}

async function toggleRecording() {
    const btn = document.getElementById('voice-btn');
    if (!activePeerId) return;
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/ogg' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const b64 = reader.result; const id = Date.now();
                    const conn = connections[activePeerId];
                    if (conn && conn.open) {
                        addMessage('Я', b64, 'my-msg', id, false, true);
                        saveMessage('Я', b64, 'my-msg', id, false, true, activePeerId, false);
                        conn.send({ user: myUserName, audio: b64, isAudio: true, msgId: id });
                    } else {
                        addMessage('Я', b64, 'my-msg pending-msg', id, false, true);
                        saveMessage('Я', b64, 'my-msg', id, false, true, activePeerId, true);
                        checkPendingButton();
                    }
                };
                stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
        } catch(e) { alert("Микрофон недоступен"); }
    } else {
        mediaRecorder.stop(); isRecording = false; btn.classList.remove('recording');
    }
}

function resizeImage(file, maxW, maxH, q, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxW) { h *= maxW / w; w = maxW; } } 
            else { if (h > maxH) { w *= maxH / h; h = maxH; } }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            cb(canvas.toDataURL('image/jpeg', q));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function restoreConnections() {
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        if (id === 'Заметки (Self)') return;
        const conn = peer.connect(id);
        conn.on('open', () => {
            conn.send({ type: 'reconnect-ping', from: myUserName, avatar: myAvatar });
            setupConnection(conn);
        });
    });
}

function showIncomingAlert(conn, data) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.style.cssText = 'background: #424242; padding:15px; border:1px solid #68afaf; border-radius:8px; margin: 10px 0;';
    const guestAv = data.avatar ? `<img src="${data.avatar}" class="avatar-mini">` : '👤';
    div.innerHTML = `<div>${guestAv} <b>${data.from}</b> хочет чат</div>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">
            <button id="acc-${data.from}" class="main-btn">Принять</button>
            <button id="rej-${data.from}" class="main-btn" style="background:#f55; color:white;">Нет</button>
        </div>`;
    chatWindow.prepend(div);
    document.getElementById(`acc-${data.from}`).onclick = () => {
        if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
        conn.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });
        div.remove(); openChat(conn.peer);
    };
    document.getElementById(`rej-${data.from}`).onclick = () => { conn.close(); div.remove(); };
}

function sendTypingStatus() {
    if (activePeerId && connections[activePeerId]?.open) {
        connections[activePeerId].send({ type: 'typing', isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if(connections[activePeerId]) connections[activePeerId].send({ type: 'typing', isTyping: false }) }, 2000);
    }
}

function addSystemMessage(t) {
    const d = document.createElement('div'); d.className = 'system-msg'; d.innerText = t;
    chatWindow.appendChild(d); chatWindow.scrollTop = chatWindow.scrollHeight;
}

function updateAvatarPreview(src) { document.getElementById('my-avatar-preview').innerHTML = `<img src="${src}">`; }
window.openLightbox = (src) => { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').classList.add('open'); };
window.deleteMsg = (id) => { removeData(id); if (connections[activePeerId]) connections[activePeerId].send({ type: 'delete', msgId: id }); };

function removeData(id) {
    const el = document.querySelector(`[data-id="${id}"]`); if (el) el.remove();
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    localStorage.setItem('p2p_history', JSON.stringify(hist.filter(m => m.id != id)));
}