import { $, $$, log, showScreen as originalShowScreen, formatTime, parseTimeToSeconds, resizeAndCompressImage } from './modules/helpers.js';
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
            currentObjectUrl: null,
            dragSrcEl: null,
            // Propriedades para o motor de rolagem
            masterScrollInterval: null,
            isPrompterSticky: false,
            currentScrollTop: 0,
            scrollPause: { 
                isPaused: false,      // True se a rolagem estiver pausada por uma tag
                pauseEndTime: 0,      // O tempo (timestamp) em que a pausa atual deve terminar
                pausePoints: [],      // O "mapa" com a posição e duração de todas as pausas
            }
        },
        volume: {
            current: 70,
            previous: 70
        }
    };

    /**
     * Wrapper para a função showScreen que também atualiza o estado do header (logo/botão voltar).
     * Centraliza a lógica de visibilidade dos elementos do header.
     * @param {string} screenId O ID da tela a ser exibida.
     */
    function showScreen(screenId) {
        const headerLogo = $('#headerLogo');
        const btnBack = $('#btnBack');

        if (screenId === '#screenPlaylist') {
            if (headerLogo) headerLogo.style.display = 'none';
            if (btnBack) btnBack.style.display = 'flex';
        } else { // Default to library view
            // Ao voltar para a tela de playlists, para e reseta o player.
            if (state.currentTrackIndex !== -1) {
                stopAndResetPlayer();
            }
            if (headerLogo) headerLogo.style.display = 'block';
            if (btnBack) btnBack.style.display = 'none';
        }
        originalShowScreen(screenId); // Chama a função original importada de helpers.js
    }

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
        grid.querySelectorAll('.card .thumb').forEach(function(thumb) {
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
        state.playlists.forEach(function(playlist, index) {
            const totalDurationInSeconds = playlist.tracks.reduce(function(total, track) {
                return total + parseTimeToSeconds(track.duration);
            }, 0);
            const totalDurationFormatted = formatTime(totalDurationInSeconds);
            const card = document.createElement('div');
            card.className = 'card';
            card.dataset.playlistIndex = index;

            card.innerHTML = `
                <div class="thumb"></div>
                <button class="options-btn" data-index="${index}">${svgEdit}</button>
                <div class="playlist-info">
                    <h3>${playlist.name}</h3>
                    <div class="playlist-stats">
                        <span>${playlist.tracks.length} faixas</span>
                        <span>${totalDurationFormatted}</span>
                    </div>
                </div>
            `;

            const thumb = card.querySelector('.thumb');

            if (playlist.coverKey && thumb) {
                dbActions.get(FILES_STORE, playlist.coverKey).then(function(file) {
                    if (file) {
                        const url = URL.createObjectURL(file);
                        thumb.style.setProperty('--playlist-cover-image', `url('${url}')`);
                    }
                });
            }

            card.addEventListener('click', function(e) {
                if (!e.target.closest('.options-btn')) navigateToPlaylist(index);
            });
            card.querySelector('.options-btn').addEventListener('click', function(e) {
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
        let coverKey = state.isEditing ? state.playlists[state.currentPlaylistIndex].coverKey : null;
        if (state.modal.cover instanceof File) {
            coverKey = await dbActions.add(FILES_STORE, state.modal.cover);
        }
        const tracksWithKeys = [];
        for (const track of state.modal.tracks) {
            if (track.file instanceof File) {
                const fileKey = await dbActions.add(FILES_STORE, track.file);
                tracksWithKeys.push({ 
                    title: track.title, 
                    artist: track.artist, 
                    delay: track.delay, 
                    duration: track.duration, 
                    fileKey: fileKey,
                    lyrics: track.lyrics, // Garante que novas propriedades sejam salvas
                    prompter: track.prompter
                });
            } else {
                tracksWithKeys.push(track);
            }
        }
        const playlistData = {
            id: state.isEditing ? state.playlists[state.currentPlaylistIndex].id : 'p' + Date.now(),
            name: name,
            coverKey: coverKey,
            tracks: tracksWithKeys
        };
        await dbActions.put(PLAYLISTS_STORE, playlistData);
        closeModal();
        await loadPlaylists();
    }

    async function removePlaylist() {
        if (confirm('Tem certeza que deseja remover esta playlist?')) {
            const playlistToRemove = state.playlists[state.currentPlaylistIndex];
            if (playlistToRemove.coverKey) await dbActions.delete(FILES_STORE, playlistToRemove.coverKey);
            for (const track of playlistToRemove.tracks) {
                if (track.fileKey) await dbActions.delete(FILES_STORE, track.fileKey);
            }
            await dbActions.delete(PLAYLISTS_STORE, playlistToRemove.id);
            closeModal();
            await loadPlaylists();
            showScreen('#screenLibrary');
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
        list.innerHTML = '';
        tracks.forEach(function(track, i) {
            const row = document.createElement('div');
            row.className = 'row';
            row.dataset.trackIndex = i;
            row.draggable = true;
            row.innerHTML = `<div class="num">${i + 1}</div><div class="meta"><div class="title">${track.title}</div><div class="artist">${track.artist}</div></div><div class="duration">${track.duration}</div><input type="number" class="delay-input" value="${track.delay || 0}" min="0" max="300" step="1"><button class="btn-prompter-toggle" aria-label="Teleprompter"><svg viewBox="0 0 24 24"><path d="M14 10H2V8h12v2zm0 4H2v-2h12v2zm-4 4H2v-2h8v2zm-2.01-1.25V18l2.25 1.5L16 18v-1.25c0-.83.67-1.5 1.5-1.5h1c.83 0 1.5.67 1.5 1.5v2.5a1.5 1.5 0 01-1.5 1.5H12c-.55 0-1-.45-1-1v-2h-1zM22 6V3H2v3h20zM2 3h20v-1H2v1z"></path></svg></button>`;
            const prompterContainer = document.createElement('div');
            prompterContainer.className = 'prompter-container';
            prompterContainer.style.display = 'none';
            const fontSize = (track.prompter && track.prompter.fontSize) || 16;
            const lyrics = track.lyrics || 'Letra não disponível.';
            prompterContainer.innerHTML = `<div class="prompter-controls"><input type="range" class="speed-slider" min="0" max="20" step="0.1" value="0"><button class="btn-edit" aria-label="Editar">Editar</button><button class="btn-save" aria-label="Salvar" style="display:none;">Salvar</button><div class="font-size-controls"><button class="btn-font-down" aria-label="Diminuir Fonte">-A</button><button class="btn-font-up" aria-label="Aumentar Fonte">+A</button></div></div><div class="prompter-text-wrapper"><div class="prompter-text" contenteditable="false" style="font-size: ${fontSize}px;">${lyrics}</div></div>`;
            list.appendChild(row);
            list.appendChild(prompterContainer);
            setupTrackEventListeners(row, track, i);
        });
    }

    function renderPads() {
        const padsContainer = $('#liveMode');
        padsContainer.innerHTML = '';
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        padsContainer.innerHTML = tracks.length === 0 ? '<p class="empty-message">Nenhuma faixa.</p>' : '';
        tracks.forEach(function(track, i) {
            const pad = document.createElement('div');
            pad.className = 'pad';
            pad.dataset.trackIndex = i;
            pad.draggable = true;
            pad.innerHTML = `<div class="big">${i + 1}</div><div class="label">${track.title}</div><div class="sub">${track.duration} • Delay ${track.delay || 0}s</div>`;
            setupTrackEventListeners(pad, track, i);
            padsContainer.appendChild(pad);
        });
    }

async function playTrackByIndex(index) {
        stopMasterScroll();
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist) return;
        const track = playlist.tracks[index];
        if (!track) return;
        state.player.currentScrollTop = 0;

        // --- AJUSTE: Reset completo do mapa de pausas ---
        // A linha antiga foi substituída para esvaziar completamente o array.
        // Isso garante que a nova música comece com uma lista de pausas limpa.
        state.player.scrollPause.pausePoints = [];
        state.player.scrollPause.isPaused = false;
        
        log(`--- Iniciando reprodução de: "${track.title}" ---`);
        $('#countdownOverlay').classList.remove('active');
        if (state.player.countdownInterval) clearInterval(state.player.countdownInterval);
        if (state.player.delayTimeout) clearTimeout(state.player.delayTimeout);
        $('#miniTitle').textContent = track.title;
        $('#miniProgress').style.width = '0%';
        $('#miniCurrentTime').textContent = '0:00';
        try {
            const audioFile = await dbActions.get(FILES_STORE, track.fileKey);
            if (!audioFile) { return; }
            audio.pause();
            if (state.player.currentObjectUrl) URL.revokeObjectURL(state.player.currentObjectUrl);
            const newUrl = URL.createObjectURL(audioFile);
            state.player.currentObjectUrl = newUrl;
            audio.src = newUrl;
            audio.volume = state.volume.current / 100;
            audio.muted = false;
            state.currentTrackIndex = index;
            updateActiveTrackUI(index);
            await audio.play();
            startMasterScroll();
            if (state.player.isPrompterSticky) {
                const nextPrompterBtn = document.querySelector(`.row[data-track-index="${index}"] .btn-prompter-toggle`);
                if (nextPrompterBtn) {
                    setTimeout(function() { togglePrompter(nextPrompterBtn, index); }, 100);
                }
            }
        } catch (error) {
            log(`ERRO em playTrackByIndex: ${error.name}`);
        }
    }

    function updateActiveTrackUI(index) {
        document.querySelectorAll('#listMode .row.active, #liveMode .pad.active').forEach(function(el) { el.classList.remove('active'); });
        const activeRow = document.querySelector(`#listMode .row[data-track-index="${index}"]`);
        if (activeRow) {
            activeRow.classList.add('active');
            activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const activePad = document.querySelector(`#liveMode .pad[data-track-index="${index}"]`);
        if (activePad) {
            activePad.classList.add('active');
            activePad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function stopAndResetPlayer() {
        stopMasterScroll();
        audio.pause();
        if (state.player.currentObjectUrl) URL.revokeObjectURL(state.player.currentObjectUrl);
        audio.src = '';
        state.currentTrackIndex = -1;
        state.player.isPlaying = false;
        state.player.currentObjectUrl = null;
        $('#miniTitle').textContent = '';
        $('#miniProgress').style.width = '0%';
        $('#miniCurrentTime').textContent = '0:00';
        $('#miniPlay').innerHTML = playPauseIcons.play;
        $('#miniPlayer').classList.remove('is-paused');
        updateActiveTrackUI(-1);
    }

    function playNextTrack() {
        stopMasterScroll();
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || state.currentTrackIndex === -1) return;
        if (state.player.isPrompterSticky) {
            const currentPrompter = document.querySelector('.prompter-container.active');
            if (currentPrompter) {
                const currentBtn = currentPrompter.previousElementSibling.querySelector('.btn-prompter-toggle');
                currentPrompter.style.display = 'none';
                currentPrompter.classList.remove('active');
                if (currentBtn) currentBtn.classList.remove('active');
            }
        }
        const currentTrack = playlist.tracks[state.currentTrackIndex];
        const delayInSeconds = currentTrack.delay || 0;
        if (state.player.delayTimeout) clearTimeout(state.player.delayTimeout);
        if (state.player.countdownInterval) clearInterval(state.player.countdownInterval);
        const playNext = function() {
            $('#countdownOverlay').classList.remove('active');
            let nextIndex = state.currentTrackIndex + 1;
            if (nextIndex >= playlist.tracks.length) nextIndex = 0;
            playTrackByIndex(nextIndex);
        };
        if (delayInSeconds > 0) {
            const overlay = $('#countdownOverlay');
            const numberEl = $('#countdownNumber');
            let countdown = delayInSeconds;
            overlay.classList.add('active');
            numberEl.textContent = countdown;
            state.player.countdownInterval = setInterval(function() {
                countdown--;
                if (countdown > 0) numberEl.textContent = countdown;
            }, 1000);
            state.player.delayTimeout = setTimeout(playNext, delayInSeconds * 1000);
        }
    }

    function togglePlayPause() {
        if (state.currentTrackIndex === -1) {
            if (state.playlists[state.currentPlaylistIndex] && state.playlists[state.currentPlaylistIndex].tracks.length > 0) {
                playTrackByIndex(0);
            }
            return;
        }
        if (audio.paused) {
            audio.play();
            startMasterScroll();
        } else {
            audio.pause();
            stopMasterScroll();
        }
    }

    function updateProgress() {
        if (!audio.duration) return;
        $('#miniProgress').style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        $('#miniCurrentTime').textContent = formatTime(audio.currentTime);
    }

    function seek(event) {
        const progressBar = event.currentTarget;
        if (audio.duration) {
            audio.currentTime = (event.offsetX / progressBar.clientWidth) * audio.duration;
        }
    }

    function skipToNext() {
        stopMasterScroll();
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || playlist.tracks.length === 0) return;
        let nextIndex = state.currentTrackIndex + 1;
        if (nextIndex >= playlist.tracks.length) nextIndex = 0;
        playTrackByIndex(nextIndex);
    }

    function skipToPrevious() {
        stopMasterScroll();
        const playlist = state.playlists[state.currentPlaylistIndex];
        if (!playlist || playlist.tracks.length === 0) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; }
        let prevIndex = state.currentTrackIndex - 1;
        if (prevIndex < 0) prevIndex = playlist.tracks.length - 1;
        playTrackByIndex(prevIndex);
    }

    function handleVolumeChange(event) {
        const newVolume = parseInt(event.target.value, 10);
        state.volume.current = newVolume;
        audio.volume = newVolume / 100;
        const volumeIcon = $('#volumeIcon');
        if (newVolume === 0) {
            volumeIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
        } else {
            volumeIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
        }
    }

    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function() {});
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    function startMasterScroll() {
        stopMasterScroll();

        state.player.masterScrollInterval = setInterval(function() {
            // --- LÓGICA DE VERIFICAÇÃO DE PAUSA ---
            const { scrollPause } = state.player;

            // Se a rolagem está pausada por uma tag...
            if (scrollPause.isPaused) {
                // ...verifica se o tempo da pausa já acabou.
                if (Date.now() >= scrollPause.pauseEndTime) {
                    scrollPause.isPaused = false; // Acabou a pausa, libera a rolagem.
                } else {
                    return; // A pausa ainda está ativa, então não faz mais nada neste ciclo.
                }
            }
            
            // Se o player não estiver tocando, não faz nada.
            if (!state.player.isPlaying || state.currentTrackIndex === -1) return;

            const trackIndex = state.currentTrackIndex;
            const track = state.playlists[state.currentPlaylistIndex].tracks[trackIndex];
            const speed = (track.prompter && track.prompter.speed) || 0;
            
            if (speed > 0) {
                // --- VERIFICA SE UMA NOVA PAUSA DEVE SER ACIONADA ---
                for (const point of scrollPause.pausePoints) {
                    // Se a rolagem atual passou da posição de uma pausa que ainda não foi disparada...
                    if (!point.triggered && state.player.currentScrollTop >= point.position) {
                        log(`Pausa acionada por ${point.duration / 1000}s na posição ${point.position}px.`);
                        point.triggered = true; // Marca como disparada
                        scrollPause.isPaused = true; // Ativa a pausa
                        scrollPause.pauseEndTime = Date.now() + point.duration; // Define quando a pausa termina
                        return; // Para a execução deste ciclo para iniciar a pausa
                    }
                }

                // --- CÁLCULO E APLICAÇÃO DA ROLAGEM (se não houver pausa) ---
                state.player.currentScrollTop += speed / 5;
                const activePrompterWrapper = document.querySelector('.prompter-container.active .prompter-text-wrapper');
                if (activePrompterWrapper) {
                    const prompterContainer = activePrompterWrapper.closest('.prompter-container');
                    const prompterTrackIndex = parseInt(prompterContainer.previousElementSibling.dataset.trackIndex);
                    if (prompterTrackIndex === trackIndex) {
                        activePrompterWrapper.scrollTop = state.player.currentScrollTop;
                    }
                }
            }
        }, 20);
    }

    function stopMasterScroll() {
        if (state.player.masterScrollInterval) {
            clearInterval(state.player.masterScrollInterval);
            state.player.masterScrollInterval = null;
        }
    }
    
    function togglePrompter(btn, index) {
        const row = btn.closest('.row');
        const prompter = row.nextElementSibling;
        const isVisible = prompter.style.display === 'flex';

        // Procura por qualquer outro prompter que já esteja ativo
        const anyActivePrompter = document.querySelector('.prompter-container.active');
        if (anyActivePrompter) {
            // Se encontrar, fecha-o primeiro
            anyActivePrompter.style.display = 'none';
            anyActivePrompter.classList.remove('active');
            const prevBtn = anyActivePrompter.previousElementSibling.querySelector('.btn-prompter-toggle');
            if (prevBtn) prevBtn.classList.remove('active');
        }

        // Se o prompter que clicamos não era o que estava visível, nós o abrimos
        if (!isVisible) {
            prompter.style.display = 'flex';
            prompter.classList.add('active');
            btn.classList.add('active');
            
            // Atualiza o estado "sticky" para TRUE (o usuário quer o prompter aberto)
            state.player.isPrompterSticky = true;

            const prompterWrapper = prompter.querySelector('.prompter-text-wrapper');
            if (prompterWrapper) {
                // Sincroniza a posição visual com a posição "virtual" do estado
                prompterWrapper.scrollTop = state.player.currentScrollTop;
                
                // Lê a letra, encontra as tags [pause:X] e prepara o mapa de pausas
                const prompterTextEl = prompterWrapper.querySelector('.prompter-text');
                const track = state.playlists[state.currentPlaylistIndex].tracks[index];
                parseLyricsAndBuildPauseMap(prompterTextEl, track);
            }
        } else {
            // Se o prompter clicado já estava aberto, a ação de fechar desliga o modo "sticky"
            state.player.isPrompterSticky = false;
        }
    }

function parseLyricsAndBuildPauseMap(prompterTextEl, track) {
        const pausePoints = [];
        const pauseRegex = /\[pause:(\d+)\]/g;

        let originalLyrics = prompterTextEl.dataset.originalLyrics || prompterTextEl.innerHTML;
        prompterTextEl.dataset.originalLyrics = originalLyrics;
        
        let processedHTML = originalLyrics.replace(pauseRegex, (match, seconds) => {
            return `<span class="pause-marker" data-duration="${parseInt(seconds, 10) * 1000}">${match}</span>`;
        });
        
        prompterTextEl.innerHTML = processedHTML;

        // --- LÓGICA DA "LINHA DE ATIVAÇÃO" NO TOPO ---

        // 1. Calcula a altura de uma linha dinamicamente.
        const computedStyle = window.getComputedStyle(prompterTextEl);
        const lineHeight = parseFloat(computedStyle.lineHeight);
        
        // 2. Define nossa "linha de ativação" como sendo 3 linhas a partir do topo.
        const activationMarginInLines = 15;
        const topMargin = lineHeight * activationMarginInLines;

        prompterTextEl.querySelectorAll('.pause-marker').forEach(marker => {
            // A posição de ativação é a posição da tag MENOS a margem do topo.
            // Isso calcula o ponto exato de scroll necessário para que a tag
            // fique a 3 linhas do topo da tela.
            const triggerPosition = marker.offsetTop - topMargin;

            pausePoints.push({
                // Usamos Math.max(0, ...) para garantir que o valor não seja negativo.
                // Isso automaticamente trata as tags nas primeiras 3 linhas como
                // um "delay inicial" (posição 0), como explicado.
                position: Math.max(0, triggerPosition),
                duration: parseInt(marker.dataset.duration, 10),
                triggered: false
            });
        });

        state.player.scrollPause.pausePoints = pausePoints;
        log(`Mapa de pausas recriado (lógica de topo): ${pausePoints.length} pausas encontradas.`);
    }

function toggleEditSave(btn) {
        const prompterContainer = btn.closest('.prompter-container');
        const prompterText = prompterContainer.querySelector('.prompter-text');
        const btnSave = prompterContainer.querySelector('.btn-save');
        const btnEdit = prompterContainer.querySelector('.btn-edit');
        const row = prompterContainer.previousElementSibling;
        const trackIndex = parseInt(row.dataset.trackIndex);
        const track = state.playlists[state.currentPlaylistIndex].tracks[trackIndex];
        const isEditing = prompterText.contentEditable === 'true';
        
        if (isEditing) {
            prompterText.contentEditable = 'false';
            btnSave.style.display = 'none';
            btnEdit.style.display = 'inline-block';
            prompterText.style.outline = 'none';
            
            track.lyrics = prompterText.innerText; 
            
            // --- AJUSTE PARA ATUALIZAÇÃO VISUAL ---
            // Antes de redesenhar o prompter, atualizamos a fonte de dados que a 
            // função de parse usa. Isso garante que o texto novo seja exibido.
            prompterText.dataset.originalLyrics = track.lyrics;
            
            dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
            
            // Agora, ao chamar a função, ela usará o texto correto.
            parseLyricsAndBuildPauseMap(prompterText, track);

        } else {
            prompterText.contentEditable = 'true';
            btnEdit.style.display = 'none';
            btnSave.style.display = 'inline-block';
            prompterText.style.outline = '2px solid var(--accent)';
            prompterText.focus();
        }
        prompterText.removeEventListener('paste', handlePaste);
        prompterText.addEventListener('paste', handlePaste);
    }

    function handlePaste(e) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    }

    function adjustFontSize(btn, direction) {
        const prompterContainer = btn.closest('.prompter-container');
        const prompterText = prompterContainer.querySelector('.prompter-text');
        const row = prompterContainer.previousElementSibling;
        const trackIndex = parseInt(row.dataset.trackIndex);
        const track = state.playlists[state.currentPlaylistIndex].tracks[trackIndex];
        if (!track.prompter) {
            track.prompter = {};
        }
        let currentSize = parseFloat(track.prompter.fontSize) || 16;
        let newSize = currentSize + (direction * 2);
        if (newSize < 12) newSize = 12;
        if (newSize > 40) newSize = 40;
        prompterText.style.fontSize = `${newSize}px`;
        track.prompter.fontSize = newSize;
        // --- RE-MAPEIA AS PAUSAS COM O NOVO TAMANHO DE FONTE ---
        parseLyricsAndBuildPauseMap(prompterText, track);
        dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
    }

    function setupTrackEventListeners(element, track, index) {
        const isRow = element.classList.contains('row');
        if (isRow) {
            const delayInput = element.querySelector('.delay-input');
            if (delayInput) {
                delayInput.addEventListener('input', function() {
                    const newDelay = Math.max(0, Math.min(300, parseInt(this.value || 0)));
                    track.delay = newDelay;
                    this.value = newDelay;
                    dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
                    const correspondingPad = document.querySelector(`.pad[data-track-index="${index}"]`);
                    if (correspondingPad) {
                        const subElement = correspondingPad.querySelector('.sub');
                        if (subElement) subElement.textContent = `${track.duration} • Delay ${newDelay}s`;
                    }
                });
            }
            const prompterBtn = element.querySelector('.btn-prompter-toggle');
            if (prompterBtn) {
                prompterBtn.addEventListener('click', function() { togglePrompter(prompterBtn, index); });
                const prompterContainer = element.nextElementSibling;
                if (prompterContainer) {
                    const btnEdit = prompterContainer.querySelector('.btn-edit');
                    const btnSave = prompterContainer.querySelector('.btn-save');
                    const btnFontDown = prompterContainer.querySelector('.btn-font-down');
                    const btnFontUp = prompterContainer.querySelector('.btn-font-up');
                    const speedSlider = prompterContainer.querySelector('.speed-slider');
                    if (btnEdit) btnEdit.addEventListener('click', function() { toggleEditSave(btnEdit); });
                    if (btnSave) btnSave.addEventListener('click', function() { toggleEditSave(btnSave); });
                    if (btnFontDown) btnFontDown.addEventListener('click', function() { adjustFontSize(btnFontDown, -1); });
                    if (btnFontUp) btnFontUp.addEventListener('click', function() { adjustFontSize(btnFontUp, 1); });
                    if (speedSlider) {
                        speedSlider.value = (track.prompter && track.prompter.speed) || 0;
                        speedSlider.addEventListener('input', function() {
                            const newSpeed = parseFloat(speedSlider.value);
                            if (!track.prompter) track.prompter = {};
                            track.prompter.speed = newSpeed;
                            dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
                        });
                    }
                }
            }
        }
        element.addEventListener('click', function(e) {
            if (e.target.closest('.delay-input') || e.target.closest('.btn-prompter-toggle')) return;
            if (index === state.currentTrackIndex) { togglePlayPause(); } else { playTrackByIndex(index); }
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
        if (!e.target.closest('.num')) { e.preventDefault(); return; }
        state.dragSrcEl = e.currentTarget;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
        e.currentTarget.classList.add('dragging');
    }
    function handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }
    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }
    function handleDrop(e) {
        e.stopPropagation();
        if (state.dragSrcEl !== e.currentTarget) {
            reorderTracks(state.dragSrcEl, e.currentTarget);
        }
        e.currentTarget.classList.remove('drag-over');
        return false;
    }
    function handleDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.row.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    }
    function handleTouchStart(e) {
        if (!e.target.closest('.num')) return;
        state.dragSrcEl = e.currentTarget;
        e.currentTarget.classList.add('dragging');
    }
    function handleTouchMove(e) {
        if (!state.dragSrcEl) return;
        e.preventDefault();
        const touchLocation = e.targetTouches[0];
        const target = document.elementFromPoint(touchLocation.clientX, touchLocation.clientY);
        const dropTarget = target ? target.closest('.row') : null;
        document.querySelectorAll('.row.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        if (dropTarget && dropTarget !== state.dragSrcEl) {
            dropTarget.classList.add('drag-over');
        }
    }
    function handleTouchEnd(e) {
        if (!state.dragSrcEl) return;
        const dropTarget = document.querySelector('.row.drag-over');
        if (dropTarget) {
            reorderTracks(state.dragSrcEl, dropTarget);
        }
        state.dragSrcEl.classList.remove('dragging');
        document.querySelectorAll('.row.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        state.dragSrcEl = null;
    }
    function handleTouchEndCleanUp() { /* Deprecated */ }
    function reorderTracks(fromEl, toEl) {
        const fromIndex = parseInt(fromEl.dataset.trackIndex);
        const toIndex = parseInt(toEl.dataset.trackIndex);
        const tracks = state.playlists[state.currentPlaylistIndex].tracks;
        const [movedItem] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, movedItem);
        dbActions.put(PLAYLISTS_STORE, state.playlists[state.currentPlaylistIndex]);
        renderList();
        renderPads();
    }

    async function init() {
        document.addEventListener('DOMContentLoaded', async function() {
            try {
                if ('serviceWorker' in navigator) {
                    window.addEventListener('load', function() {
                        navigator.serviceWorker.register('./sw.js').then(function() {
                            log('ServiceWorker registrado.');
                        }).catch(function(err) {
                            log('Falha no registro do SW: ' + err);
                        });
                    });
                }
                if (isAppleMobile()) {
                    const volumeBar = $('.volume-global');
                    if (volumeBar) volumeBar.style.display = 'none';
                }
                audio = $('#playerMedia');
                if (!audio) audio = new Audio();
                document.body.addEventListener('touchstart', function() {
                    if (!audio.src) {
                        const promise = audio.play();
                        if (promise !== undefined) {
                            promise.then(function() { audio.pause(); }).catch(function() {});
                        }
                    }
                }, { once: true });
                await openDB();
                await loadPlaylists();
                setupPlaylistModal();
                setupNavigation(state, renderPlaylists, showScreen);
                setupViewToggle();
                const logo = $('#headerLogo');
                const savedTheme = localStorage.getItem('showplay_theme') || 'dark';
                function updateLogoForTheme(theme) { if (logo) logo.src = theme === 'light' ? 'icons/logo-light.png' : 'icons/logo-dark.png'; }
                function handleThemeToggle() {
                    const nextTheme = (localStorage.getItem('showplay_theme') || 'dark') === 'light' ? 'dark' : 'light';
                    applyTheme(nextTheme);
                    localStorage.setItem('showplay_theme', nextTheme);
                    updateLogoForTheme(nextTheme);
                }
                applyTheme(savedTheme);
                updateLogoForTheme(savedTheme);
                $('#themeToggle').addEventListener('click', handleThemeToggle);
                $('#miniPlay').addEventListener('click', togglePlayPause);
                audio.addEventListener('ended', playNextTrack);
                $('#volumeGlobal').addEventListener('input', handleVolumeChange);
                $('#miniNext').addEventListener('click', skipToNext);
                $('#miniPrev').addEventListener('click', skipToPrevious);
                $('#fullscreenBtn').addEventListener('click', toggleFullScreen);
                audio.addEventListener('play', function() {
                    state.player.isPlaying = true;
                    $('#miniPlay').innerHTML = playPauseIcons.pause;
                    $('#miniPlayer').classList.remove('is-paused');
                    document.querySelectorAll('.row.active, .pad.active').forEach(function(el) { el.classList.remove('paused'); });
                });
                audio.addEventListener('pause', function() {
                    state.player.isPlaying = false;
                    $('#miniPlay').innerHTML = playPauseIcons.play;
                    $('#miniPlayer').classList.add('is-paused');
                    document.querySelectorAll('.row.active, .pad.active').forEach(function(el) { el.classList.add('paused'); });
                });
                audio.addEventListener('timeupdate', updateProgress);
                $('.progress-bar').addEventListener('click', seek);
                const debugLog = $('#debugLog');
                if (debugLog) {
                    debugLog.addEventListener('click', function() { $('#debugLogContent').innerHTML = ''; });
                }
                showScreen('#screenLibrary');
            } catch (error) {
                document.body.innerHTML = `<div style="color:white; padding: 20px;"><h1>Erro Crítico</h1><p>${error.message}</p><pre>${error.stack}</pre></div>`;
            }
        });
    }

    init();
})();
