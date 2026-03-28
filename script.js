// --- БЛОК МОНИТОРИНГА (УСТРОЙСТВО, СЕТЬ, IP) ---
async function updateConnectionStats() {
    const infoBox = document.getElementById('connection-info');
    if (!infoBox) return;

    const deviceEl = document.getElementById('info-device');
    const netEl = document.getElementById('info-net');
    const ipEl = document.getElementById('info-ip');

    // Краткое определение устройства
    const ua = navigator.userAgent;
    let dev = "PC";
    if (/android/i.test(ua)) dev = "ANDR";
    else if (/iPad|iPhone|iPod/.test(ua)) dev = "iOS";
    deviceEl.innerHTML = `SYS: ${dev}`;

    // Статус сети
    if (navigator.onLine) {
        const netType = navigator.connection ? navigator.connection.effectiveType.toUpperCase() : 'ON';
        netEl.innerHTML = `NET: ${netType}`;
        netEl.style.color = ""; // Сброс цвета
    } else {
        netEl.innerHTML = `NET: OFFLINE`;
        netEl.style.color = "#f55"; // Подсветка ошибки
    }

    // IP адрес
    try {
        const res = await fetch('https://api.ipify.org?format=json&t=' + Date.now());
        const data = await res.json();
        ipEl.innerHTML = `IP: ${data.ip}`;
    } catch (e) {
        ipEl.innerHTML = `IP: ERR`;
    }
}

// Запуск мониторинга
setInterval(updateConnectionStats, 8000);
updateConnectionStats();

// --- ПЕРЕМЕННЫЕ И ИНИЦИАЛИЗАЦИЯ ---
let peer, mediaRecorder, typingTimer;
let connections = {}; 
let activePeerId = null; 
let audioChunks = [];
let isRecording = false;

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
initNotes();

// --- СЕТЕВОЕ ЯДРО (PeerJS + Реконнект) ---
function startPeer(id) {
    if (peer) { 
        peer.removeAllListeners(); // Очищаем старые события перед созданием нового
        peer.destroy(); 
    }
    
    peer = new Peer(id, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            'iceCandidatePoolSize': 10
        }
    });

    // ВАЖНО: Этот блок отвечает за ВХОДЯЩИЕ вызовы
    peer.on('connection', (conn) => {
        console.log('Входящий запрос от:', conn.peer);
        // Сразу подписываемся на данные, чтобы не пропустить handshake
        setupConnection(conn);
    });

    peer.on('open', (newId) => { 
        addSystemMessage(`Вы онлайн: ${newId}`); 
        refreshTabs(); 
        restoreConnections(); 
    });

    peer.on('disconnected', () => {
        console.log('Связь с сервером потеряна. Переподключение...');
        peer.reconnect();
    });

    peer.on('error', (err) => { 
        console.error('PeerJS Error:', err.type);
        if (err.type === 'network' || err.type === 'server-error') {
            setTimeout(() => startPeer(myUserName), 5000);
        }
    });
}

function setupConnection(conn) {
    connections[conn.peer] = conn;
    console.log("🛠 Настройка канала с:", conn.peer);

    conn.on('data', (data) => {
        // --- ВОТ ЭТОТ БЛОК ОЖИВЛЯЕТ УДАЛЕННЫЙ ЧАТ ---
        let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
        if (!list.includes(conn.peer)) {
            list.push(conn.peer);
            localStorage.setItem('p2p_chat_list', JSON.stringify(list));
            refreshTabs(); // Перерисовываем вкладки, чтобы чат появился
        }
        // --------------------------------------------

        if (data.type === 'request-chat') {
            openChat(conn.peer); 
            showIncomingAlert(conn, data);
            return;
        }
        
        // ... остальной код (reject, handshake, messages) ...
        if (data.type === 'reject-chat') {
            addSystemMessage(`🚫 Пользователь отклонил ваш запрос`);
            setTimeout(() => { conn.close(); refreshTabs(); }, 1000);
            return;
        }

        if (data.type === 'handshake-ok' || data.type === 'reconnect-ping') {
            if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
            addSystemMessage(`Связь установлена ✅`);
            refreshTabs();
            return;
        }

        if (data.user) {
            let content = data.text || data.image || data.audio;
            saveMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio, conn.peer, false);
            if (activePeerId === conn.peer) addMessage(data.user, content, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio);
            refreshTabs();
        }
    });
}

