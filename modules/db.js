// modules/db.js
export const DB_NAME = 'showplayDB';
export const DB_VERSION = 1;
export const PLAYLISTS_STORE = 'playlists';
export const FILES_STORE = 'files';

let db;

export function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(PLAYLISTS_STORE)) {
                dbInstance.createObjectStore(PLAYLISTS_STORE, { keyPath: 'id' });
            }
            if (!dbInstance.objectStoreNames.contains(FILES_STORE)) {
                dbInstance.createObjectStore(FILES_STORE, { autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('Database error:', event.target.error);
            reject(event.target.error);
        };
    });
}

function dbRequest(storeName, mode, action) {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = action(store);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    });
}

export const dbActions = {
    get: (storeName, key) => dbRequest(storeName, 'readonly', store => store.get(key)),
    getAll: (storeName) => dbRequest(storeName, 'readonly', store => store.getAll()),
    put: (storeName, item) => dbRequest(storeName, 'readwrite', store => store.put(item)),
    delete: (storeName, key) => dbRequest(storeName, 'readwrite', store => store.delete(key)),
    add: (storeName, item) => dbRequest(storeName, 'readwrite', store => store.add(item)),
};