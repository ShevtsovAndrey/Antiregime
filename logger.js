// МОДУЛЬ СИСТЕМНОГО МОНИТОРИНГА 
const Logger = {
    // Вывод в системный чат (то, что видит пользователь)
    logSystem(message, type = 'info') {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            network: '🌐',
            debug: '🔍',
            wait: '⏳'
        };
        
        const icon = icons[type] || '🔔';
        const formattedMsg = `${icon} ${message}`;
        
        // Вызываем твою основную функцию из основного скрипта
        if (typeof addlog === 'function') {
            addlog(formattedMsg);
        }
        
        // Дублируем в консоль разработчика для дебага
        console.log(`[${new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${message}`);
    },

    // Логирование сетевых событий (PeerJS)
    logNetwork(event, data = '') {
        switch(event) {
            case 'open':
                this.logSystem(`Сеть готова. Ваш ID: ${data}`, 'network');
                break;
            case 'connect':
                this.logSystem(`Попытка подключения к: ${data}`, 'debug');
                break;
            case 'close':
                this.logSystem(`Потеряно соединение с ${data}`, 'error');
                break;
            case 'error':
                this.logSystem(`Ошибка сети: ${data}`, 'error');
                break;
        }
    },

    // Отслеживание пинга
    logPing(id, rtt) {
        const pingEl = document.getElementById(`ping-${id}`);
        if (pingEl) {
            pingEl.innerText = `${rtt}ms`;
            pingEl.style.color = rtt < 150 ? "#4caf50" : (rtt < 400 ? "#ff9800" : "#f44336");
        }
    },

    // Пуш-уведомления браузера
    showNotification(user, text, isImg, isAud) {
        let bodyText = text;
        if (isImg) bodyText = "📷 Фотография";
        if (isAud) bodyText = "🎤 Голосовое сообщение";

        console.log(`[PUSH] Новое сообщение от ${user}`);

        if (Notification.permission === 'granted') {
            try {
                new Notification(user, { 
                    body: bodyText,
                    icon: 'icon.png' // если есть иконка
                });
            } catch (e) {
                console.warn("Не удалось отправить Push-уведомление");
            }
        }
    }
};

// Перехват стандартных ошибок для логгера
window.onerror = function(message, source, lineno, colno, error) {
    Logger.logSystem(`Критическая ошибка: ${message} (строка: ${lineno})`, 'error');
    return false;
};