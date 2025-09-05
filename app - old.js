(function() {
    'use strict';

    // ===== IndexedDB Helper =====
    const DB_NAME = 'showplayDB';
    const DB_VERSION = 1;
    const PLAYLISTS_STORE = 'playlists';
    const FILES_STORE = 'files';
    let db;

    function openDB() {
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

    const dbActions = {
        get: (storeName, key) => dbRequest(storeName, 'readonly', store => store.get(key)),
        getAll: (storeName) => dbRequest(storeName, 'readonly', store => store.getAll()),
        put: (storeName, item) => dbRequest(storeName, 'readwrite', store => store.put(item)),
        delete: (storeName, key) => dbRequest(storeName, 'readwrite', store => store.delete(key)),
        add: (storeName, item) => dbRequest(storeName, 'readwrite', store => store.add(item)),
    };

    // ===== Seletores e Constantes =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    let audio; // Elemento de áudio central

    const svgCover = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-10c-3.04 0-5.5 2.46-5.5 5.5s2.46 5.5 5.5 5.5 5.5-2.46 5.5-5.5-2.46-5.5-5.5-5.5z"/></svg>';
    const svgEdit = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    const playPauseIcons = {
        play: '▶',
        pause: '❚❚',
    };
    const volumeIcons = {
        on: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
        off: '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.52 1.52C19.57 15.06 20 13.53 20 12c0-4.07-3.06-7.44-7-7.93v2.02c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.41.33-.88.62-1.39.86l1.63 1.63c.98-.68 1.83-1.57 2.45-2.55l1.63 1.63L22 22 16.73 16.73 4.27 3zm10.73 8.1l-6.26-6.26.96-.96A.98.98 0 0 1 9.4 4c.3-.3.65-.55 1.05-.75L12 3.23v2.06c1.1.33 2.02.93 2.8 1.76l1.58 1.58-1.55 1.55zM12 19.77v-2.06c-1.1-.33-2.02-.93-2.8-1.76l-.52-.52-1.42 1.42.41.41c.54.54 1.15.99 1.83 1.34L12 19.77z"/></svg>'
    };

    // FUNÇÃO DE LOG CORRIGIDA
    function log(message) {
        const logContainer = document.getElementById('statusLog');
        if (logContainer) {
            const entry = document.createElement('p');
            const timestamp = new Date().toLocaleTimeString();
            entry.textContent = `[${timestamp}] ${message}`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight; // Scroll para o final
        }
        console.log(`[LOG] ${message}`); // Mantém o log no console do navegador
    }

    // ===== Estado Global da Aplicação =====
    const state = {
        playlists: [],
        currentPlaylistIndex: -1,
        currentTrackIndex: -1,
        isEditing: false,
        dragSrcEl: null,
        modal: {
            tracks: [],
            cover: null
        },
        player: {
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
    function showScreen(screenId) {
        $$('.screen').forEach(s => s.classList.remove('active'));
        $(screenId).classList.add('active');
        $('#btnBack').style.display = (screenId !== '#screenLibrary') ? 'block' : 'none';
        $('#viewToggle').style.display = (screenId === '#screenPlaylist') ? 'inline-flex' : 'none';
    }

    function toggleMiniPlayer(show) {
        $('#miniPlayer').classList.toggle('active', show);
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function parseTimeToSeconds(timeString = '0:00') {
        if (!timeString || typeof timeString !== 'string') return 0;
        const parts = timeString.split(':').map(Number);
        if (parts.some(isNaN)) return 0; // Handle invalid numbers

        if (parts.length === 2) { // MM:SS
            return (parts[0] * 60) + parts[1];
        }
        if (parts.length === 3) { // HH:MM:SS
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        }
        return 0;
    }

    function resizeAndCompressImage(file, callback) {
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

    // ===== Tema =====
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        $('#themeToggle').textContent = theme === 'light' ? '☀︎' : '☾';
        localStorage.setItem('showplay_theme', theme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    }

    // ===== Navegação =====
    function setupNavigation() {
        $('#btnBack').addEventListener('click', () => {
            if ($('#playerCard').classList.contains('active')) {
                closePlayerCard();
                if (state.currentPlaylistIndex !== -1) {
                    $('#headerTitle').textContent = state.playlists[state.currentPlaylistIndex].name;
                }
            } else if ($('#screenPlaylist').classList.contains('active')) {
                $('#headerTitle').textContent = 'Minhas Playlists';
                toggleMiniPlayer(false);
                showScreen('#screenLibrary');
                renderPlaylists();
            }
        });
    }

    function navigateToPlaylist(index) {
        state.currentPlaylistIndex = index;
        const playlist = state.playlists[state.currentPlaylistIndex];
        $('#headerTitle').textContent = playlist.name;
        renderList();
        renderPads();
        showScreen('#screenPlaylist');
        toggleMiniPlayer(state.currentTrackIndex !== -1);
    }

    // ===== Modal de Playlist =====
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
            log('Evento: Seleção de arquivo de capa.');
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                log(`Capa selecionada: ${file.name}`);
                state.modal.cover = file;
                resizeAndCompressImage(file, (dataUrl) => {
                    $('#coverPreview').style.backgroundImage = `url(${dataUrl})`;
                    $('#coverPreview').innerHTML = '';
                });
            }
        });

        $('#tracksFileInput').addEventListener('change', (e) => {
            log('Evento: Seleção de arquivos de áudio.');
            const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
            log(`Arquivos de áudio filtrados: ${files.length} arquivos.`);
            
            const trackPromises = files.map(file => new Promise((resolve, reject) => {
                log(`Processando arquivo: ${file.name}`);
                const trackName = file.name.replace(/\.[^/.]+$/, "");
                const audioTemp = new Audio(URL.createObjectURL(file));
                
                audioTemp.addEventListener('loadedmetadata', () => {
                    log(`Sucesso: Metadados carregados para ${file.name}.`);
                    resolve({
                        title: trackName,
                        artist: "Artista Desconhecido",
                        delay: 0,
                        duration: formatTime(audioTemp.duration),
                        file: file
                    });
                    URL.revokeObjectURL(audioTemp.src);
                });
                audioTemp.onerror = (e) => {
                    log(`ERRO: Falha ao carregar metadados para ${file.name}.`);
                    reject(new Error(`Could not load metadata for ${file.name}`));
                };
            }));

            Promise.all(trackPromises)
                .then(newTracks => {
                    log(`Sucesso: Promise.all resolvida. ${newTracks.length} novas faixas.`);
                    state.modal.tracks.push(...newTracks);
                    log(`Array de tracks no estado do modal atualizado. Total: ${state.modal.tracks.length}`);
                    renderModalTracks();
                    log('Função renderModalTracks chamada.');
                })
                .catch(error => {
                    log(`ERRO: Falha na Promise.all: ${error.message}`);
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
        
        state.modal.cover = null; // Reset cover, will be loaded from DB
        if (playlist.coverKey) {
            dbActions.get(FILES_STORE, playlist.coverKey).then(file => {
                if (file) {
                    const url = URL.createObjectURL(file);
                    $('#coverPreview').style.backgroundImage = `url('${url}')`;
                    $('#coverPreview').innerHTML = '';
                }
            }).catch(err => {
                console.error("Could not load cover for editing:", err);
                $('#coverPreview').innerHTML = '<span>Capa não encontrada</span>';
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

        // 1. Save cover file if it's a new File object
        let coverKey = state.isEditing ? state.playlists[state.currentPlaylistIndex].coverKey : null;
        if (state.modal.cover instanceof File) {
            log('Capa da playlist é um novo arquivo. Salvando no IndexedDB...');
            coverKey = await dbActions.add(FILES_STORE, state.modal.cover).catch(e => {
                log(`ERRO: Falha ao salvar a capa: ${e.message}`);
                return null;
            });
            log(`Capa salva com a chave: ${coverKey}`);
        }

        // 2. Save new audio files and get their keys
        const trackPromises = state.modal.tracks.map(async (track) => {
            if (track.file instanceof File) {
                log(`Processando faixa para salvamento: ${track.title}`);
                const fileKey = await dbActions.add(FILES_STORE, track.file).catch(e => {
                    log(`ERRO: Falha ao salvar o arquivo de áudio "${track.title}": ${e.message}`);
                    return null;
                });
                log(`Arquivo "${track.title}" salvo com a chave: ${fileKey}`);
                return { title: track.title, artist: track.artist, delay: track.delay, duration: track.duration, fileKey: fileKey };
            }
            return track;
        });

        try {
            const tracksWithKeys = await Promise.all(trackPromises);
            log('Sucesso: Todos os arquivos foram processados e as chaves obtidas.');

            const playlistData = {
                id: state.isEditing ? state.playlists[state.currentPlaylistIndex].id : 'p' + Date.now(),
                name: name,
                coverKey: coverKey,
                tracks: tracksWithKeys
            };

            if (state.isEditing) {
                state.playlists[state.currentPlaylistIndex] = playlistData;
            } else {
                state.playlists.push(playlistData);
            }

            await dbActions.put(PLAYLISTS_STORE, playlistData);
            log('Playlist salva com sucesso no IndexedDB.');
            renderPlaylists();
            closeModal();
        } catch (e) {
            log(`ERRO fatal: Falha no processamento final da playlist: ${e.message}`);
        }
    }

    async function removePlaylist() {
        if (confirm('Tem certeza que deseja remover esta playlist?')) {
            const playlistToRemove = state.playlists[state.currentPlaylistIndex];
            // Delete associated files
            if (playlistToRemove.coverKey) await dbActions.delete(FILES_STORE, playlistToRemove.coverKey);
            for (const track of playlistToRemove.tracks) {
                if (track.fileKey) await dbActions.delete(FILES_STORE, track.fileKey);
            }
            // Delete the playlist record
            await dbActions.delete(PLAYLISTS_STORE, playlistToRemove.id);

            state.playlists.splice(state.currentPlaylistIndex, 1);
            renderPlaylists();
            closeModal();
            state.currentTrackIndex = -1;
            toggleMiniPlayer(false);
            showScreen('#screenLibrary');
            $('#headerTitle').textContent = 'Minhas Playlists';
        }
    }
    
    // FUNÇÃO renderModalTracks CORRIGIDA
    function renderModalTracks() {
        const list = $('#modalTrackList');
        // Clear the list
        list.innerHTML = '';
        
        if (state.modal.tracks.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.color = 'var(--muted)';
            emptyMessage.style.padding = '10px';
            emptyMessage.textContent = 'Nenhuma faixa';
            list.appendChild(emptyMessage);
            return;
        }

        state.modal.tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'track-item';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'title';
            titleSpan.textContent = track.title;
            item.appendChild(titleSpan);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.dataset.index = index;
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                state.modal.tracks.splice(index, 1);
                renderModalTracks();
            });
            item.appendChild(removeBtn);

            list.appendChild(item);
        });
    }

    // ===== Renderização das Telas =====
    function renderPlaylists() {
        const grid = $('#screenLibrary .grid');
        grid.innerHTML = '';
        if (state.playlists.length === 0) {
            grid.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 20px;">Nenhuma playlist. Clique no "+" para adicionar.</p>';
            return;
        }
        state.playlists.forEach((playlist, index) => {
            // Calcula a duração total da playlist
            const totalDurationInSeconds = playlist.tracks.reduce((total, track) => {
                return total + parseTimeToSeconds(track.duration);
            }, 0);
            const totalDurationFormatted = formatTime(totalDurationInSeconds);

            const card = document.createElement('div');
            card.className = 'card';
            card.dataset.playlistIndex = index;

            // Asynchronously load the cover image
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
                if (!e.target.closest('.options-btn')) navigateToPlaylist(index);
            });
            card.querySelector('.options-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForEdit(index);
            });
            grid.appendChild(card);
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
                <div class="play open-player">${svgCover}</div>
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

    function setupTrackEventListeners(element, track, index) {
        element.addEventListener('click', (e) => {
            if (e.target.closest('.delay-input')) return;
            if (e.target.closest('.play.open-player')) {
                e.stopPropagation();
                if ($('#playerCard').classList.contains('active') && state.currentTrackIndex === index) {
                    closePlayerCard();
                } else {
                    playTrack(track, index);
                    openPlayerCard(track);
                }
            } else {
                playTrack(track, index);
                if ($('#playerCard').classList.contains('active')) {
                    updatePlayerCardContent(track);
                }
            }
        });

        const delayInput = element.querySelector('.delay-input');
        if (delayInput) {
            delayInput.addEventListener('input', function() {
                track.delay = Math.max(0, Math.min(300, parseInt(this.value || 0)));
                this.value = track.delay;
                dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);

                // Atualiza o pad correspondente no modo Live
                const correspondingPad = $(`.pad[data-track-index="${index}"]`);
                if (correspondingPad) {
                    const subElement = correspondingPad.querySelector('.sub');
                    if (subElement) {
                        subElement.textContent = `${track.duration} • Delay ${track.delay}s`;
                    }
                }
            });
        }

        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('dragleave', handleDragLeave);
        element.addEventListener('drop', handleDrop);
        element.addEventListener('dragend', handleDragEnd);
    }

    // ===== Lógica do Player =====
    function updatePlayerUI() {
        // Atualiza o ícone de play/pause
        const miniPlayPauseBtn = $('#miniPlay');
        if (miniPlayPauseBtn) {
            const icon = state.player.isPlaying ? playPauseIcons.pause : playPauseIcons.play;
            miniPlayPauseBtn.innerHTML = icon;
        }

        // Atualiza o título no mini-player
        if (state.currentTrackIndex !== -1) {
            const track = state.playlists[state.currentPlaylistIndex].tracks[state.currentTrackIndex];
            $('#miniTitle').textContent = track.title;
            updateActiveTrackUI(state.currentTrackIndex);
        }

        // Mostra ou esconde o mini-player
        toggleMiniPlayer(state.currentTrackIndex !== -1);
    }

    function updateProgress() {
        if (audio.duration && !state.player.isSeeking) {
            const progressPercent = (audio.currentTime / audio.duration) * 100;
            const miniProgress = $('#miniProgress');
            if (miniProgress) {
                miniProgress.style.width = `${progressPercent}%`;
            }

            const currentTimeEl = $('#miniCurrentTime');
            if (currentTimeEl) {
                currentTimeEl.textContent = formatTime(audio.currentTime);
            }
        }
    }

    function togglePlayPause() {
        console.log(`--- Botão Play/Pause Clicado ---`);
        console.log(`Estado ANTES: isPlaying = ${state.player.isPlaying}, trackIndex = ${state.currentTrackIndex}`);
        // Se nenhuma música estiver selecionada, toca a primeira da playlist atual.
        if (state.currentTrackIndex === -1) {
            if (state.currentPlaylistIndex !== -1 && state.playlists[state.currentPlaylistIndex]?.tracks.length > 0) {
                playTrack(state.playlists[state.currentPlaylistIndex].tracks[0], 0);
            }
            return;
        }

        // Se uma música já estiver selecionada, alterna o estado de reprodução.
        // A verificação é feita pelo nosso estado `isPlaying`, não pelo `audio.paused`,
        // para evitar problemas durante o delay.
        if (state.player.isPlaying) {
            console.log('Ação: PAUSAR');
            // Se a intenção era tocar (ou já está tocando), agora a intenção é pausar.
            if (state.player.delayTimeout) { // Se um 'play' está agendado, cancela.
                clearTimeout(state.player.delayTimeout);
                state.player.delayTimeout = null;
            }
            audio.pause(); // Pausa o áudio. O evento 'pause' atualizará o estado e a UI.
        } else {
            console.log('Ação: TOCAR');
            // Se estava pausado, a intenção agora é tocar.
            audio.play(); // Toca o áudio. O evento 'play' atualizará o estado e a UI.
        }
    }

    async function playTrack(track, index) {
        console.log(`▶️ Tocar faixa: "${track.title}" (index: ${index})`);
        hideCountdown(); // Cancela qualquer contagem regressiva ao iniciar uma nova faixa
        if (!audio || !track.fileKey) {
            alert(`Arquivo de áudio para "${track.title}" não encontrado no banco de dados.`);
            return;
        }

        const audioFile = await dbActions.get(FILES_STORE, track.fileKey);
        if (!audioFile) {
            alert(`Não foi possível carregar o arquivo para "${track.title}".`);
            return;
        }

        // Limpa qualquer delay de TRANSIÇÃO agendado anteriormente.
        if (state.player.delayTimeout) {
            clearTimeout(state.player.delayTimeout);
            state.player.delayTimeout = null;
        }
        audio.pause(); // Garante que qualquer som anterior pare.

        state.currentTrackIndex = index;
        state.player.isPlaying = true; // Define a INTENÇÃO de tocar.
        updatePlayerUI(); // Atualiza a UI imediatamente para mostrar o ícone de PAUSE.

        audio.src = URL.createObjectURL(audioFile);
        audio.play().catch(e => {
            console.error("Erro ao tocar áudio:", e);
            // Se o play falhar, reverte o estado e a UI.
            state.player.isPlaying = false;
            updatePlayerUI();
        });

        // Se o player card estiver aberto, atualiza seu conteúdo.
        if ($('#playerCard').classList.contains('active')) {
            updatePlayerCardContent(track);
        }
    }

    function updateActiveTrackUI(index) {
        $$('.pad, .row').forEach(el => el.classList.remove('active'));
        const activePad = $(`.pad[data-track-index="${index}"]`);
        if (activePad) activePad.classList.add('active');
        const activeRow = $(`.row[data-track-index="${index}"]`);
        if (activeRow) activeRow.classList.add('active');
    }

    // Apenas atualiza o conteúdo visual, não controla a reprodução
    async function updatePlayerCardContent(track) {
        $('#nowTitle').textContent = track.title;
        $('#nowArtist').textContent = track.artist;
        // A fonte do áudio (src) já é gerenciada pela função playTrack
    }

    function openPlayerCard(track) {
        updatePlayerCardContent(track);
        $('#playerCard').classList.add('active');
        $$('#listMode, #liveMode').forEach(el => el.classList.add('player-active'));
    }

    function closePlayerCard() {
        // Pausa a música ao fechar o player principal para evitar confusão
        if (state.player.isPlaying) {
            audio.pause();
        }
        $('#playerCard').classList.remove('active');
        $$('#listMode, #liveMode').forEach(el => el.classList.remove('player-active'));
    }

    function setupPlayerControls() {
        const btnClose = $('#btnClosePlayer');
        if (btnClose) btnClose.addEventListener('click', closePlayerCard);

        const btnPlayPause = $('#miniPlay');
        if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlayPause);

        $('#miniNext')?.addEventListener('click', () => changeTrack(1));
        $('#miniPrev')?.addEventListener('click', () => changeTrack(-1));
    }

    function changeTrack(direction) {
        if (state.currentPlaylistIndex === -1) return;
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        if (tracks.length === 0) return;
        const newIndex = (state.currentTrackIndex + direction + tracks.length) % tracks.length;
        playTrack(tracks[newIndex], newIndex);

        // Se o player card estiver aberto, atualiza o conteúdo
        if ($('#playerCard').classList.contains('active')) {
            updatePlayerCardContent(tracks[newIndex]);
        }
    }

    // ===== Drag-and-Drop =====
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
            const tracks = state.playlists[state.currentPlaylistIndex].tracks;
            const fromIndex = parseInt(state.dragSrcEl.dataset.trackIndex);
            const toIndex = parseInt(this.dataset.trackIndex);

            const playingTrack = state.currentTrackIndex !== -1 ? tracks[state.currentTrackIndex] : null;

            const [draggedItem] = tracks.splice(fromIndex, 1);
            tracks.splice(toIndex, 0, draggedItem);

            state.currentTrackIndex = playingTrack ? tracks.findIndex(t => t.title === playingTrack.title) : -1;

            dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]); // Save the reordered playlist
            renderList();
            renderPads();

            if (state.currentTrackIndex !== -1) {
                updateActiveTrackUI(state.currentTrackIndex);
            }
        }
    }

    function handleDragEnd() {
        this.style.opacity = '1';
        $$('.row, .pad').forEach(item => item.classList.remove('drag-over'));
        state.dragSrcEl = null;
    }

    // ===== Volume Global =====
    function setupVolumeControl() {
        const volumeSlider = $('#volumeGlobal');
        const volumeIconContainer = $('#volumeIcon');

        function setVolumeIcon(value) {
            volumeIconContainer.innerHTML = value > 0 ? volumeIcons.on : volumeIcons.off;
        }

        function updateVolume(vol) {
            state.volume.current = vol;
            setVolumeIcon(vol);
            if (vol > 0) state.volume.previous = vol;
            if (audio) {
                audio.volume = vol / 100;
                audio.muted = vol === 0;
            }
        }

        volumeSlider.addEventListener('input', function() {
            updateVolume(parseInt(this.value));
        });

        volumeIconContainer.addEventListener('click', function() {
            const newVolume = state.volume.current === 0 ? (state.volume.previous > 0 ? state.volume.previous : 70) : 0;
            volumeSlider.value = newVolume;
            updateVolume(newVolume);
        });

        updateVolume(state.volume.current); // Set initial state
    }

    // ===== Eventos do Elemento de Áudio =====
    function setupAudioEvents() {
        audio.addEventListener('play', () => {
            log('EVENTO: "play" disparado. Atualizando estado para PLAY.');
            state.player.isPlaying = true;
            updatePlayerUI();
        });
        audio.addEventListener('pause', () => {
            log('EVENTO: "pause" disparado. Atualizando estado para PAUSE.');
            state.player.isPlaying = false;
            updatePlayerUI();
        });
        audio.addEventListener('ended', () => {
            log('EVENTO: "ended" disparado.');
            const playlist = state.playlists[state.currentPlaylistIndex];
            if (!playlist || state.currentTrackIndex < 0) return;

            const currentTrack = playlist.tracks[state.currentTrackIndex];
            if (!currentTrack) return;

            const delayValue = currentTrack.delay || 0;

            // Se o delay for 0, mostra a mensagem STOP e para.
            if (delayValue === 0) {
                log(`--- FIM DA MÚSICA --- Faixa "${currentTrack.title}" terminou. Delay é 0. Parando a reprodução.`);
                const overlay = $('#countdownOverlay');
                const numberEl = $('#countdownNumber');
                if (overlay && numberEl) {
                    numberEl.textContent = 'STOP';
                    overlay.classList.add('active', 'stop-message');
                    setTimeout(() => {
                        overlay.classList.remove('active', 'stop-message');
                    }, 1000); // Mostra por 1 segundo
                }
                state.player.isPlaying = false;
                updatePlayerUI();
                return;
            }

            // Se o delay for > 0, inicia a transição com contagem regressiva.
            log(`--- FIM DA MÚSICA --- Faixa "${currentTrack.title}" terminou. Iniciando contagem de ${delayValue}s para a próxima.`);
            startCountdownTransition(delayValue);
        });
        audio.addEventListener('timeupdate', updateProgress);
    }

    // ===== Lógica da Contagem Regressiva Visual =====
    function startCountdownTransition(seconds) {
        hideCountdown(); // Garante que não haja contagens anteriores ativas

        const overlay = $('#countdownOverlay');
        const numberEl = $('#countdownNumber');
        let count = seconds;

        numberEl.textContent = count;
        overlay.classList.add('active');

        state.player.countdownInterval = setInterval(() => {
            count--;
            if (count > 0) {
                numberEl.textContent = count;
            } else {
                hideCountdown(); // Limpa o intervalo e esconde o overlay
                changeTrack(1);  // Toca a próxima música
            }
        }, 1000);
    }

    function hideCountdown() {
        if (state.player.countdownInterval) {
            clearInterval(state.player.countdownInterval);
            state.player.countdownInterval = null;
        }
        const overlay = $('#countdownOverlay');
        if (overlay) {
            overlay.classList.remove('active', 'stop-message');
        }
    }

    // ===== Barra de Progresso Interativa (Seek e Drag) =====
    function setupProgressBar() {
        const progressBar = $('.mini-player-fixed .progress-bar');
        if (!progressBar) return;

        const seek = (e) => {
            if (!audio.duration) return;
            const rect = progressBar.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const newTime = (clickX / rect.width) * audio.duration;

            // Atualiza o tempo do áudio
            audio.currentTime = newTime;

            // Atualiza a UI manualmente para feedback instantâneo durante o arraste
            const progressPercent = (clickX / rect.width) * 100;
            const miniProgress = $('#miniProgress');
            if (miniProgress) miniProgress.style.width = `${progressPercent}%`;
            const currentTimeEl = $('#miniCurrentTime');
            if (currentTimeEl) currentTimeEl.textContent = formatTime(newTime);
        };

        const handleMouseMove = (e) => {
            if (state.player.isSeeking) {
                seek(e);
            }
        };

        const handleMouseUp = () => {
            state.player.isSeeking = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        progressBar.addEventListener('mousedown', (e) => {
            state.player.isSeeking = true;
            seek(e); // Permite o clique e o início do arraste
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        });
    }

    // ===== View Toggle =====
    function setupViewToggle() {
        $('#viewToggle').addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') return;

            const isList = e.target.id === 'btnList';
            $('#btnList').classList.toggle('active', isList);
            $('#btnLive').classList.toggle('active', !isList);
            $('#listMode').style.display = isList ? '' : 'none';
            $('#liveMode').style.display = isList ? 'none' : '';

            if (isList && state.currentTrackIndex !== -1) {
                const track = state.playlists[state.currentPlaylistIndex].tracks[state.currentTrackIndex];
                if (track.fileKey) {
                    openPlayerCard(track);
                }
            } else {
                // Não chame closePlayerCard() pois ele pausa a música.
                // Apenas esconda o card visualmente ao mudar para o modo Live.
                $('#playerCard').classList.remove('active');
                $$('#listMode, #liveMode').forEach(el => el.classList.remove('player-active'));
            }
            toggleMiniPlayer(state.currentTrackIndex !== -1);
        });
    }

    // ===== Inicialização do App =====
    async function init() {
        document.addEventListener('DOMContentLoaded', async () => {
            await openDB();
            audio = $('#playerMedia'); // Atribui o elemento de áudio aqui, quando o DOM está pronto

            const savedTheme = localStorage.getItem('showplay_theme') || 'dark';
            if (savedTheme) applyTheme(savedTheme);

            state.playlists = await dbActions.getAll(PLAYLISTS_STORE);
            renderPlaylists();
            toggleMiniPlayer(false);
            showScreen('#screenLibrary');

            setupNavigation();
            setupPlaylistModal();
            setupAudioEvents();
            setupPlayerControls();
            setupProgressBar();
            setupVolumeControl();
            setupViewToggle();
            $('#themeToggle').addEventListener('click', toggleTheme);
        });
    }

    init();

})();