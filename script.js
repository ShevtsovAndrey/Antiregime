// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---

let activePeerId = null;

let typingTimer;

let mediaRecorder;

let audioChunks = [];

let isRecording = false;



// Извлекаем базовые настройки профиля

let myUserName = localStorage.getItem('p2p_nickname') || "User_" + Math.floor(Math.random() * 1000);

let myAvatar = localStorage.getItem('p2p_avatar') || null;



// Элементы DOM

const chatWindow = document.getElementById('chat-window');

const tabsContainer = document.getElementById('chat-tabs');

const messageInput = document.getElementById('message-input');

const peerInput = document.getElementById('peer-id-input');

const typingIndicator = document.getElementById('typing-indicator');



// --- ИНИЦИАЛИЗАЦИЯ ---

function init() {

    // 1. Умный запрос уведомлений (только если решение еще не принято)

    if (window.Notification && Notification.permission === 'default') {

        Notification.requestPermission().then(permission => {

            if (permission === 'granted') {

                addSystemMessage("🔔 Уведомления включены");

            }

        });

    }

   

    // Настройка поля ввода своего ID

    const myIdInp = document.getElementById('my-id-input');

    if (myIdInp) {

        myIdInp.value = myUserName;

        myIdInp.addEventListener('keypress', (e) => { if (e.key === 'Enter') changeMyId(); });

    }



    if (myAvatar) updateAvatarPreview(myAvatar);



    // Запуск PeerJS (из network.js)

    startPeer(myUserName);

   

    // Загрузка интерфейса текущего пользователя через Storage

    refreshTabs();

    openChat('Архив');

}



// --- ОТПРАВКА СООБЩЕНИЙ ---

function sendMessage() {

    const text = messageInput.value.trim();

    if (!text || !activePeerId) return;

    const msgId = Date.now();



    // Логика для Архива (Заметки самому себе)

    if (activePeerId === 'Архив') {

        saveMessage(myUserName, text, 'my-msg', msgId, false, false, 'Архив');

        addMessage(myUserName, text, 'my-msg', msgId, false, false);

        messageInput.value = '';

        return;

    }



    let conn = connections[activePeerId];



    // Проверка состояния соединения

    if (!conn || !conn.open) {

        addSystemMessage(`🔍 Канал с ${activePeerId} закрыт. Восстановление...`);

        if (typeof reconnectToID === 'function') reconnectToID(activePeerId);

        return;

    }



    if (!conn.isAccepted) {

        addSystemMessage(`⏳ Ожидание подтверждения от ${activePeerId}...`);

        return;

    }



    try {

        // Отправка через PeerJS

        if (typeof pingStartTimes !== 'undefined') pingStartTimes[msgId] = Date.now();

        conn.send({ user: myUserName, text: text, msgId: msgId, type: 'chat-msg' });

       

        // Сохранение и отрисовка

        saveMessage(myUserName, text, 'my-msg', msgId, false, false, activePeerId);

        addMessage(myUserName, text, 'my-msg', msgId, false, false);

        messageInput.value = '';

    } catch (e) {

        addSystemMessage(`❌ Ошибка отправки: ${e.message}`);

    }

}



// --- ГОЛОСОВЫЕ ---

async function toggleRecording() {

    const btn = document.getElementById('voice-btn');

    if (!isRecording) {

        try {

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            mediaRecorder = new MediaRecorder(stream);

            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

            mediaRecorder.onstop = () => {

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

                const reader = new FileReader();

                reader.readAsDataURL(audioBlob);

                reader.onloadend = () => sendMedia(reader.result, 'audio');

                stream.getTracks().forEach(track => track.stop());

            };

            mediaRecorder.start();

            isRecording = true;

            btn.innerHTML = "⏹️"; btn.style.color = "#f44336";

        } catch (err) { console.error("Mic error", err); }

    } else {

        mediaRecorder.stop();

        isRecording = false;

        btn.innerHTML = "🎤"; btn.style.color = "";

    }

}



// --- МЕДИА (ФОТО/АУДИО) ---

