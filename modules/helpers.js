// modules/helpers.js
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function log(message) {
    const logContainer = document.getElementById('statusLog');
    if (logContainer) {
        const entry = document.createElement('p');
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    console.log(`[LOG] ${message}`);
}

export function showScreen(screenId) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(screenId).classList.add('active');
    $('#btnBack').style.display = (screenId !== '#screenLibrary') ? 'block' : 'none';
    $('#viewToggle').style.display = (screenId === '#screenPlaylist') ? 'inline-flex' : 'none';
}

export function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseTimeToSeconds(timeString = '0:00') {
    if (!timeString || typeof timeString !== 'string') return 0;
    const parts = timeString.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) {
        return (parts[0] * 60) + parts[1];
    }
    if (parts.length === 3) {
        return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }
    return 0;
}

export function resizeAndCompressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 200;
            const MAX_HEIGHT = 200;
            let { width, height } = img;
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            callback(dataUrl);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}