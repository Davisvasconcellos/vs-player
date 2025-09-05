import { $, $$, log, showScreen, formatTime, parseTimeToSeconds, resizeAndCompressImage } from './modules/helpers.js';
import { applyTheme, toggleTheme } from './modules/theme.js';
import { openDB, dbActions, PLAYLISTS_STORE, FILES_STORE } from './modules/db.js';
import { setupNavigation, setupViewToggle } from './modules/navigation.js';

// ---- miniPlayer CONFIG----
let audio = null;
const playPauseIcons = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>',
};

/**
 * Verifica se o dispositivo é um dispositivo móvel da Apple (iPhone/iPad).
 * @returns {boolean} True se for um dispositivo móvel da Apple.
 */
function isAppleMobile() {
    // iPads modernos (iPadOS 13+) se identificam como 'MacIntel' mas têm touch
    const isModernIPad = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // Dispositivos Apple mais antigos e iPhones
    const isLegacyAppleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    return isModernIPad || isLegacyAppleDevice;
}

(function() {
    'use strict';

    // ===== Seletores e Constantes =====
    const svgEdit = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

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
        currentTrackIndex: -1,
        player: {
            isPlaying: false,
            delayTimeout: null,
            isSeeking: false,
            countdownInterval: null,
            currentObjectUrl: null, // Para gerenciar a URL do áudio e evitar memory leaks
        },
        volume: {
            current: 70,
            previous: 70
        }
    };

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
        // Limpar Object URLs antigas das capas para evitar memory leaks
        grid.querySelectorAll('.card .thumb').forEach(thumb => {
            const style = thumb.style.backgroundImage;
            // Verifica se o estilo contém uma URL de blob
            if (style && style.includes('blob:')) {
                // Extrai a URL e a revoga
                const url = style.match(/url\("?(blob:.+?)"?\)/)[1];
                if (url) URL.revokeObjectURL(url);
            }
        });
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
        // Limpar Object URL da capa no modal para evitar memory leak
        const coverPreview = $('#coverPreview');
        const style = coverPreview.style.backgroundImage;
        if (style && style.includes('blob:')) {
            const url = style.match(/url\("?(blob:.+?)"?\)/)[1];
            if (url) URL.revokeObjectURL(url);
        }

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

    // --- miniPlayer FUNCTIONS ---
    /**
     * Função principal para tocar uma faixa pelo seu índice na playlist.
     * Usada tanto pelo clique do usuário quanto pelo autoplay.
     * @param {number} index O índice da faixa na playlist atual.
     */
    async function playTrackByIndex(index) {
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist) return;
        const track = playlist.tracks[index];
        if (!track) {
            log(`ERRO: Faixa no índice ${index} não encontrada.`);
            return;
        }

        log(`--- Iniciando reprodução de: "${track.title}" ---`);
        
        // Limpa qualquer contagem regressiva ou delay pendente
        $('#countdownOverlay').classList.remove('active');
        if (state.player.countdownInterval) {
            clearInterval(state.player.countdownInterval);
            state.player.countdownInterval = null;
        }
        if (state.player.delayTimeout) clearTimeout(state.player.delayTimeout);

        const miniTitle = $('#miniTitle');
        if (miniTitle) miniTitle.textContent = track.title;

        try {
            // Resetar a barra de progresso e o tempo ao carregar uma nova faixa
            $('#miniProgress').style.width = '0%';
            $('#miniCurrentTime').textContent = '0:00';

            const audioFile = await dbActions.get(FILES_STORE, track.fileKey);
            if (!audioFile) {
                log(`ERRO: Arquivo não encontrado no DB para "${track.title}".`);
                return;
            }
            
            audio.pause();
            if (state.player.currentObjectUrl) {
                URL.revokeObjectURL(state.player.currentObjectUrl);
            }

            const newUrl = URL.createObjectURL(audioFile);
            state.player.currentObjectUrl = newUrl;
            audio.src = newUrl;
            audio.volume = state.volume.current / 100;
            audio.muted = false;
            state.currentTrackIndex = index;

            // Atualiza a UI para destacar a nova faixa
            updateActiveTrackUI(index);

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    log(`ERRO AO TOCAR: ${error.name} - ${error.message}`);
                });
            }
        } catch (error) {
            log(`ERRO GERAL em playTrackByIndex: ${error.name} - ${error.message}`);
        }
    }

    /**
     * Atualiza a UI para destacar a faixa atualmente em reprodução.
     * @param {number} index O índice da faixa a ser destacada.
     */
    function updateActiveTrackUI(index) {
        // Remove a classe 'active' de qualquer item anteriormente ativo
        document.querySelectorAll('#listMode .row.active, #liveMode .pad.active').forEach(el => {
            el.classList.remove('active');
        });

        // Adiciona a classe 'active' ao novo item na lista
        const activeRow = document.querySelector(`#listMode .row[data-track-index="${index}"]`);
        if (activeRow) {
            activeRow.classList.add('active');
        }

        // Adiciona a classe 'active' ao novo item nos pads
        const activePad = document.querySelector(`#liveMode .pad[data-track-index="${index}"]`);
        if (activePad) {
            activePad.classList.add('active');
        }
    }

    /**
     * Inicia a próxima faixa da playlist após um delay.
     * Chamado quando o evento 'ended' do áudio é disparado.
     */
    function playNextTrack() {
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || state.currentTrackIndex === -1) return;

        const currentTrack = playlist.tracks[state.currentTrackIndex];
        const delayInSeconds = currentTrack.delay || 0;

        log(`Faixa terminada. Delay definido: ${delayInSeconds}s.`);

        // Limpa timers anteriores para segurança
        if (state.player.delayTimeout) clearTimeout(state.player.delayTimeout);
        if (state.player.countdownInterval) clearInterval(state.player.countdownInterval);

        const playNext = () => {
            let nextIndex = state.currentTrackIndex + 1;
            if (nextIndex >= playlist.tracks.length) {
                log('Fim da playlist, reiniciando.');
                nextIndex = 0; // Loop back to the start
            }
            log(`Tocando próxima faixa no índice: ${nextIndex}`);
            playTrackByIndex(nextIndex);
        };

        if (delayInSeconds > 0) {
            const overlay = $('#countdownOverlay');
            const numberEl = $('#countdownNumber');
            let countdown = delayInSeconds;

            overlay.classList.add('active');
            numberEl.textContent = countdown;

            state.player.countdownInterval = setInterval(() => {
                countdown--;
                if (countdown > 0) numberEl.textContent = countdown;
            }, 1000);

            state.player.delayTimeout = setTimeout(playNext, delayInSeconds * 1000);
        } else {
            playNext(); // Sem delay, toca imediatamente
        }
    }

    /**
     * Alterna entre tocar e pausar o áudio.
     * Chamado pelo botão de play/pause do mini-player.
     */
    function togglePlayPause() {
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (state.currentTrackIndex === -1) { // No track selected yet
            if (playlist && playlist.tracks.length > 0) {
                playTrackByIndex(0);
            }
            return;
        }

        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    }

    /**
     * Atualiza a barra de progresso e o tempo da música.
     * Chamado pelo evento 'timeupdate' do áudio.
     */
    function updateProgress() {
        if (!audio.duration) return; // Evita divisão por zero se a duração não for conhecida
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        $('#miniProgress').style.width = `${progressPercent}%`;
        $('#miniCurrentTime').textContent = formatTime(audio.currentTime);
    }

    /**
     * Navega para um ponto específico da música.
     * Chamado pelo clique na barra de progresso.
     * @param {MouseEvent} event O evento de clique.
     */
    function seek(event) {
        const progressBar = event.currentTarget; // O elemento com o listener (.progress-bar)
        const clickX = event.offsetX;
        const barWidth = progressBar.clientWidth;
        const duration = audio.duration;

        if (duration) {
            const newTime = (clickX / barWidth) * duration;
            audio.currentTime = newTime;
        }
    }

    /**
     * Pula para a próxima faixa da playlist.
     * Chamado pelo botão 'next' do mini-player.
     */
    function skipToNext() {
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || playlist.tracks.length === 0) return;

        let nextIndex = state.currentTrackIndex + 1;
        if (nextIndex >= playlist.tracks.length) {
            nextIndex = 0; // Volta para o início
        }
        playTrackByIndex(nextIndex);
    }

    /**
     * Pula para a faixa anterior da playlist.
     * Chamado pelo botão 'previous' do mini-player.
     */
    function skipToPrevious() {
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || playlist.tracks.length === 0) return;

        // Se a música tocou por mais de 3s, reinicia. Senão, volta.
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }

        let prevIndex = state.currentTrackIndex - 1;
        if (prevIndex < 0) {
            prevIndex = playlist.tracks.length - 1; // Vai para o final
        }
        playTrackByIndex(prevIndex);
    }

    /**
     * Lida com a mudança do controle de volume global.
     * @param {Event} event O evento de input do range slider.
     */
    function handleVolumeChange(event) {
        const newVolume = parseInt(event.target.value, 10);
        state.volume.current = newVolume;
        audio.volume = newVolume / 100;

        // Atualiza o ícone de volume para feedback visual
        const volumeIcon = $('#volumeIcon');
        if (newVolume === 0) {
            // Ícone de Mudo
            volumeIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
        } else {
            // Ícone de Volume Padrão
            volumeIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
        }
    }

    /**
     * Alterna o modo de tela cheia do aplicativo.
     */
    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                log(`Erro ao tentar entrar em tela cheia: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    function setupTrackEventListeners(element, track, index) {
        const delayInput = element.querySelector('.delay-input');
        if (delayInput) {
            delayInput.addEventListener('input', function() {
                const newDelay = Math.max(0, Math.min(300, parseInt(this.value || 0)));
                const playlist = state.playlists[state.currentPlaylistIndex];
                if (playlist && playlist.tracks[index]) {
                    // Atualiza o estado diretamente para garantir consistência
                    playlist.tracks[index].delay = newDelay;
                    this.value = newDelay;
                    dbActions.put(PLAYLISTS_STORE, playlist);
                }

                const correspondingPad = $(`.pad[data-track-index="${index}"]`);
                if (correspondingPad) {
                    const subElement = correspondingPad.querySelector('.sub');
                    if (subElement) subElement.textContent = `${track.duration} • Delay ${newDelay}s`;
                }
            });
        }

        element.addEventListener('click', (e) => {
            if (e.target.closest('.delay-input')) return;
            playTrackByIndex(index);
        });

        element.addEventListener('touchstart', handleTouchStart, { passive: false });
        element.addEventListener('touchmove', handleTouchMove, { passive: false });
        element.addEventListener('touchend', handleTouchEnd);
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('dragleave', handleDragLeave);
        element.addEventListener('drop', handleDrop);
        element.addEventListener('dragend', handleDragEnd);
    }
    
    function handleDragStart(e) {
        // Apenas permite que o arrastar comece a partir do "cabo" de numeração
        if (!e.target.closest('.num')) {
            e.preventDefault();
            return;
        }
        state.dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML); // Necessário para o Firefox
        this.classList.add('dragging');
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
        handleDragEnd.call(this);
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        $$('.row, .pad').forEach(item => item.classList.remove('drag-over'));
        state.dragSrcEl = null;
    }
    
    function handleTouchStart(e) {
        // Apenas permite que o arrastar comece a partir do "cabo" de numeração
        if (!e.target.closest('.num')) {
            return;
        }
        e.stopPropagation();
        state.dragSrcEl = this;
        this.classList.add('dragging');
    }

    function handleTouchMove(e) {
        if (!state.dragSrcEl) return;
        e.preventDefault(); // Previne a rolagem da página enquanto arrasta um item
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!targetEl || !targetEl.closest('.row, .pad')) return;
        const dropTarget = targetEl.closest('.row, .pad');
        if (dropTarget !== state.dragSrcEl) {
            $$('.row, .pad').forEach(el => el.classList.remove('drag-over'));
            dropTarget.classList.add('drag-over');
        }
    }

    function handleTouchEnd(e) {
        e.stopPropagation();
        if (!state.dragSrcEl) return;
        const touch = e.changedTouches[0];
        const dropTargetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        if (dropTargetEl) {
            const dropTarget = dropTargetEl.closest('.row, .pad');
            if (dropTarget && dropTarget !== state.dragSrcEl) {
                reorderTracks(state.dragSrcEl, dropTarget);
            }
        }
        handleTouchEndCleanUp();
    }
    
    function handleTouchEndCleanUp() {
        if (state.dragSrcEl) {
            state.dragSrcEl.classList.remove('dragging');
        }
        $$('.row, .pad').forEach(el => el.classList.remove('drag-over'));
        state.dragSrcEl = null;
    }
    
    function reorderTracks(sourceEl, targetEl) {
        const fromIndex = parseInt(sourceEl.dataset.trackIndex);
        const toIndex = parseInt(targetEl.dataset.trackIndex);
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        const [draggedItem] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, draggedItem);
        dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
        renderList();
        renderPads();
    }

    // ===== Inicialização do App =====
    async function init() {
        document.addEventListener('DOMContentLoaded', async () => {
            // Registra o Service Worker para habilitar a funcionalidade PWA
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./sw.js').then(registration => {
                        log('ServiceWorker registrado com sucesso.');
                    }).catch(err => {
                        log(`Falha no registro do ServiceWorker: ${err}`);
                    });
                });
            }

            // Adiciona uma classe ao body se for um dispositivo móvel da Apple para ocultar o volume
            if (isAppleMobile()) {
                document.body.classList.add('is-apple-mobile');
            }

            // Inicializar elemento de áudio
            audio = $('#playerMedia');
            if (!audio) { // Fallback se o elemento não existir no HTML
                audio = new Audio();
                log('AVISO: Elemento #playerMedia não encontrado, criando um novo elemento de áudio dinamicamente.');
            }

            // Pré-carregar áudio no iOS após interação do usuário
            document.body.addEventListener('touchstart', () => {
                if (!audio.src) {
                    audio.load();
                    log('Pré-carregando áudio no iOS');
                }
            }, { once: true });
            try {
                await openDB();
                log('Conexão com IndexedDB estabelecida.');
            } catch (e) {
                log(`ERRO: Falha na conexão com IndexedDB: ${e.message}`);
            }
            const savedTheme = localStorage.getItem('showplay_theme') || 'dark';
            if (savedTheme) applyTheme(savedTheme);
            $('#themeToggle').addEventListener('click', toggleTheme);
            
            await loadPlaylists(); // Carrega as playlists

            setupPlaylistModal(); // Configura o modal de playlist

            // Chama a função setupNavigation importada.
            // A lógica para limpar o destaque da faixa ativa e resetar o currentTrackIndex
            // ao clicar no botão 'Voltar' já está implementada dentro da função setupNavigation
            // em './modules/navigation.js' (conforme discussões e diffs anteriores que removeram
            // a definição local de setupNavigation deste arquivo).
            // Portanto, o bloco de código que tentava reatribuir setupNavigation era redundante
            // e causava o erro de "Assignment to constant variable".
            setupNavigation(state, renderPlaylists, showScreen); 

            // A lógica para o btnBack já está dentro de setupNavigation em modules/navigation.js

            setupViewToggle();

            // --- Event Listeners do Player ---
            $('#miniPlay').addEventListener('click', togglePlayPause);
            audio.addEventListener('ended', playNextTrack);
            $('#volumeGlobal').addEventListener('input', handleVolumeChange);
            $('#miniNext').addEventListener('click', skipToNext);
            $('#miniPrev').addEventListener('click', skipToPrevious);
            $('#fullscreenBtn').addEventListener('click', toggleFullScreen);
            audio.addEventListener('play', () => {
                state.player.isPlaying = true;
                $('#miniPlay').innerHTML = playPauseIcons.pause;
            });
            audio.addEventListener('pause', () => {
                state.player.isPlaying = false;
                $('#miniPlay').innerHTML = playPauseIcons.play;
            });
            // Adiciona listeners para a barra de progresso
            audio.addEventListener('timeupdate', updateProgress);
            $('.progress-bar').addEventListener('click', seek);

            // Adiciona listener para limpar o log de debug
            const debugLog = $('#debugLog');
            if (debugLog) {
                debugLog.addEventListener('click', () => $('#debugLogContent').innerHTML = '');
            }

            showScreen('#screenLibrary');
        });
    }

    init();
})();