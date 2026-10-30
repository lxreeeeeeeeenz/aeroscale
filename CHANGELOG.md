# Histórico de versões

Formato: [versão] – data. Datas no fuso de Brasília.

## [1.5.1] – 2026-10-30
- **Pasta `rpl/` com os RPL embutidos (AZU, GLO, TAM):** importados sozinhos na primeira abertura do app.
  - Arquivos novos colocados na pasta entram na próxima abertura; a comparação é pelo conteúdo, não pelo nome.
  - Importação apagada de propósito não volta sozinha.
  - Dá para desligar em Configurações → Geral.
- Botão "Importar arquivos da pasta rpl/" em *Importar RPL* e no painel inicial.
- **Projeto pronto para o GitHub:** `.gitignore` (dados locais e tokens ficam de fora), `.gitattributes` (CRLF nos `.bat`, bytes originais nos RPL), testes automáticos no Windows e no Linux e release automático ao enviar uma tag.

## [1.5.0] – 2026-10-29
- **Reserva automática** nas escalas semanais e mensais: bloco garantido de 3 a 9 dias seguidos.
  - Local sorteado (base ou outro aeroporto da operação) e acionamento sorteado, com voos reais do RPL saindo e voltando ao local.
  - Sem sequência compatível, o acionamento fica como inviável, sem inventar voos.
  - Sorteios salvos no banco; "Novo sorteio da reserva" e "Regerar tudo" sorteiam de novo.
- Reserva no calendário (faixa contínua), na linha do tempo (bloco com as pernas de acionamento destacadas), no texto, no CSV, no `.ics` e no Google Calendar (evento de dia inteiro).
- As folgas regulamentares são planejadas em volta da reserva; dia de reserva conta como dia de trabalho.

## [1.4.1] – 2026-10-29
- **Escala em texto simples** (botão *Texto*): `(28) GRU-REC-PNZ-REC (3376,3371,3370)`, FOLGA nos dias sem voo, copiar ou baixar `.txt`.

## [1.4.0] – 2026-10-28
- **Dados ADS-B reais (adsb.lol, licença ODbL):** lê o histórico diário direto do GitHub, sem gravar o pacote.
  - Extrai matrículas e rodízio observado de GOL, LATAM e Azul.
  - Liga cada voo ao RPL.
- Matrículas vistas no ADS-B entram na frota com um clique; cadastro duvidoso fica para conferir. Exportação em CSV.
- **Lógica operacional real:** pernas por dia, solo típico, pares repetidos e pernoites.
- Calibração dos pesos do modelo de rodízio por companhia, com validação em dados separados.

## [1.3.0] – 2026-10-28
- Vai-e-volta repetido no mesmo par vira **anormalidade** (chance configurável); o gerador evita deixar a aeronave presa no solo.
- **Link automático do SimBrief** por perna, com alternado sugerido (OurAirports) ou fixo por destino.
- **IVAO Webeye** em página própria e em janela separada.
- Aeroporto SNCP (Correia Pinto/SC) identificado.

## [1.2.0] – 2026-10-28
- **Previsão de rodízio:** modelo calibrado com rodízios observados, com probabilidade, confiança e motivos.
- **METAR e TAF gratuitos** (aviationweather.gov, com NOAA como reserva): decodificação, cache e atualização automática.
- **Briefing por voo e por dia**, com exportação em HTML e impressão.

## [1.1.0] – 2026-10-27
- Máximo de pernas por dia da semana (incluindo folga fixa).
- Regras de tripulação (Lei 13.475 e RBAC 117): jornada, repouso, madrugadas, folgas e limites mensais.
- Backup e restauração completos para reinstalar o Windows (`fazer_backup.bat`, `restaurar_backup.bat`). Otimizações de desempenho.

## [1.0.0] – 2026-10-26
- Primeira versão: parser CGNA/RPL (AZU, GLO, TAM), gerador de escalas mensais, semanais e avulsas com continuidade, voos reais, projetados e sugeridos.
- Frota por companhia com campos SIM/NÃO/DESCONHECIDO, importação de listas, histórico.
- Integração com o Google Calendar (OAuth 2.0), exportação CSV/ICS e interface escura em laranja.
