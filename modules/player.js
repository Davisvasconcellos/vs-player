import { $ } from './helpers.js';

export function updatePlayerUI(state) {
    console.log('updatePlayerUI chamado:', { currentTrackIndex: state.currentTrackIndex });
    const miniTitle = $('#miniTitle');
    if (miniTitle) {
        miniTitle.textContent = 'Miniplayer Teste';
    } else {
        console.error('Elemento #miniTitle não encontrado');
    }
    toggleMiniPlayer(true); // Forçando exibição para teste
}

export function toggleMiniPlayer(show) {
    console.log('toggleMiniPlayer chamado:', { show });
    const miniPlayer = $('#miniPlayer');
    if (miniPlayer) {
        miniPlayer.classList.toggle('active', show);
        console.log('Miniplayer classList:', miniPlayer.classList);
    } else {
        console.error('Elemento #miniPlayer não encontrado');
    }
}