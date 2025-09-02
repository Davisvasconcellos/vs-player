import { $, $$, log, showScreen, formatTime, parseTimeToSeconds, resizeAndCompressImage } from './modules/helpers.js';
import { applyTheme, toggleTheme } from './modules/theme.js';
import { openDB, dbActions, PLAYLISTS_STORE, FILES_STORE } from './modules/db.js';
import { setupNavigation, setupViewToggle } from './modules/navigation.js';

// ---- miniPlayer CONFIG----
let audio = null;
const playPauseIcons = {
    play: '▶',
    pause: '❚❚',
};


(function() {
    'use strict';

    // ===== IndexedDB Helper =====
    // Movido para modules/db.js

    // ===== Seletores e Constantes =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);
    const svgEdit = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    let currentDragSrcEl = null;

// ===== Estado Global da Aplicação =====
    const state = {
        playlists: [],
        currentPlaylistIndex: -1,
        isEditing: false,
        dragSrcEl: null,
        modal: {
            tracks: [],
            cover: null
        },
        currentTrackIndex: -1, // Novo: índice da faixa atual
        player: { // Novo: estado do player
            isPlaying: false,
            delayTimeout: null,
            isSeeking: false,
            countdownInterval: null,
        },
        volume: {
            current: 70,
            previous: 70
        }

    };

    // ===== Helpers =====
// Remova a seção de Helpers do seu app.js
// movido para module




    
    // ===== Tema =====
// movido para module


    // ===== Lógica de Playlists e Modal =====
    async function loadPlaylists() {
        log('Carregando playlists do IndexedDB.');
        try {
            state.playlists = await dbActions.getAll(PLAYLISTS_STORE);
            log(`Sucesso: ${state.playlists.length} playlists carregadas.`);
            renderPlaylists();
        } catch (e) {
            log(`ERRO: Falha ao carregar playlists: ${e.message}`);
        }
    }

    function renderPlaylists() {
        const grid = $('#screenLibrary .grid');
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
                });
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
                if (!e.target.closest('.options-btn')) navigateToPlaylist(index);
            });
            card.querySelector('.options-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForEdit(index);
            });
            grid.appendChild(card);
        });
    }
    
    function navigateToPlaylist(index) {
        state.currentPlaylistIndex = index;
        const playlist = state.playlists[state.currentPlaylistIndex];
        $('#headerTitle').textContent = playlist.name;
        renderList();
        renderPads();
        showScreen('#screenPlaylist');
    }
    
    function setupPlaylistModal() {
        const modal = $('#playlistModal');
        $('#addPlaylistBtn').addEventListener('click', () => openModalForCreate());
        $('#cancelPlaylistBtn').addEventListener('click', () => closeModal());
        $('#removePlaylistBtn').addEventListener('click', removePlaylist);
        $('#savePlaylistBtn').addEventListener('click', savePlaylist);
        $('#coverPreview').addEventListener('click', () => $('#coverFileInput').click());
        $('#addTracksBtn').addEventListener('click', () => $('#tracksFileInput').click());
        window.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
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
                renderModalTracks();
            });
        });
    }

    function openModalForCreate() {
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
        renderModalTracks();
        $('#playlistModal').classList.add('active');
    }

    function openModalForEdit(index) {
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
        renderModalTracks();
        $('#playlistModal').classList.add('active');
    }
    
    function closeModal() {
        $('#playlistModal').classList.remove('active');
        state.modal.cover = null;
        state.modal.tracks = [];
    }

    async function savePlaylist() {
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
            closeModal();
            await loadPlaylists();
        } catch (e) {
            log(`ERRO fatal: Falha ao salvar a playlist: ${e.message}`);
        }
    }

    async function removePlaylist() {
        if (confirm('Tem certeza que deseja remover esta playlist?')) {
            const playlistToRemove = state.playlists[state.currentPlaylistIndex];
            if (playlistToRemove.coverKey) await dbActions.delete(FILES_STORE, playlistToRemove.coverKey);
            for (const track of playlistToRemove.tracks) {
                if (track.fileKey) await dbActions.delete(FILES_STORE, track.fileKey);
            }
            await dbActions.delete(PLAYLISTS_STORE, playlistToRemove.id);
            state.playlists.splice(state.currentPlaylistIndex, 1);
            renderPlaylists();
            closeModal();
            showScreen('#screenLibrary');
            $('#headerTitle').textContent = 'Minhas Playlists';
        }
    }

    function renderModalTracks() {
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
                renderModalTracks();
            });
            list.appendChild(item);
        });
    }

    function renderList() {
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        const list = $('#listMode');
        list.innerHTML = tracks.length === 0 ? '<p class="empty-message">Nenhuma faixa. Edite a playlist para adicionar.</p>' : '';
        tracks.forEach((track, i) => {
            const row = document.createElement('div');
            row.className = 'row';
            row.dataset.trackIndex = i;
            row.draggable = true;
            row.innerHTML = `
                <div class="num">${i + 1}</div>
                <div class="meta">
                    <div class="title">${track.title}</div>
                    <div class="artist">${track.artist}</div>
                </div>
                <div class="duration">${track.duration}</div>
                <input type="number" class="delay-input" value="${track.delay || 0}" min="0" max="300" step="1">
            `;
            setupTrackEventListeners(row, track, i);
            list.appendChild(row);
        });
    }

    function renderPads() {
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        const padsContainer = $('#liveMode');
        padsContainer.innerHTML = tracks.length === 0 ? '<p class="empty-message">Nenhuma faixa. Edite a playlist para adicionar.</p>' : '';
        tracks.forEach((track, i) => {
            const pad = document.createElement('div');
            pad.className = 'pad';
            pad.dataset.trackIndex = i;
            pad.draggable = true;
            pad.innerHTML = `
                <div class="big">${i + 1}</div>
                <div class="label">${track.title}</div>
                <div class="sub">${track.duration} • Delay ${track.delay || 0}s</div>
            `;
            setupTrackEventListeners(pad, track, i);
            padsContainer.appendChild(pad);
        });
    }

