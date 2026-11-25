# Controle remoto sem internet

O servidor local roda em um computador da mesma rede Wi-Fi. O visor pode ser esse computador ou outro dispositivo conectado à rede.

1. Baixe ou clone este repositório no computador. Instale o Node.js antes de ficar sem internet.
2. Na pasta baixada, execute `node servidor-local.cjs`.
3. Abra no visor e no celular o mesmo endereço `http://` mostrado no terminal. Use o endereço da rede Wi-Fi.
4. No visor, selecione **Conectar controle → Gerar QR code**. No celular, selecione **Conectar controle → Escanear código** e fotografe o código, ou use **Compartilhar link de controle** para enviar o endereço ao celular.
5. Para recuperar os controles no visor, toque nos números ou pressione **Esc**. Selecione **Encerrar sessão** quando terminar.

Mantenha o servidor em execução durante o uso. Em HTTP local, o navegador pode oferecer apenas a leitura por foto e o campo para colar o link. Use uma rede confiável. Redes de convidados podem impedir a comunicação entre os dispositivos.
