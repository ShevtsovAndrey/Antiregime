const Storage = {
    _getUser() {
        return localStorage.getItem('p2p_nickname') || "DefaultUser";
    },
    _k(key) {
        return `${this._getUser()}_${key}`;
    },
    // КРИТИЧНО: Получаем ID последнего сообщения для конкретного чата
    getLastMsgId(chatWith) {
        const hist = this.getHistory(chatWith);
        return hist.length > 0 ? hist[hist.length - 1].id : 0;
    },
    saveMessage(u, t, c, id, isImg, isAud, chatWith) {
        const key = this._k('history');
        let hist = JSON.parse(localStorage.getItem(key) || '[]');
        if (hist.some(m => m.id === id)) return;
        hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: chatWith });
        localStorage.setItem(key, JSON.stringify(hist.slice(-500)));
    },
    getHistory(chatWith) {
        const key = this._k('history');
        let hist = JSON.parse(localStorage.getItem(key) || '[]');
        // Фильтруем историю строго по собеседнику
        return hist.filter(m => m.chatWith === chatWith);
    },
   getChatList() {
        // _k гарантирует, что мы берем список ИМЕННО для текущего ника
        const key = this._k('chat_list'); 
        let list = JSON.parse(localStorage.getItem(key) || '[]');
        if (!list.includes('Архив')) list.unshift('Архив');
        return list;
    },
    saveChatToList(pId) {
        if (!pId || pId === 'Архив') return;
        const key = this._k('chat_list');
        let list = this.getChatList();
        if (!list.includes(pId)) {
            list.push(pId);
            localStorage.setItem(key, JSON.stringify(list));
        }
    },
    // Добавь этот метод, чтобы принудительно обновлять список при входе
    initUserSpace() {
        refreshTabs(); // Вызываем отрисовку вкладок из script.js
        console.log(`[STORAGE] Пространство ${this._getUser()} готово.`);
    }
};