// --- miniPlayer FUNCTIONS
    async function playTrack(track, index) {
        if (!audio || !track.fileKey) {
            console.error(`Erro: Áudio ou fileKey não encontrado para "${track.title}"`);
            alert(`Erro: Não foi possível reproduzir "${track.title}"`); // Temporário para iPad
            return;
        }
        try {
            const audioFile = await dbActions.get(FILES_STORE, track.fileKey);
            if (!audioFile) {
                console.error(`Arquivo não encontrado para "${track.title}"`);
                alert(`Erro: Arquivo não encontrado para "${track.title}"`); // Temporário para iPad
                return;
            }
            audio.pause();
            state.currentTrackIndex = index;
            state.player.isPlaying = true;
            console.log(`Arquivo carregado: tipo=${audioFile.type}, tamanho=${audioFile.size} bytes`);
            alert(`Arquivo: tipo=${audioFile.type}, tamanho=${audioFile.size} bytes`); // Temporário para iPad
            audio.src = URL.createObjectURL(audioFile);
            await audio.play();
            const miniTitle = $('#miniTitle');
            if (miniTitle) miniTitle.textContent = track.title;
            const miniPlay = $('#miniPlay');
            if (miniPlay) miniPlay.innerHTML = playPauseIcons.pause;
            alert(`Reproduzindo: ${track.title}`); // Temporário para iPad
        } catch (e) {
            console.error(`Detalhes do erro: ${e.name} - ${e.message}`);
            alert(`Erro detalhado: ${e.name} - ${e.message}`); // Temporário para iPad
            console.error(`Erro ao reproduzir "${track.title}": ${e.message}`);
            alert(`Erro ao reproduzir "${track.title}": ${e.message}`); // Temporário para iPad
            state.player.isPlaying = false;
            const miniPlay = $('#miniPlay');
            if (miniPlay) miniPlay.innerHTML = playPauseIcons.play;
        }
    }

    function setupTrackEventListeners(element, track, index) {
        const delayInput = element.querySelector('.delay-input');
        if (delayInput) {
            delayInput.addEventListener('input', function() {
                track.delay = Math.max(0, Math.min(300, parseInt(this.value || 0)));
                this.value = track.delay;
                dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
                const correspondingPad = $(`.pad[data-track-index="${index}"]`);
                if (correspondingPad) {
                    const subElement = correspondingPad.querySelector('.sub');
                    if (subElement) {
                        subElement.textContent = `${track.duration} • Delay ${track.delay}s`;
                    }
                }
            });

            element.addEventListener('click', (e) => {
                if (e.target.closest('.delay-input')) return;
                playTrack(track, index);
            });
        }
        // Eventos de Toque (adicionado para o suporte móvel)
        element.addEventListener('touchstart', handleTouchStart, { passive: false });
        element.addEventListener('touchmove', handleTouchMove, { passive: false });
        element.addEventListener('touchend', handleTouchEnd);
        
        // Eventos de Mouse (manter para o desktop)
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('dragleave', handleDragLeave);
        element.addEventListener('drop', handleDrop);
        element.addEventListener('dragend', handleDragEnd);
    }
    
    // ===== Lógica de Drag-and-Drop para Mouse e Toque =====
    function handleDragStart(e) {
        this.style.opacity = '0.4';
        state.dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
    }
    
    function handleDragOver(e) {
        e.preventDefault();
        this.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragLeave() {
        this.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.stopPropagation();
        if (state.dragSrcEl !== this) {
            reorderTracks(state.dragSrcEl, this);
        }
        handleDragEnd.call(this); // Chama a lógica de finalização
    }

    function handleDragEnd() {
        this.style.opacity = '1';
        $$('.row, .pad').forEach(item => item.classList.remove('drag-over'));
        state.dragSrcEl = null;
    }
    
    // Funções de Toque (reproduzem a lógica de drag-and-drop)
    function handleTouchStart(e) {
        e.stopPropagation();
        currentDragSrcEl = this;
        this.classList.add('dragging');
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!currentDragSrcEl) return;

        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);

        if (!targetEl || !targetEl.closest('.row')) return;
        const dropTarget = targetEl.closest('.row');

        if (dropTarget !== currentDragSrcEl) {
            $$('.row, .pad').forEach(el => el.classList.remove('drag-over'));
            dropTarget.classList.add('drag-over');
        }
    }

    function handleTouchEnd(e) {
        e.stopPropagation();
        if (!currentDragSrcEl) return;

        const touch = e.changedTouches[0];
        const dropTargetEl = document.elementFromPoint(touch.clientX, touch.clientY);

        if (dropTargetEl) {
            const dropTarget = dropTargetEl.closest('.row');
            if (dropTarget && dropTarget !== currentDragSrcEl) {
                reorderTracks(currentDragSrcEl, dropTarget);
            }
        }
        handleTouchEndCleanUp();
    }
    
    function handleTouchEndCleanUp() {
        if (currentDragSrcEl) {
            currentDragSrcEl.classList.remove('dragging');
        }
        $$('.row, .pad').forEach(el => el.classList.remove('drag-over'));
        currentDragSrcEl = null;
    }
    
    // Função unificada para reordenar a lista, agora compatível com modo "Lista" e "Live"
    function reorderTracks(sourceEl, targetEl) {
        // Certifique-se de que os elementos têm os datasets corretos
        const fromIndex = parseInt(sourceEl.dataset.trackIndex);
        const toIndex = parseInt(targetEl.dataset.trackIndex);

        // Reorganiza o array de faixas
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        const [draggedItem] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, draggedItem);
        
        // Salva a nova ordem no IndexedDB e renderiza
        dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
        renderList();
        renderPads();
    }
    
    // ===== Navegação e View Toggle =====
    // movido para modules/navigation.js


    // ===== Inicialização do App =====
    async function init() {
        document.addEventListener('DOMContentLoaded', async () => {
           // player
            audio = $('#playerMedia');
            if (!audio) {
                log('ERRO: Elemento #playerMedia não encontrado');
            }
           // banco
            try {
                await openDB();
                log('Conexão com IndexedDB estabelecida.');
            } catch (e) {
                log(`ERRO: Falha na conexão com IndexedDB: ${e.message}`);
            }
            // tema
            const savedTheme = localStorage.getItem('showplay_theme') || 'dark';
            if (savedTheme) applyTheme(savedTheme);
            $('#themeToggle').addEventListener('click', toggleTheme);
            // playlists
            await loadPlaylists();
            setupPlaylistModal();
            setupNavigation(state, renderPlaylists, showScreen); // Chama a função importada
            setupViewToggle(); // Chama a função importada
            showScreen('#screenLibrary');
        });
    }

    init();

})();