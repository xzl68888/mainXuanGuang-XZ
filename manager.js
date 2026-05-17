// webrtc-manager.js - Minimal stub for now
// TODO: Implement full WebRTC functionality later

class WebRTCManager {
    constructor() {
        this.myId = 'user-' + Math.random().toString(36).substr(2, 9);
        this.peers = new Map();
        this.messageHandlers = [];
        this.connectHandlers = [];
        this.disconnectHandlers = [];
    }

    onMessage(cb) {
        this.messageHandlers.push(cb);
    }

    onConnect(cb) {
        this.connectHandlers.push(cb);
    }

    onDisconnect(cb) {
        this.disconnectHandlers.push(cb);
    }

    createOffer() {
        console.log('WebRTC: createOffer called (not implemented yet)');
        return null;
    }

    handleOffer(offer) {
        console.log('WebRTC: handleOffer called (not implemented yet)');
        return null;
    }

    applyAnswer(peerId, answer) {
        console.log('WebRTC: applyAnswer called (not implemented yet)');
    }

    sendToAll(msg) {
        console.log('WebRTC: sendToAll called (not implemented yet)', msg);
    }

    sendTo(peerId, msg) {
        console.log('WebRTC: sendTo called (not implemented yet)', peerId, msg);
    }

    disconnectAll() {
        console.log('WebRTC: disconnectAll called (not implemented yet)');
        this.peers.clear();
    }
}

module.exports = WebRTCManager;
