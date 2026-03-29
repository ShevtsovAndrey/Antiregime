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
    
    // Входящие подключения (когда звонят НАМ)
    peer.on('connection', (conn) => { 
        conn.isOutbound = false; // Помечаем как входящее
        setupConnection(conn); 
    });
    
    peer.on('open', (newId) => { 
        addlog(`🌐 Сеть готова. Ваш ID: ${newId}`); 
        refreshTabs(); 
    });

    peer.on('error', (err) => {
        if (typeof Logger !== 'undefined') Logger.logNetwork('error', err.type);
        if (err.type === 'unavailable-id') {
            addlog("❌ Этот ID уже занят");
        }
    });
}

// Функция для кнопки "Чат" (исходящее соединение)
function connectToPeer() {
    const id = document.getElementById('peer-id-input').value.trim();
    if (!id) return alert("Введите ID");
    if (id === myUserName) return alert("Нельзя подключиться к самому себе");

    addlog(`🌐 Установка связи с ${id}...`);
    
    const conn = peer.connect(id, { reliable: true });
    conn.isOutbound = true; // Помечаем, что МЫ инициаторы
    
    setupConnection(conn);
}

// Настройка канала данных
function setupConnection(conn) {
    if (conn.peer === myUserName) { conn.close(); return; }
    connections[conn.peer] = conn;

    conn.on('open', () => {
        // Отправляем запрос на чат ТОЛЬКО если мы инициаторы
        if (conn.isOutbound) {
            console.log(`[NET] Отправляем запрос контакту ${conn.peer}`);
            conn.send({ type: 'request-chat', from: myUserName, avatar: myAvatar });
        }
        
        // Синхронизацию запрашиваем в любом случае
        const lastId = Storage.getLastMsgId(conn.peer);
        conn.send({ type: 'sync-request', lastMsgId: lastId });
    });

    conn.on('data', (data) => {
        // --- ВАЖНО: УВЕДОМЛЕНИЕ О ЗАПРОСЕ ---
        if (data.type === 'request-chat') {
            // Показываем уведомление, только если это входящий запрос
            // и мы еще не приняли этот чат ранее в этой сессии
            if (!connections[conn.peer].isAccepted) {
                console.log("Входящий запрос от:", data.from);
                if (typeof showIncomingAlert === 'function') {
                    showIncomingAlert(conn, data);
                }
            }
            return;
        }

        // --- СИНХРОНИЗАЦИЯ ---
        if (data.type === 'sync-request') {
            const missing = Storage.getHistory(conn.peer).filter(m => m.id > data.lastMsgId);
            if (missing.length > 0) conn.send({ type: 'sync-data', messages: missing });
            return;
        }

        if (data.type === 'sync-data') {
            data.messages.forEach(m => {
                Storage.saveMessage(m.user, m.text, m.className, m.id, !!m.isImage, !!m.isAudio, conn.peer);
            });
            if (activePeerId === conn.peer) loadHistory();
            refreshTabs();
            return;
        }

        // --- ОБЫЧНЫЕ СООБЩЕНИЯ ---
        if (data.type === 'chat-msg') {
            Storage.saveMessage(data.user || conn.peer, data.text, 'peer-msg', data.msgId, !!data.isImage, !!data.isAudio, conn.peer);
            if (activePeerId === conn.peer) {
                addMessage(data.user || conn.peer, data.text, 'peer-msg', data.msgId, data.isImage, data.isAudio);
            } else {
                connections[conn.peer].unreadCount = (connections[conn.peer].unreadCount || 0) + 1;
            }
            refreshTabs();
        }
    });

    conn.on('close', () => {
        addlog(`❌ Соединение с ${conn.peer} закрыто`);
        refreshTabs();
    });
}

function reconnectToID(id) {
    if (id === 'Архив' || !id) return;
    const conn = peer.connect(id, { reliable: true });
    
    conn.isOutbound = true; 
    conn.isSilentReconnect = true; // Флаг, чтобы не спамить алертами при авто-подключении
    
    setupConnection(conn);
}

function rebootMessenger() {
    const btn = document.getElementById('reboot-btn');
    if (btn) btn.style.transform = "rotate(360deg)";
    addlog("🔄 Перезапуск модулей связи...");
    
    Object.values(connections).forEach(c => { if(c) c.close(); });
    connections = {};
    if (peer) peer.destroy();

    setTimeout(() => {
        startPeer(myUserName);
        if (btn) btn.style.transform = "rotate(0deg)";
        addlog("✅ Система онлайн");
    }, 1000);
}

// Запуск фоновых процессов
setInterval(updateConnectionStats, 10000);
updateConnectionStats();