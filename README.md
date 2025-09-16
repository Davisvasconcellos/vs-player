# ShowPlay - Player de Palco com Teleprompter

> Um player de áudio com teleprompter integrado, projetado para músicos e artistas se apresentarem ao vivo com confiança. Gerencie suas playlists, letras e tempos, tudo em um só lugar e funcionando offline.

## Demonstração

### Playlists com teleprompter integrado
Crie e edite playlists offline com facilidade, tags para pause no prompter.
![Gerenciamento de Playlists](https://vsplayer.dmedia.com.br/icons/gif-1.gif)

### Player em Ação modo live
Countdown para próxima música, modo dark/light.
![Player em Ação](https://vsplayer.dmedia.com.br/icons/gif-2.gif)


---


---

## ✨ Funcionalidades Principais

* **Gerenciamento de Playlists:** Crie, edite e organize múltiplas playlists para seus shows.
* **Player de Áudio Integrado:** Controles completos de reprodução (play/pause, próximo/anterior, volume, barra de progresso).
* **Teleprompter Inteligente:**
    * Rolagem de texto sincronizada com a música.
    * Velocidade de rolagem configurável por faixa.
    * **Pausas Automáticas:** Insira a tag `[pause:10]` diretamente na letra para pausar a rolagem por 10 segundos durante solos ou partes instrumentais.
    * Controles de aumento/diminuição da fonte para melhor legibilidade.
    * Editor de letras diretamente na tela.
* **Modo Performance:** Alterne entre a visualização de lista detalhada e um modo de "pads" para seleção rápida de faixas ao vivo.
* **100% Offline (Progressive Web App):**
    * Funciona diretamente no navegador, sem necessidade de instalação.
    * Todos os dados (playlists, áudios, letras) são salvos localmente no seu dispositivo usando IndexedDB.
    * Pode ser "instalado" na tela inicial do seu dispositivo (PC, Tablet, Celular) para uma experiência de aplicativo nativo.
* **Tema Claro e Escuro:** Adapte a aparência para ambientes com pouca ou muita luz.
* **Compatibilidade:** Projetado para funcionar em desktops e tablets, incluindo iPad.

## 🚀 Acessando a Aplicação

Você pode acessar a versão ao vivo do projeto em:
[**https://vsplayer.dmedia.com.br/**](https://vsplayer.dmedia.com.br/)

## 🛠️ Tecnologias Utilizadas

* **HTML5**
* **CSS3**
* **JavaScript (ES6 Modules, Vanilla JS)**
* **IndexedDB:** Para armazenamento de dados no lado do cliente.
* **Service Workers:** Para funcionalidades offline (PWA).

## 🏁 Como Rodar o Projeto Localmente

Este projeto não requer um processo de build complexo.

1.  Clone o repositório:
    ```bash
    git clone [https://github.com/Davisvasconcellos/vs-player.git](https://github.com/Davisvasconcellos/vs-player.git)
    ```
2.  Navegue até a pasta do projeto:
    ```bash
    cd vs-player
    ```
3.  Abra o arquivo `index.html` em seu navegador.
    * **Recomendação:** Para uma melhor experiência e para garantir que os módulos JavaScript e o Service Worker funcionem corretamente, utilize um servidor local. Uma opção fácil é a extensão "Live Server" para o Visual Studio Code.

## 📄 Licença

Este projeto é licenciado sob a **Creative Commons Attribution-NonCommercial 4.0 International**.

Isso significa que ele é **gratuito para uso pessoal, acadêmico e não-comercial**. Você pode baixar, modificar e usar o código livremente para esses fins, desde que atribua o crédito ao autor original.

Para detalhes completos sobre os termos de uso do aplicativo e a licença do código-fonte, veja o arquivo [**TERMOS_DE_USO.md**](TERMOS_DE_USO.md).

## 💼 Uso Comercial

Conforme a licença `CC BY-NC 4.0`, o uso deste software para fins comerciais **é proibido** sem uma licença apropriada.

Se você ou sua empresa desejam utilizar o ShowPlay em um ambiente comercial, ou integrá-lo a um produto ou serviço comercial, por favor, entre em contato para discutir e adquirir uma licença comercial.

## 📧 Contato

Davis Vasconcellos - [davisvasconcellos@gmail.com]

Link do Projeto: [https://github.com/Davisvasconcellos/vs-player](https://github.com/Davisvasconcellos/vs-player)
