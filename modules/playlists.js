// modules/playlists.js
import { dbActions, PLAYLISTS_STORE, FILES_STORE } from './db.js';
import { $, $$, log, showScreen, formatTime, parseTimeToSeconds } from './helpers.js';
import { openModalForEdit } from './modal.js';
import { navigateToPlaylist } from './navigation.js';



export async function loadPlaylists(state) {
    log('Carregando playlists do IndexedDB.');
    try {
        state.playlists = await dbActions.getAll(PLAYLISTS_STORE);
        log(`Sucesso: ${state.playlists.length} playlists carregadas.`);
        renderPlaylists(state);
    } catch (e) {
        log(`ERRO: Falha ao carregar playlists: ${e.message}`);
    }
}

export function renderPlaylists(state) {
    const grid = $('#screenLibrary .grid');
    if (!grid) {
        log('ERRO: O elemento de grid (#screenLibrary .grid) não foi encontrado.');
        return;
    }
    const svgEdit = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

    grid.innerHTML = '';
    if (state.playlists.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 20px;">Nenhuma playlist. Clique no "+" para adicionar.</p>';
        return;
    }

    state.playlists.forEach((playlist, index) => {
        const totalDurationInSeconds = playlist.tracks.reduce((total, track) => {
            return total + parseTimeToSeconds(track.duration);
        }, 0);
        const totalDurationFormatted = formatTime(totalDurationInSeconds);

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.playlistIndex = index;

        if (playlist.coverKey) {
            dbActions.get(FILES_STORE, playlist.coverKey).then(file => {
                if (file) {
                    const url = URL.createObjectURL(file);
                    card.querySelector('.thumb').style.backgroundImage = `url('${url}')`;
                }
            }).catch(err => console.error(`Could not load cover for playlist ${playlist.name}`, err));
        }

        card.innerHTML = `
            <div class="thumb" style="background: linear-gradient(135deg, var(--accent), var(--accent-2));"></div>
            <button class="options-btn" data-index="${index}">${svgEdit}</button>
            <div class="playlist-info">
                <h3>${playlist.name}</h3>
                <div class="playlist-stats">
                    <span>${playlist.tracks.length} faixas</span>
                    <span>${totalDurationFormatted}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.options-btn')) navigateToPlaylist(state, index);
        });
        card.querySelector('.options-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openModalForEdit(state, index);
        });
        grid.appendChild(card);
    });
}