function uploadChatImage(input) {

    if (!activePeerId) { input.value = ''; return; }

    const file = input.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => { sendMedia(e.target.result, 'image'); input.value = ''; };

    reader.readAsDataURL(file);

}



function sendMedia(base64Data, type) {

    const msgId = Date.now();

    if (activePeerId === 'Архив') {

        saveAndRenderMyMedia(base64Data, type, 'Архив', msgId);

        return;

    }

    const conn = connections[activePeerId];

    if (!conn || !conn.open) return;



    const payload = { user: myUserName, msgId: msgId, type: 'chat-msg' };

    if (type === 'audio') { payload.audio = base64Data; payload.isAudio = true; }

    else { payload.image = base64Data; payload.isImage = true; }



    try {

        conn.send(payload);

        saveAndRenderMyMedia(base64Data, type, activePeerId, msgId);

    } catch (e) { console.error("Media error", e); }

}



function saveAndRenderMyMedia(data, type, chatWith, msgId) {

    const isImg = type === 'image';

    const isAud = type === 'audio';

    saveMessage(myUserName, data, 'my-msg', msgId, isImg, isAud, chatWith);

    if (activePeerId === chatWith) addMessage(myUserName, data, 'my-msg', msgId, isImg, isAud);

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

   

    // Пинг только для моих исходящих

    let pingHtml = (className === 'my-msg' && activePeerId !== 'Архив') ? `<span id="ping-${id}" class="ping-tag">...</span>` : '';



    div.innerHTML = `<b>${avHtml}${user}:</b> ${body}${pingHtml}`;

    if (id) div.innerHTML += `<br><span class="del-btn" onclick="window.deleteMsg(${id})">Удалить</span>`;

   

    chatWindow.appendChild(div);

    chatWindow.scrollTop = chatWindow.scrollHeight;

}



function addSystemMessage(t) {

    const d = document.createElement('div');

    d.className = 'system-msg';

    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});

    d.innerText = `[${time}] ${t}`;

    chatWindow.appendChild(d);

    chatWindow.scrollTop = chatWindow.scrollHeight;

}



// --- УПРАВЛЕНИЕ ЧАТАМИ (ИНТЕГРАЦИЯ СО STORAGE) ---

function openChat(pId, shouldFocus = true) {

    if (shouldFocus) {

        activePeerId = pId;

       

        // --- ВОТ ЭТО ИСПРАВИТ ПОСТОЯННОЕ ГОРЕНИЕ ---

        const conn = connections[pId];

        if (conn) {

            conn.unreadCount = 0;

            // Если мы сами кликнули на вкладку, считаем запрос принятым

            if (!conn.isAccepted) {

                conn.isAccepted = true;

                // Отправляем ответку собеседнику, чтобы у него тоже всё открылось

                if (conn.open) {

                    conn.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });

                }

                // Убираем плашку-уведомление, если она висела в чате

                document.getElementById(`alert-${pId}`)?.remove();

            }

        }

    }

   

    Storage.saveChatToList(pId);

    refreshTabs();

   

    if (shouldFocus) {

        loadHistory();

        if (pId !== 'Архив' && (!connections[pId] || !connections[pId].open)) {

            addSystemMessage(`🔎 Канал с ${pId} не активен.`);

        }

    }

}



function loadHistory() {

    chatWindow.innerHTML = '';

    if (!activePeerId) return;

   

    // Получаем историю через Storage (он сам подставит префикс текущего ника)

    const history = Storage.getHistory(activePeerId);

    history.forEach(m => addMessage(m.user, m.text, m.className, m.id, m.isImage, m.isAudio));

}



function saveMessage(u, t, c, id, isImg, isAud, chatWith) {

    Storage.saveMessage(u, t, c, id, isImg, isAud, chatWith);

}



// --- ОБНОВЛЕННЫЕ ФУНКЦИИ ---



