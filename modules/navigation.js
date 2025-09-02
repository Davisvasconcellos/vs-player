// modules/navigation.js
import { $, $$ } from './helpers.js';

export function setupNavigation(state, renderPlaylists, showScreen) {
    $('#btnBack').addEventListener('click', () => {
        if ($('#screenPlaylist').classList.contains('active')) {
            $('#headerTitle').textContent = 'Minhas Playlists';
            showScreen('#screenLibrary');
            renderPlaylists();
        }
    });
}

export function setupViewToggle() {
    $('#viewToggle').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const isList = e.target.id === 'btnList';
        $('#btnList').classList.toggle('active', isList);
        $('#btnLive').classList.toggle('active', !isList);
        $('#listMode').style.display = isList ? '' : 'none';
        $('#liveMode').style.display = isList ? 'none' : '';
    });
}