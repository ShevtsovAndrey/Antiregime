let peer, mediaRecorder, typingTimer;
let connections = {}; 
let activePeerId = null; 
let audioChunks = [];
let isRecording = false;

// Инициализация
let myUserName = localStorage.getItem('p2p_nickname') || "User_" + Math.floor(Math.random() * 1000);
let myAvatar = localStorage.getItem('p2p_avatar') || null;

const chatWindow = document.getElementById('chat-window');
const tabsContainer = document.getElementById('chat-tabs');
const messageInput = document.getElementById('message-input');
const peerInput = document.getElementById('peer-id-input');
const typingIndicator = document.getElementById('typing-indicator');

document.getElementById('my-id-input').value = myUserName;
if (myAvatar) updateAvatarPreview(myAvatar);

startPeer(myUserName);

// --- СЛУШАТЕЛИ КЛАВИАТУРЫ ---

// Отправка сообщения по Enter
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

// Подключение к другу по Enter в поле ID
peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });

// --- СЕТЕВОЕ ЯДРО ---

function startPeer(id) {
    if (peer) {
        peer.off();
        peer.destroy();
        peer = null;
    }
    
    // Создаем объект Peer с расширенным логом для отладки
    peer = new Peer(id, { host: '0.peerjs.com', port: 443, secure: true, debug: 1 });
    
    peer.on('connection', (conn) => {
        console.log("Входящее соединение:", conn.peer);
        setupConnection(conn);
    });

    peer.on('open', (newId) => { 
        addSystemMessage(`Вы в сети под ID: ${newId}`); 
        refreshTabs();
        setTimeout(restoreConnections, 1000); 
    });

    peer.on('error', (err) => {
        console.error("Ошибка PeerJS:", err.type);
        if (err.type === 'unavailable-id') {
            alert("Этот ID уже занят. Выберите другой.");
            document.getElementById('my-id-input').value = myUserName;
        } else if (err.type === 'peer-unavailable') {
            addSystemMessage("Ошибка: Пользователь не найден.");
        }
    });
}

function connectToPeer() {
    const id = peerInput.value.trim();
    if (!id || id === myUserName) return alert("Введите корректный ID друга");

    addSystemMessage(`Подключаемся к ${id}...`);
    const conn = peer.connect(id, { reliable: true });
    
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
        setupConnection(conn);
    });
}

function setupConnection(conn) {
    connections[conn.peer] = conn;
    refreshTabs();

    conn.on('data', (data) => {
        if (data.type === 'request-chat') {
            showIncomingAlert(conn, data);
            return;
        }
        
        if (data.type === 'handshake-ok' || data.type === 'reconnect-ping') {
            if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
            if (data.type === 'handshake-ok') {
                addSystemMessage(`Связь с ${conn.peer} установлена ✅`);
                openChat(conn.peer); 
            }
            refreshTabs();
            return;
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
            let content = data.text || (data.isImage ? data.image : data.audio);
            saveMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio, conn.peer);
            if (activePeerId === conn.peer) addMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio);
            else refreshTabs();
        }
    });

    conn.on('close', () => {
        addSystemMessage(`Соединение с ${conn.peer} закрыто`);
        refreshTabs();
    });
}

// --- УПРАВЛЕНИЕ ВКЛАДКАМИ И ЗАКРЫТИЕ ---

function closeChat(id, e) {
    e.stopPropagation();
    
    // ПОДТВЕРЖДЕНИЕ ЗАКРЫТИЯ
    const isConfirmed = confirm(`Разорвать соединение с ${id}?`);
    
    if (isConfirmed) {
        // 1. Физически закрываем канал
        if (connections[id]) {
            connections[id].close();
            delete connections[id];
        }

        // 2. Удаляем из списка сохраненных вкладок
        let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list.filter(i => i !== id)));

        // 3. Если чат был активен — очищаем экран
        if (activePeerId === id) {
            activePeerId = null;
            chatWindow.innerHTML = '';
        }

        addSystemMessage(`Вы разорвали связь с ${id}`);
        refreshTabs();
    }
}

function openChat(pId) {
    activePeerId = pId;
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes(pId)) { 
        list.push(pId); 
        localStorage.setItem('p2p_chat_list', JSON.stringify(list)); 
    }
    refreshTabs(); 
    loadHistory();
}

function refreshTabs() {
    tabsContainer.innerHTML = '';
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        const isOnline = connections[id] && connections[id].open;
        const tab = document.createElement('div');
        tab.className = `tab ${id === activePeerId ? 'active' : ''}`;
        tab.innerHTML = `${id} <span class="status-dot ${isOnline ? 'online' : ''}"></span>
            <span class="close-tab" onclick="closeChat('${id}', event)">×</span>`;
        tab.onclick = () => openChat(id);
        tabsContainer.appendChild(tab);
    });
}