function refreshTabs() {

    tabsContainer.innerHTML = '';

    const list = Storage.getChatList();



    list.forEach(id => {

        const isNotes = (id === 'Архив');

        const conn = connections[id];

       

        const isOnline = !isNotes && (conn?.open && conn?.isAccepted);

        const unread = (!isNotes && conn && conn.unreadCount > 0) ? conn.unreadCount : 0;

        const isNewRequest = !isNotes && conn && !conn.isAccepted;



        const tab = document.createElement('div');

        tab.className = `tab ${id === activePeerId ? 'active' : ''} ${isNewRequest ? 'request-pending' : ''}`;

       

        const badgeHtml = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';

       

        // Верстка с абсолютным позиционированием кнопок для идеального центра

        tab.innerHTML = `

            ${!isNotes ? `

                <span class="reconnect-tab" title="Обновить связь"

                      onclick="event.stopPropagation(); reconnectToID('${id}')"

                      style="position: absolute; left: 10px; cursor: pointer; opacity: 0.6;">🔄</span>

            ` : ''}

           

            <span class="tab-name" style="width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 30px;">

                ${id}

            </span>

           

            ${badgeHtml}

           

            <div style="position: absolute; right: 10px; display: flex; align-items: center; gap: 5px;">

                ${!isNotes ? `<span class="status-dot ${isOnline ? 'online' : ''}"></span>` : ''}

                ${!isNotes ? `

                    <span class="close-tab" title="Удалить чат"

                          onclick="closeChat('${id}', event)"

                          style="cursor: pointer; font-size: 18px; line-height: 1;">×</span>

                ` : ''}

            </div>

        `;



        tab.onclick = () => openChat(id);

        tabsContainer.appendChild(tab);

    });

}



window.acceptChat = (peerId, avatar) => {

    console.log("Пытаюсь принять чат от:", peerId);

   

    const c = connections[peerId];

    if (!c) {

        console.error("Соединение не найдено в объекте connections!");

        return;

    }



    // 1. Обновляем данные соединения

    c.isAccepted = true;

    if (avatar) c.peerAvatar = avatar;



    // 2. Отправляем подтверждение собеседнику

    if (c.open) {

        c.send({ type: 'handshake-ok', from: myUserName, avatar: myAvatar });

    }



    // 3. Убираем плашку уведомления

    const alertId = `alert-${peerId}`;

    const alertEl = document.getElementById(alertId);

    if (alertEl) alertEl.remove();



    // 4. ПРИНУДИТЕЛЬНЫЙ ПЕРЕХОД

    // Сначала сохраняем чат в список, чтобы он точно был в табах

    Storage.saveChatToList(peerId);

   

    // Делаем небольшую паузу, чтобы состояние синхронизировалось

    setTimeout(() => {

        // Вызываем открытие чата. Внутри openChat уже есть refreshTabs и loadHistory

        openChat(peerId, true);

        console.log("Переход на вкладку выполнен:", peerId);

    }, 50);

};



function showIncomingAlert(conn, data) {

    const alertId = `alert-${conn.peer}`;

    if (document.getElementById(alertId)) return;

   

    // Сразу обновляем табы, чтобы вкладка начала мигать оранжевым (через CSS .request-pending)

    refreshTabs();



    const div = document.createElement('div');

    div.id = alertId;

    div.className = 'system-msg';

    // Оформляем как заметное уведомление

    div.style.cssText = "background:#2d2d2d; border-left:4px solid var(--accent); padding:12px; margin:10px 0; border-radius:4px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);";

   

    div.innerHTML = `

        <div style="margin-bottom:8px;">🤝 Входящий запрос: <b>${data.from}</b></div>

        <button onclick="acceptChat('${conn.peer}', '${data.avatar || ''}')"

                class="main-btn"

                style="width:100%; padding:8px; font-size:12px;">

            ПРИНЯТЬ И ПЕРЕЙТИ

        </button>

    `;

    chatWindow.appendChild(div);

    chatWindow.scrollTop = chatWindow.scrollHeight;

}



