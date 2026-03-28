const Storage = {
    // Вспомогательная функция, чтобы брать актуальный ник из памяти
    _getUser() {
        return localStorage.getItem('p2p_nickname') || "DefaultUser";
    },

    _k(key) {
        return `${this._getUser()}_${key}`;
    },

    saveMessage(u, t, c, id, isImg, isAud, chatWith) {
        const key = this._k('history');
        let hist = JSON.parse(localStorage.getItem(key) || '[]');
        hist.push({ user: u, text: t, className: c, id: id, isImage: isImg, isAudio: isAud, chatWith: chatWith });
        localStorage.setItem(key, JSON.stringify(hist.slice(-500)));
    },

    getHistory(chatWith) {
        const key = this._k('history');
        let hist = JSON.parse(localStorage.getItem(key) || '[]');
        return hist.filter(m => m.chatWith === chatWith);
    },

    deleteMessage(msgId) {
        const key = this._k('history');
        let hist = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify(hist.filter(m => m.id != msgId)));
    },

    getChatList() {
        const key = this._k('chat_list');
        let list = JSON.parse(localStorage.getItem(key) || '[]');
        if (!list.includes('Архив')) list.unshift('Архив');
        return list;
    },

    saveChatToList(pId) {
        const key = this._k('chat_list');
        let list = this.getChatList();
        if (!list.includes(pId)) {
            list.push(pId);
            localStorage.setItem(key, JSON.stringify(list));
        }
    },

    removeChatFromList(pId) {
        const key = this._k('chat_list');
        let list = this.getChatList();
        localStorage.setItem(key, JSON.stringify(list.filter(id => id !== pId)));
    }
};