// --- СООБЩЕНИЯ ---

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activePeerId) return;
    const conn = connections[activePeerId];
    if (conn && conn.open) {
        const id = Date.now();
        addMessage('Я', text, 'my-msg', id, false, false);
        saveMessage('Я', text, 'my-msg', id, false, false, activePeerId);
        conn.send({ user: myUserName, text: text, msgId: id });
        messageInput.value = '';
    } else {
        addSystemMessage("Ошибка: пользователь не в сети");
    }
}

function addMessage(user, content, className, id, isImg, isAud) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    if (id) div.setAttribute('data-id', id);

    let av = (className === 'peer-msg' ? connections[activePeerId]?.peerAvatar : myAvatar);
    let avHtml = av ? `<img src="${av}" class="avatar-mini">` : `<span class="avatar-mini" style="background:#555; display:inline-block; text-align:center;">👤</span>`;
    
    let body = content;
    if (isImg) body = `<img src="${content}" class="chat-img" onclick="window.openLightbox('${content}')">`;
    else if (isAud) body = `<audio controls src="${content}"></audio>`;

    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}`;
    if (id) div.innerHTML += `<br><span style="font-size:9px; cursor:pointer; color:#888;" onclick="window.deleteMsg(${id})">Удалить</span>`;
    
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- ВСПОМОГАТЕЛЬНОЕ ---

function changeMyId() {
    const inputId = document.getElementById('my-id-input').value.trim();
    if (!inputId) return alert("Введите свой ID");
    myUserName = inputId;
    localStorage.setItem('p2p_nickname', myUserName);
    addSystemMessage(`Переподключение под ником: ${myUserName}...`);
    startPeer(myUserName);
}

function saveMessage(u, t, c, id, isImg, isAud, p) {
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: p });
    localStorage.setItem('p2p_history', JSON.stringify(hist.slice(-200)));
}

function loadHistory() {
    chatWindow.innerHTML = '';
    if (!activePeerId) return;
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.filter(m => m.chatWith === activePeerId).forEach(m => {
        addMessage(m.user, m.text, m.className, m.id, m.isImage, m.isAudio);
    });
}

function addSystemMessage(t) {
    const d = document.createElement('div'); d.className = 'system-msg'; d.innerText = t;
    chatWindow.appendChild(d); chatWindow.scrollTop = chatWindow.scrollHeight;
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

function restoreConnections() {
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        const conn = peer.connect(id);
        conn.on('open', () => {
            conn.send({ type: 'reconnect-ping', from: myUserName, avatar: myAvatar });
            setupConnection(conn);
        });
    });
}

// --- МЕДИА (ФОТО/ГОЛОС) ---

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
        addMessage('Я', b64, 'my-msg', id, true, false);
        saveMessage('Я', b64, 'my-msg', id, true, false, activePeerId);
        if (connections[activePeerId]?.open) connections[activePeerId].send({ user: myUserName, image: b64, isImage: true, msgId: id });
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
                    addMessage('Я', b64, 'my-msg', id, false, true);
                    saveMessage('Я', b64, 'my-msg', id, false, true, activePeerId);
                    if (connections[activePeerId]?.open) connections[activePeerId].send({ user: myUserName, audio: b64, isAudio: true, msgId: id });
                };
                stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
        } catch(e) { alert("Нет доступа к микрофону"); }
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
            if (w > h) { if (w > maxW) { h *= maxW / w; w = maxW; } } else { if (h > maxH) { w *= maxH / h; h = maxH; } }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            cb(canvas.toDataURL('image/jpeg', q));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function sendTypingStatus() {
    if (activePeerId && connections[activePeerId]?.open) {
        connections[activePeerId].send({ type: 'typing', isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if(connections[activePeerId]) connections[activePeerId].send({ type: 'typing', isTyping: false }) }, 2000);
    }
}

function updateAvatarPreview(src) { document.getElementById('my-avatar-preview').innerHTML = `<img src="${src}">`; }
window.openLightbox = (src) => { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').classList.add('open'); };
window.deleteMsg = (id) => { removeData(id); if (connections[activePeerId]) connections[activePeerId].send({ type: 'delete', msgId: id }); };
function removeData(id) {
    const el = document.querySelector(`[data-id="${id}"]`); if (el) el.remove();
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    localStorage.setItem('p2p_history', JSON.stringify(hist.filter(m => m.id != id)));
}