function connectToPeer() {

    const id = peerInput.value.trim();

    if (!id) return;



    // ПРОВЕРКА: Если ввели свой же ID

    if (id === myUserName) {

        peerInput.value = '';

        openChat('Архив'); // Переносим в Архив

        triggerArchiveFlash(); // Запускаем мигание

        addSystemMessage("📁 Это ваш ID. Добро пожаловать в Архив!");

        return;

    }

   

    openChat(id, true);

    if (typeof reconnectToID === 'function') reconnectToID(id);

    peerInput.value = '';

}



// Функция для разового "призыва" внимания к Архиву

function triggerArchiveFlash() {

    // Ищем вкладку Архива по тексту внутри (так как у неё нет уникального ID в списке)

    const tabs = document.querySelectorAll('.tab');

    tabs.forEach(tab => {

        if (tab.querySelector('.tab-name')?.innerText === 'Архив') {

            tab.classList.add('archive-flash');

            // Убираем класс через 3 секунды, чтобы не мигало вечно

            setTimeout(() => {

                tab.classList.remove('archive-flash');

            }, 3000);

        }

    });

}



function closeChat(id, e) {

    if (e) e.stopPropagation(); // Чтобы не сработал клик по самой вкладке

   

    if (confirm(`Удалить чат с "${id}" и очистить вкладку?`)) {

        // Закрываем соединение если оно есть

        if (connections[id]) {

            connections[id].close();

            delete connections[id];

        }

       

        // Удаляем из списка в LocalStorage (функция из нашего модуля Storage)

        Storage.removeChatFromList(id);

       

        // Если закрыли текущий активный чат — уходим в Архив

        if (activePeerId === id) {

            activePeerId = 'Архив';

            loadHistory();

        }

       

        refreshTabs();

    }

}



// --- УДАЛЕНИЕ СООБЩЕНИЙ ---

window.deleteMsg = (id) => {

    // Удаляем визуально

    const el = document.querySelector(`[data-id="${id}"]`);

    if (el) el.remove();

   

    // Удаляем из базы текущего пользователя через Storage

    Storage.deleteMessage(id);

   

    // Если есть связь, уведомляем собеседника об удалении

    if (activePeerId && connections[activePeerId]?.isAccepted) {

        connections[activePeerId].send({ type: 'delete', msgId: id });

    }

};



// --- АККАУНТ И АВАТАР ---

function changeMyId() {

    const inp = document.getElementById('my-id-input');

    const newId = inp ? inp.value.trim() : null;

    if (!newId || newId === myUserName) return;

   

    myUserName = newId;

    localStorage.setItem('p2p_nickname', myUserName);

    // Перезагрузка страницы для инициализации Storage под новым ником

    location.reload();

}



function updateAvatarPreview(src) {

    const prev = document.getElementById('my-avatar-preview');

    if (prev) prev.innerHTML = `<img src="${src}">`;

}



function uploadAvatar(input) {

    if (!input.files[0]) return;

    const reader = new FileReader();

    reader.onload = (e) => {

        myAvatar = e.target.result;

        localStorage.setItem('p2p_avatar', myAvatar);

        updateAvatarPreview(myAvatar);

    };

    reader.readAsDataURL(input.files[0]);

}



// --- СИСТЕМНЫЕ СТАТУСЫ ---

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

        <div>Входящий запрос: <b>${data.from}</b></div>

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

    }

    document.getElementById(`alert-${peerId}`)?.remove();

    refreshTabs();

};



function sendPushNotification(user, text, isImg, isAud) {

    if (typeof Logger !== 'undefined') Logger.showNotification(user, text, isImg, isAud);

}



// --- ЛАЙТБОКС (ПРОСМОТР ФОТО) ---

window.openLightbox = (src) => {

    const lb = document.getElementById('lightbox');

    const img = document.getElementById('lightbox-img');

    if (lb && img) {

        img.src = src;

        lb.classList.add('open');

    }

};



// --- СТАРТ ПРИЛОЖЕНИЯ ---

init();



// Слушатели событий

messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

messageInput.addEventListener("input", sendTypingStatus);

peerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") connectToPeer(); });