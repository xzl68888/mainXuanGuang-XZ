// crypto-module.js - AES-GCM Encryption Module for XuanGuang

const CryptoModule = {
    /**
     * Generate a random AES-GCM session key
     * @returns {CryptoKey} AES-GCM key
     */
    async generateKey() {
        return await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * Export a CryptoKey to a Base64 string for sharing
     * @param {CryptoKey} key
     * @returns {string} Base64 encoded key
     */
    async exportKey(key) {
        const raw = await crypto.subtle.exportKey('raw', key);
        return btoa(String.fromCharCode(...new Uint8Array(raw)));
    },

    /**
     * Import a Base64 string back to CryptoKey
     * @param {string} base64Key
     * @returns {CryptoKey}
     */
    async importKey(base64Key) {
        const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
        return await crypto.subtle.importKey(
            'raw', raw,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * Encrypt a message with AES-GCM
     * @param {string} plaintext
     * @param {CryptoKey} key
     * @returns {Promise<{encrypted: string, iv: string}>} Base64 encoded ciphertext and IV
     */
    async encryptMessage(plaintext, key) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(plaintext)
        );
        return {
            encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
            iv: btoa(String.fromCharCode(...iv))
        };
    },

    /**
     * Decrypt a message with AES-GCM
     * @param {string} encryptedBase64 - Base64 encoded ciphertext
     * @param {CryptoKey} key
     * @param {string} ivBase64 - Base64 encoded IV
     * @returns {Promise<string>} Decrypted plaintext
     */
    async decryptMessage(encryptedBase64, key, ivBase64) {
        const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            encrypted
        );
        return new TextDecoder().decode(decrypted);
    }
};

// Expose globally for renderer scripts
if (typeof window !== 'undefined') {
    window.CryptoModule = CryptoModule;
}