// --- СООБЩЕНИЯ И ЧЕРНОВИКИ ---
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activePeerId) return;
    const id = Date.now();

    if (activePeerId === 'Архив') {
        addMessage('Я', text, 'my-msg', id, false, false);
        saveMessage('Я', text, 'my-msg', id, false, false, activePeerId, false);
    } else {
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
                isImage: m.isImage, isAudio: m.isAudio, msgId: m.id 
            });
            m.isPending = false;
        }
    });
    localStorage.setItem('p2p_history', JSON.stringify(hist));
    loadHistory();
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function initNotes() {
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    if (!list.includes('Архив')) {
        list.unshift('Архив');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list));
    }
    refreshTabs();
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

    // Определяем аватарку
    let avHtml;
    if (activePeerId === 'Архив') {
        avHtml = `<span class="avatar-mini">💾</span>`;
    } else {
        let av = (className.includes('peer-msg') ? connections[activePeerId]?.peerAvatar : myAvatar);
        avHtml = av ? `<img src="${av}" class="avatar-mini">` : `<span class="avatar-mini">👤</span>`;
    }
    
    let body = isImg ? `<img src="${content}" class="chat-img" onclick="window.openLightbox('${content}')">` : (isAud ? `<audio controls src="${content}"></audio>` : content);
    
    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}`;
    if (id) div.innerHTML += `<br><span style="font-size:9px; cursor:pointer; color:#888;" onclick="window.deleteMsg(${id})">Удалить</span>`;
    
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function saveMessage(u, t, c, id, isImg, isAud, p, isP = false) {
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: p, isPending: isP });
    localStorage.setItem('p2p_history', JSON.stringify(hist.slice(-300)));
}

function loadHistory() {
    if (!chatWindow) return;
    chatWindow.innerHTML = '';
    
    // Ищем блок ввода (обычно это контейнер с message-input и кнопкой)
    const inputArea = document.querySelector('.input-area') || messageInput?.parentElement;

    if (!activePeerId) {
        if (inputArea) inputArea.style.display = 'none';
        addSystemMessage("Выберите чат слева или введите ID для подключения");
        return;
    } else {
        if (inputArea) inputArea.style.display = 'flex';
    }

    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    hist.filter(m => m.chatWith === activePeerId).forEach(m => {
        let fullClass = m.className;
        if (m.isPending) fullClass += " pending-msg";
        addMessage(m.user, m.text, fullClass, m.id, m.isImage, m.isAudio);
    });
    checkPendingButton();
}

function refreshTabs() {
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';
    
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    
    // Если списка нет, принудительно добавляем Архив
    if (list.length === 0 || !list.includes('Архив')) {
        list = ['Архив'];
        localStorage.setItem('p2p_chat_list', JSON.stringify(list));
    }

    list.forEach(id => {
        const isNotes = id === 'Архив';
        const isOnline = !isNotes && (connections[id] && connections[id].open);
        
        const tab = document.createElement('div');
        tab.className = `tab ${id === activePeerId ? 'active' : ''}`;
        
        // Рисуем статус: для Архива — дискета, для остальных — точка
        const statusHtml = isNotes ? '<span style="margin-left:5px">💾</span>' : `<span class="status-dot ${isOnline ? 'online' : ''}"></span>`;
        
        tab.innerHTML = `<span>${id}</span> ${statusHtml}${isNotes ? '' : `<span class="close-tab" onclick="closeChat('${id}', event)">×</span>`}`;
        
        tab.onclick = () => openChat(id);
        tabsContainer.appendChild(tab);
    });
}

function connectToPeer() {
    const id = peerInput.value.trim();
    if (!id || id === myUserName || id === 'Архив') return;

    // Сразу открываем вкладку, чтобы пользователь видел процесс
    openChat(id);
    addSystemMessage(`Отправляем исходящий запрос ID: ${id}...`);

    const conn = peer.connect(id, { reliable: true });

    const connectionTimeout = setTimeout(() => {
        if (!connections[id] || !connections[id].open) {
            conn.close();
            addSystemMessage(`❌ Ошибка: ${id} не отвечает (тайм-аут 10 сек)`);
        }
    }, 10000);

    conn.on('open', () => {
        clearTimeout(connectionTimeout);
        setTimeout(() => {
            if (conn.open) {
                conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
                setupConnection(conn);
            }
        }, 500);
    });
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

function addSystemMessage(t) { const d = document.createElement('div'); d.className = 'system-msg'; d.innerText = t; chatWindow.appendChild(d); chatWindow.scrollTop = chatWindow.scrollHeight; }

// --- СЛУШАТЕЛИ СОБЫТИЙ ---
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });

function changeMyId() { myUserName = document.getElementById('my-id-input').value.trim(); localStorage.setItem('p2p_nickname', myUserName); startPeer(myUserName); }
function updateAvatarPreview(src) { document.getElementById('my-avatar-preview').innerHTML = `<img src="${src}">`; }
window.openLightbox = (src) => { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').classList.add('open'); };
window.deleteMsg = (id) => { removeData(id); if (connections[activePeerId]) connections[activePeerId].send({ type: 'delete', msgId: id }); };

function removeData(id) { 
    const el = document.querySelector(`[data-id="${id}"]`); if (el) el.remove();
    let hist = JSON.parse(localStorage.getItem('p2p_history') || '[]');
    localStorage.setItem('p2p_history', JSON.stringify(hist.filter(m => m.id != id)));
}

// Функции медиа и прочие вспомогательные...
function uploadAvatar(input) {
    const file = input.files[0];
    resizeImage(file, 100, 100, 0.6, (b64) => {
        myAvatar = b64; localStorage.setItem('p2p_avatar', b64);
        updateAvatarPreview(b64);
        for (let id in connections) { if (connections[id].open) connections[id].send({ type: 'handshake-ok', avatar: b64, from: myUserName }); }
    });
}

function uploadChatImage(input) {
    const file = input.files[0];
    if (!file || !activePeerId) return;
    resizeImage(file, 800, 800, 0.7, (b64) => {
        const id = Date.now();
        if (connections[activePeerId]?.open) {
            addMessage('Я', b64, 'my-msg', id, true, false);
            saveMessage('Я', b64, 'my-msg', id, true, false, activePeerId, false);
            connections[activePeerId].send({ user: myUserName, image: b64, isImage: true, msgId: id });
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
                const reader = new FileReader(); reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const b64 = reader.result; const id = Date.now();
                    if (connections[activePeerId]?.open) {
                        addMessage('Я', b64, 'my-msg', id, false, true);
                        saveMessage('Я', b64, 'my-msg', id, false, true, activePeerId, false);
                        connections[activePeerId].send({ user: myUserName, audio: b64, isAudio: true, msgId: id });
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
    } else { mediaRecorder.stop(); isRecording = false; btn.classList.remove('recording'); }
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

function restoreConnections() {
    let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
    list.forEach(id => {
        if (id !== 'Архив' && !connections[id]) {
            const conn = peer.connect(id);
            conn.on('open', () => {
                conn.send({ type: 'reconnect-ping', from: myUserName, avatar: myAvatar });
                setupConnection(conn);
            });
        }
    });
}

function showIncomingAlert(conn, data) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.style.cssText = 'background: #333; padding:15px; border:1px solid var(--accent); border-radius:12px; margin: 10px 0; color: white;';
    
    div.innerHTML = `
        <div style="margin-bottom:10px;"><b>${data.from}</b> хочет начать переписку</div>
        <div style="display:flex; gap:10px; justify-content:center;">
            <button id="acc-${data.from}" class="main-btn" style="flex:1">Принять</button>
            <button id="rej-${data.from}" class="main-btn" style="flex:1; background:#f55; color:white;">Нет</button>
        </div>`;
    
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    document.getElementById(`acc-${data.from}`).onclick = () => {
        if (data.avatar) connections[conn.peer].peerAvatar = data.avatar;
        conn.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });
        div.innerHTML = "Запрос принят ✅";
        setTimeout(() => div.remove(), 2000);
    };

    document.getElementById(`rej-${data.from}`).onclick = () => {
        conn.send({ type: 'reject-chat' });
        div.innerHTML = "Вы отклонили запрос 🚫";
        setTimeout(() => {
            div.remove();
            closeChat(conn.peer, {stopPropagation: () => {}}); // Закрываем вкладку
        }, 1500);
    };
}

function sendTypingStatus() {
    if (activePeerId && connections[activePeerId]?.open) {
        connections[activePeerId].send({ type: 'typing', isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if(connections[activePeerId]) connections[activePeerId].send({ type: 'typing', isTyping: false }) }, 2000);
    }
}

function closeChat(id, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    
    // Если это программный вызов (без e), либо пользователь подтвердил удаление
    if (!e || confirm(`Удалить чат с ${id}?`)) {
        // Обязательно полностью разрываем соединение
        if (connections[id]) { 
            connections[id].close(); 
            delete connections[id]; 
        }
        
        let list = JSON.parse(localStorage.getItem('p2p_chat_list') || '[]');
        localStorage.setItem('p2p_chat_list', JSON.stringify(list.filter(i => i !== id)));
        
        if (activePeerId === id) { 
            activePeerId = null; 
            chatWindow.innerHTML = ''; 
        }
        
        refreshTabs(); 
        loadHistory();
    }
}

// Скрываем ввод при старте, так как чат еще не выбран
loadHistory();
