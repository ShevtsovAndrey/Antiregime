// --- network.js: СЕТЕВОЙ СЛОЙ ---

let peer;
let connections = {}; 
let offlineTimer = 0; 
let pingStartTimes = {}; 

// Мониторинг интернета
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

// Инициализация PeerJS
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
        if (typeof Logger !== 'undefined') Logger.logNetwork('error', err.type);
    });
}

// Настройка входящего канала данных
function setupConnection(conn) {
    if (conn.peer === myUserName) { conn.close(); return; }
    if (connections[conn.peer]) connections[conn.peer].close();
    
    connections[conn.peer] = conn;
    connections[conn.peer].isAccepted = false;
    connections[conn.peer].unreadCount = 0;

    conn.on('data', (data) => {
        // Обработка PING-PONG
        if (data.type === 'pong') {
            const rtt = Date.now() - pingStartTimes[data.msgId];
            if (typeof Logger !== 'undefined') Logger.logPing(data.msgId, rtt);
            delete pingStartTimes[data.msgId];
            return;
        }

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

        // Прием контента
        if (data.type === 'chat-msg' || data.image || data.audio) {
            let isImg = !!(data.image || data.isImage);
            let isAud = !!(data.audio || data.isAudio);
            let content = data.text || data.image || data.audio;
            
            if (activePeerId !== conn.peer) {
                if (!connections[conn.peer]) connections[conn.peer] = conn;
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
        addSystemMessage(`❌ Потеряно соединение с ${conn.peer}`);
        if (connections[conn.peer]) connections[conn.peer].isAccepted = false;
        refreshTabs();
    });
}

function reconnectToID(id) {
    if (id === 'Архив') return;
    const conn = peer.connect(id, { reliable: true });
    setupConnection(conn);
    conn.on('open', () => {
        conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
    });
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

// Запуск фоновых процессов
setInterval(updateConnectionStats, 10000);
updateConnectionStats();