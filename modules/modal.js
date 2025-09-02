// modules/modal.js
import { $, $$ } from './helpers.js';
import { dbActions, PLAYLISTS_STORE, FILES_STORE } from './db.js';
import { log, formatTime, parseTimeToSeconds, resizeAndCompressImage } from './helpers.js';
import { loadPlaylists, renderPlaylists } from './playlists.js'; // Ajuste aqui para a navegação

export function setupPlaylistModal(state) {
    const modal = $('#playlistModal');
    $('#addPlaylistBtn').addEventListener('click', () => openModalForCreate(state));
    $('#cancelPlaylistBtn').addEventListener('click', () => closeModal(state));
    $('#removePlaylistBtn').addEventListener('click', () => removePlaylist(state));
    $('#savePlaylistBtn').addEventListener('click', () => savePlaylist(state));
    $('#coverPreview').addEventListener('click', () => $('#coverFileInput').click());
    $('#addTracksBtn').addEventListener('click', () => $('#tracksFileInput').click());
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(state);
    });
    $('#coverFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            state.modal.cover = file;
            resizeAndCompressImage(file, (dataUrl) => {
                $('#coverPreview').style.backgroundImage = `url('${dataUrl}')`;
                $('#coverPreview').innerHTML = '';
            });
        }
    });
    $('#tracksFileInput').addEventListener('change', (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
        const trackPromises = files.map(file => new Promise((resolve, reject) => {
            const trackName = file.name.replace(/\.[^/.]+$/, "");
            const audioTemp = new Audio(URL.createObjectURL(file));
            audioTemp.addEventListener('loadedmetadata', () => {
                resolve({
                    title: trackName,
                    artist: "Artista Desconhecido",
                    delay: 0,
                    duration: formatTime(audioTemp.duration),
                    file: file
                });
                URL.revokeObjectURL(audioTemp.src);
            });
            audioTemp.onerror = () => reject(new Error(`Could not load metadata for ${file.name}`));
        }));
        Promise.all(trackPromises).then(newTracks => {
            state.modal.tracks.push(...newTracks);
            renderModalTracks(state);
        });
    });
}

function openModalForCreate(state) {
    state.isEditing = false;
    state.modal.tracks = [];
    state.modal.cover = null;
    $('#modalTitle').textContent = 'Criar Nova Playlist';
    $('#savePlaylistBtn').textContent = 'Criar';
    $('#removePlaylistBtn').style.display = 'none';
    $('#playlistNameInput').value = '';
    $('#coverPreview').style.backgroundImage = '';
    $('#coverPreview').innerHTML = '<span>Clique para adicionar uma capa</span>';
    $('#tracksSection').style.display = 'block';
    renderModalTracks(state);
    $('#playlistModal').classList.add('active');
}

export function openModalForEdit(state, index) {
    state.isEditing = true;
    state.currentPlaylistIndex = index;
    const playlist = state.playlists[index];
    $('#modalTitle').textContent = 'Editar Playlist';
    $('#savePlaylistBtn').textContent = 'Salvar';
    $('#removePlaylistBtn').style.display = 'inline-block';
    $('#playlistNameInput').value = playlist.name;
    state.modal.cover = null;
    if (playlist.coverKey) {
        dbActions.get(FILES_STORE, playlist.coverKey).then(file => {
            if (file) {
                const url = URL.createObjectURL(file);
                $('#coverPreview').style.backgroundImage = `url('${url}')`;
                $('#coverPreview').innerHTML = '';
            }
        });
    } else {
        $('#coverPreview').style.backgroundImage = '';
        $('#coverPreview').innerHTML = '<span>Clique para alterar a capa</span>';
    }
    $('#tracksSection').style.display = 'block';
    state.modal.tracks = JSON.parse(JSON.stringify(playlist.tracks));
    renderModalTracks(state);
    $('#playlistModal').classList.add('active');
}

function closeModal(state) {
    $('#playlistModal').classList.remove('active');
    state.modal.cover = null;
    state.modal.tracks = [];
}

export async function savePlaylist(state) {
    const name = $('#playlistNameInput').value.trim();
    if (!name) {
        alert('Por favor, insira um nome para a playlist.');
        return;
    }
    log('Iniciando o salvamento da playlist.');
    let coverKey = state.isEditing ? state.playlists[state.currentPlaylistIndex].coverKey : null;
    if (state.modal.cover instanceof File) {
        log('Capa da playlist é um novo arquivo. Salvando no IndexedDB...');
        coverKey = await dbActions.add(FILES_STORE, state.modal.cover).catch(e => {
            log(`ERRO: Falha ao salvar a capa: ${e.message}`);
            return null;
        });
        log(`Capa salva com a chave: ${coverKey}`);
    }
    const tracksWithKeys = [];
    for (const track of state.modal.tracks) {
        if (track.file instanceof File) {
            log(`Processando faixa para salvamento: ${track.title}`);
            const fileKey = await dbActions.add(FILES_STORE, track.file).catch(e => {
                log(`ERRO: Falha ao salvar o arquivo de áudio "${track.title}": ${e.message}`);
                return null;
            });
            log(`Arquivo "${track.title}" salvo com a chave: ${fileKey}`);
            tracksWithKeys.push({ title: track.title, artist: track.artist, delay: track.delay, duration: track.duration, fileKey: fileKey });
        } else {
            tracksWithKeys.push(track);
        }
    }
    log(`Sucesso: ${tracksWithKeys.length} faixas salvas e referenciadas.`);
    const playlistData = {
        id: state.isEditing ? state.playlists[state.currentPlaylistIndex].id : 'p' + Date.now(),
        name: name,
        coverKey: coverKey,
        tracks: tracksWithKeys
    };
    try {
        if (state.isEditing) {
            state.playlists[state.currentPlaylistIndex] = playlistData;
        } else {
            state.playlists.push(playlistData);
        }
        await dbActions.put(PLAYLISTS_STORE, playlistData);
        log('Playlist salva com sucesso no IndexedDB.');
        closeModal(state);
        await loadPlaylists(state);
    } catch (e) {
        log(`ERRO fatal: Falha ao salvar a playlist: ${e.message}`);
    }
}

export async function removePlaylist(state) {
    if (confirm('Tem certeza que deseja remover esta playlist?')) {
        const playlistToRemove = state.playlists[state.currentPlaylistIndex];
        if (playlistToRemove.coverKey) await dbActions.delete(FILES_STORE, playlistToRemove.coverKey);
        for (const track of playlistToRemove.tracks) {
            if (track.fileKey) await dbActions.delete(FILES_STORE, track.fileKey);
        }
        await dbActions.delete(PLAYLISTS_STORE, playlistToRemove.id);
        state.playlists.splice(state.currentPlaylistIndex, 1);
        renderPlaylists(state);
        closeModal(state);
        showScreen('#screenLibrary');
        $('#headerTitle').textContent = 'Minhas Playlists';
    }
}

function renderModalTracks(state) {
    const list = $('#modalTrackList');
    list.innerHTML = '';
    if (state.modal.tracks.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 10px;">Nenhuma faixa</p>';
        return;
    }
    state.modal.tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'track-item';
        item.innerHTML = `
            <span class="title">${track.title}</span>
            <button class="remove-btn" data-index="${index}">×</button>
        `;
        item.querySelector('.remove-btn').addEventListener('click', () => {
            state.modal.tracks.splice(index, 1);
            renderModalTracks(state);
        });
        list.appendChild(item);
    });
}