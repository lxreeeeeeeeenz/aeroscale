# AeroScale

Gerador de escalas realistas para simulação aérea, alimentado pelos arquivos **CGNA/RPL** (Planos de Voo Repetitivos) da AZU, GLO e TAM, com cadastro de frota por matrícula, configurações individuais por aeronave, **previsão estatística de rodízio**, **METAR/TAF gratuitos**, **briefing por voo**, **link automático do SimBrief**, **IVAO Webeye** e integração com o **Google Calendar**.

- **Backend:** Python 3.10+ e Flask, com SQLite (arquivo local, sem servidor de banco).
- **Frontend:** HTML, CSS e JavaScript puro (módulos ES), sem etapa de build.
- **Dependências:** apenas `Flask` e `tzdata` (veja `requirements.txt`).

---

## 1. Instalação e execução (Windows)

### Jeito rápido
1. Instale o **Python 3.10 ou superior** em <https://www.python.org/downloads/> e marque **"Add python.exe to PATH"** no instalador.
2. Extraia a pasta `aeroscale`.
3. Dê dois cliques em **`iniciar.bat`**.
   - Na primeira vez ele cria o ambiente virtual `.venv` e instala as dependências (precisa de internet).
   - Depois ele abre o navegador em <http://localhost:5000>.
4. Para encerrar, feche a janela preta (ou aperte `Ctrl+C` nela).

### Jeito manual (PowerShell ou Prompt)
```bat
cd caminho\para\aeroscale
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Opções:
- `set AEROSCALE_PORT=5050` para trocar a porta (padrão 5000).
- `set AEROSCALE_DATA=D:\dados_aeroscale` para guardar o banco em outra pasta.
- `python app.py --no-browser` para não abrir o navegador automaticamente.

### Primeiros passos dentro do app
1. **RPL:** os arquivos da pasta `rpl/` (AZU, GLO e TAM) são importados **sozinhos** na primeira vez que o AeroScale abre. Para usar versões mais novas, troque os arquivos dessa pasta e abra o app de novo (ou use *Importar RPL → Importar arquivos da pasta rpl/*). Também dá para arrastar outros `.txt` em *Importar RPL*.
2. **Frota** → *Importar lista* com a lista TXT de matrículas. Para testar antes, use *Configurações → Dados de demonstração → Carregar aeronaves fictícias*.
3. **Gerar escala** → escolha companhia, período (semanal, mensal ou avulsa), aeronave e critérios.
4. Na escala gerada: edite, troque pernas, regere trechos, exporte **CSV** ou **.ics**, ou envie ao **Google Calendar**.

---

## 2. Como os dados RPL são interpretados

Formato observado nos arquivos anexados (largura fixa, UTF-8, quebras de linha CRLF):

```
   VALIDO VALIDO DIAS OP  IDENT  TIPO   ADEP     VEL   FL  ROTA          DEST         OBSERVACOES
   221026 231026 0004500 GLO1000 B738/M SBSP0925 N0367 270 NIBRU UZ171…  SBRJ0043 EQPT/SDFGIKRWY/LB1…
                                                           (rota cont.)               (obs. cont.)
```

| Campo | Interpretação |
|---|---|
| VALIDO DESDE / ATÉ | Datas DDMMAA |
| DIAS OP | 7 posições, de segunda a domingo; cada posição vale `0` ou o número do dia (1 a 7) |
| IDENT | Companhia (3 letras) + número do voo |
| TIPO/TURB | Designador ICAO + esteira de turbulência |
| ADEP + EOBT | Origem + horário de calços, **em UTC** |
| VEL, FL, ROTA | Velocidade, nível e rota (com as linhas de continuação) |
| DEST + EET | Destino + tempo estimado de voo (HHMM) |
| OBSERVACOES | Chaves `EQPT/`, `PBN/`, `STS/`, `DAT/`, `RMK/`, `EET/`… separadas em campos |

- **Colunas adaptáveis:** as posições de ROTA e DEST são lidas do cabeçalho de cada arquivo. Se o cabeçalho faltar, o parser usa as posições padrão. Se o DEST estiver deslocado, ele é localizado por busca e o registro recebe um aviso.
- **Nada é descartado:** cada registro guarda o texto original (com as continuações). O arquivo original fica em `data/arquivos/` e pode ser baixado pelo histórico.
- **O que é validado:** datas inválidas ou invertidas, dias de operação inconsistentes, EOBT/EET inválidos, origem igual ao destino, destino ausente, linhas fora do formato, registros duplicados, voo de outra companhia no arquivo, mesmo voo e trecho com horários diferentes no mesmo dia (ambiguidade) e aeroportos sem cadastro.
- **Registros com erro** aparecem na tela *Voos do RPL*, mas nunca entram na geração de escalas.
- **Reimportação:** um arquivo idêntico (mesmo SHA-256) é recusado, a menos que você marque *Reimportar*. Uma nova importação da mesma companhia com validade sobreposta desativa a anterior (é opcional e pode ser revertida).
- **Nova companhia:** um RPL com designador desconhecido cria a companhia automaticamente, marcada para revisão. Os modelos de aeronave são criados a partir dos tipos que aparecem no RPL.

**Chegada estimada = EOBT + EET + acréscimo de táxi** (10 min por padrão, ajustável em Configurações). O RPL não traz o horário de calço na chegada.

---

## 3. Gerador de escalas

Para cada dia do período, o gerador:
1. Pega os voos que **operam naquela data** (data UTC do EOBT) nos RPL ativos, do mesmo tipo da aeronave.
2. Faz uma busca em feixe (*beam search*) por uma sequência em que cada perna **parte do aeroporto onde a anterior chegou**. A sequência respeita o tempo de solo mínimo e máximo, a janela de partidas, a duração das pernas, os aeroportos evitados e os de preferência.
3. Aplica o **descanso mínimo** entre dias: a aeronave pernoita onde terminou.
4. Respeita **indisponibilidades** e **aeroportos restritos** da matrícula, e também voos já atribuídos a outras escalas (um voo real tem uma única aeronave).
5. Pode exigir que a aeronave volte à base todo dia ou só no fim do período.

### Pernas por dia da semana
Em *Gerar escala → Pernas e tempos*, cada dia da semana tem um limite próprio: **Padrão** (usa o máximo geral), **Folga** ou **até N pernas**. Ex.: terça "até 1" e quinta "Folga". O limite do dia tem prioridade sobre o máximo geral. Use *Salvar dias da semana e regras como padrão* para guardar o padrão.

### Regras de tripulação (GOL, LATAM e Azul)
As três operam sob o RBAC 121 e seguem a mesma legislação. Os acordos coletivos internos de cada empresa não são públicos; por isso o AeroScale aplica a regulamentação e você ajusta os limites se quiser algo mais restrito.

| Regra | Valor | Fonte |
|---|---|---|
| Jornada e tempo de voo máximos (perfil RBAC 117) | Conforme hora de apresentação e nº de etapas: de 9 h a 13 h de jornada, de 7 h a 10 h de voo | RBAC 117, Apêndice B, Tabela B.1 |
| Perfil Lei estrita | 9 h de jornada, 8 h de voo, 4 pousos (5 com +2 h de repouso) | Lei 13.475, arts. 31 e 36 |
| Apresentação / encerramento | 30 min antes da partida / 30 min após o corte (doméstico) | Lei 13.475, art. 35 |
| Repouso mínimo | 12 h (jornada até 12 h), 16 h (até 15 h), 24 h (acima) | Lei 13.475, art. 48 |
| Madrugadas (00:00–06:00) | Máx. 2 seguidas e 4 em 168 h | Lei 13.475, art. 42 |
| Folgas | ≥ 10/mês (proporcional ao período), folga após no máx. 6 dias, 1 sábado+domingo no mês; retorno de folga a partir das 10:00 | Lei 13.475, arts. 50–51; RBAC 117 Ap. B (l)(6) |
| Horas mensais | 80 h de voo (jato) / 85 h (turboélice); 44 h semanais e 176 h mensais de jornada | Lei 13.475, arts. 33 e 41 |

**Bom senso aplicado pelo gerador:**
- tempo de solo mínimo **medido no próprio RPL** (10º percentil dos voos que continuam com o mesmo número, na mesma aeronave); sem amostras suficientes, usa uma estimativa por categoria (ATR 25 min, E-Jets 30, A320/737 35);
- o dia anterior a uma folga termina na base;
- evita pernoitar em aeroporto de onde não sai voo compatível dentro da janela;
- se a aeronave ficar presa, aceita uma saída fora da janela de partidas (e avisa).

A aba **Jornadas e folgas** de cada escala mostra, para cada jornada: apresentação, fim, pousos, jornada × limite, voo × limite, repouso antes e as violações. Os totais do mês também aparecem. Escalas editadas à mão continuam sendo conferidas.

### Repetição de trecho (anormalidade)
O gerador evita o vai-e-volta repetido no mesmo par de aeroportos no mesmo dia (ex.: SBBR→SBSP→SBBR→SBSP).
- Um bate-volta (ida e volta) é normal. A **3ª perna** entre os mesmos dois aeroportos no dia é **anormalidade**.
- **Chance de anormalidade** (padrão 5% dos dias; em *Configurações → Geral* e no gerador): só nesses dias sorteados a repetição pode aparecer. 0 = nunca.
- Pernas repetidas, inclusive as inseridas à mão, ganham o selo **Anormalidade** e um aviso na validação.
- O gerador também evita repetir o dia anterior voo a voo e evita terminar o dia num aeroporto de onde não há voo depois do repouso. Antes, a aeronave podia ficar presa no solo no dia seguinte.
- Medição em 32 escalas semanais de teste: dias com repetição caíram de 40% para 0% (fora do sorteio), dias presos no solo caíram de 6 para 0, e a média de pernas por dia ficou igual (≈ 4,4).

### Reserva automática
Toda escala **semanal** (1 bloco) ou **mensal** (padrão 1 bloco; configurável de 0 a 4) recebe automaticamente um período de **RESERVA**. Escalas avulsas não recebem, a menos que você escolha blocos no gerador.

| Item | Como é decidido | Padrão (Configurações → Geral) |
|---|---|---|
| Duração | sorteada entre mínimo e máximo, **sempre dentro de 3–9 dias seguidos** | 3 a 9 |
| Posição | dias seguidos que não sejam indisponibilidade da aeronave, folga fixa do dia da semana nem compromisso da mesma aeronave em outra escala; as folgas regulamentares são planejadas **em volta** da reserva | — |
| Local | base (chance configurável) ou outro aeroporto escolhido ao acaso entre os que têm partidas compatíveis com o tipo no RPL | 80% base |
| Acionamento | sorteio independente; se acionada, sorteia o dia de início e a duração (1 até N dias, dentro do bloco) | 50%, até 3 dias |

- **Acionamento:** o planejador monta voos **reais do RPL** (companhia, tipo/matrícula, horários, continuidade e regras de tripulação) saindo do local da reserva e **voltando a ele** no último dia acionado.
  - Se não houver sequência tão longa, tenta durações menores e explica na nota.
  - Se nenhuma servir, o acionamento fica **INVIÁVEL** e nenhum voo é inventado.
- **Status:** SIMULADO (acionada, com voos), NÃO ACIONADO (todo o período sem voos) ou INVIÁVEL.
  - As pernas do acionamento são voos do RPL marcados com o selo laranja **Acionamento**: o voo existe, o acionamento é simulação.
- **Sorteios salvos:** os sorteios ficam salvos no banco (tabela `schedule_reserves`) e não mudam ao reabrir a escala.
  - *Regerar dia* fora da reserva mantém o sorteio. Dentro da reserva, é recusado.
  - *Regerar a partir da perna* dentro da reserva refaz o bloco inteiro com o mesmo sorteio.
  - *Novo sorteio da reserva* e *Regerar tudo* fazem um sorteio novo.
- **Chegada ao local:** o dia anterior tenta terminar no local da reserva. Se não der, fica registrado "deslocamento X→Y (tripulante em extra)", sem perna inventada, e a validação não acusa quebra de continuidade.
- **Onde aparece:**
  - **escala:** cartão com datas, local, sorteios e nota, e bloco RESERVA contínuo na linha do tempo;
  - **calendários:** faixa contínua no mensal, coluna marcada no semanal e também no calendário geral;
  - **exportações:** texto, CSV (linha RESERVA + coluna atividade), .ics e Google Calendar (evento de dia inteiro que acompanha os novos sorteios).
- **Regras de tripulação:** dia de reserva conta como dia de trabalho. Com as regras ligadas, uma reserva de 7–9 dias somada a dias de voo gera aviso de "dias seguidos". Para evitar, use duração máxima de até 6.

Exemplo no texto:
```
(15) RESERVA REC
(21) RESERVA REC · ACIONADO: REC-CGH-REC (3977,3976)

RESERVA: 15/11 a 21/11 (7 dias)
Local: Base REC
Acionamento: SIMULADO

ACIONAMENTO RESERVAS
(21) REC-CGH-REC (3977,3976)
```

### Escala em texto (botão *Texto* na escala)
Exporta a escala em texto simples, um dia por linha, para colar em mensagem ou bloco de notas:

```
ESCALA DE OUTUBRO:
(28) GRU-XAP-GRU-NVT-GRU-CNF (3278,3279,3526,3527,3552)
(31) FOLGA
ESCALA DE NOVEMBRO:
(01) FOLGA
(02) GRU-BPS-GRU-CNF-GRU-BSB (3338,3339,3552,3553,4583)
```
- Aeroportos pelo código IATA (ICAO quando não houver). Números de voo sem o prefixo da companhia (TAM3278 → 3278; posicionamento = POS).
- Todo dia do período sem perna e fora da reserva sai como **FOLGA**. Dias de reserva saem como "RESERVA <local>", e no fim vem o resumo de cada reserva com as pernas do acionamento.
- O dia é a data local da partida. Quebra de continuidade no mesmo dia aparece com " / ". O ano só aparece no cabeçalho quando muda (ex.: "ESCALA DE JANEIRO 2027:").
- *Copiar* põe o texto na área de transferência; *Baixar .txt* salva o arquivo (UTF-8, quebras de linha do Windows).

### Classificação de cada perna
| Cor | Origem | Significado |
|---|---|---|
| Verde | **REAL** | O voo existe no RPL naquela data |
| Ciano | **PROJETADO** | Voo real do RPL repetido pelo padrão semanal numa data **fora da validade**. É plausível, mas **não garantido** |
| Magenta | **SUGESTÃO** | Perna de posicionamento criada pelo sistema (opcional). Não tem número de voo e usa a duração mediana real do trecho; se não houver dado real do trecho, ela não é criada |
| Branco | **MANUAL** | Inserida ou alterada por você. É comparada com o RPL e sinalizada se não existir |

> O RPL **não informa matrículas nem o rodízio real** das aeronaves. Os voos são reais; a sequência e a matrícula associada são sugestões coerentes do AeroScale, e isso aparece em todas as escalas.

Os arquivos anexados valem de 22/10 a 28/10/2026. Para gerar escalas de novembro, ligue a **projeção semanal**: as pernas saem marcadas como PROJETADO. Quando chegar um RPL novo, importe-o; as pernas passam a ser conferidas com os dados novos (a validação indica se a classificação mudou).

### Edição
- **Substituir** uma perna por outro voo real (a lista mostra quais mantêm a continuidade com a perna seguinte).
- **Inserir** um voo depois de uma perna, ou adicionar uma perna manual.
- **Mover** pernas, **ordenar por horário**, **excluir**, trocar a matrícula de uma perna ou da escala inteira.
- **Regerar** a escala inteira, a partir de uma perna, ou um único dia. Ao regerar um dia, o sistema tenta manter a ligação com o dia anterior e o seguinte.
- **Validação contínua:** quebra de continuidade, solo curto, sobreposição, tipo diferente do previsto no RPL, aeronave ocupada em outra escala, aeroporto restrito, indisponibilidade, voo removido do RPL e fuso desconhecido.
- **Exportação:** CSV (separado por `;`, com BOM, abre direto no Excel em português) e `.ics`.

---

## 4. Frota e configurações por aeronave

- Cada companhia tem os seus **modelos** (nome livre + designador ICAO + família) e as suas **matrículas** (únicas no sistema todo).
- **Campos de configuração dinâmicos** (*Frota → Campos de configuração*): os tipos são SIM/NÃO/DESCONHECIDO, texto, número ou lista. O escopo pode ser por companhia e/ou por família. Os campos LATAM do exemplo (ISIS, ANALOGIC, DDRMI, DCDU, ROW/ROPS, DRAMS) já vêm criados para TAM, família A320, e o escopo pode ser editado.
- **Nenhuma configuração é presumida pelo modelo.** O que não foi informado fica DESCONHECIDO, e DESCONHECIDO nunca satisfaz o requisito "exigir SIM" no gerador.
- **Importação de listas TXT/CSV com pré-visualização:**
  - detecta tabulação, `;`, `|`, `,`, colunas alinhadas por espaços e listas em blocos (`MATRÍCULA` seguida de linhas `CHAVE: VALOR`);
  - sugere o mapeamento das colunas, que você confere antes de gravar; pode criar campos novos a partir de colunas SIM/NÃO;
  - normaliza `SIM/S/X/YES/1` e `NÃO/N/NO/0`; `N/A`, `-` e valores estranhos ficam DESCONHECIDO e geram uma pendência;
  - reconhece o modelo por texto (A320-214, 737 MAX 8, E195-E2…). Quando o modelo é ambíguo (ex.: "ATR 72" sem a variante), a aeronave fica sem modelo e é sinalizada.
- **Listas só com matrículas** (uma por linha, com a configuração no nome do arquivo, ex.: `PR-GXA - Collins (27K) SFP 2.0 ISFD.txt`): a pré-visualização pede a companhia e o **modelo da lista** e sugere os atributos do nome do arquivo (Collins, 27K, SFP 2.0, ISFD). Você define se cada um vira campo SIM/NÃO ou campo de texto (ex.: "Aviônica" = Collins). O modelo nunca é deduzido pela matrícula.
- **Alteração em lote** (*Frota → Aeronaves*, marque as caixas): trocar companhia, associar modelo e definir um campo para várias aeronaves de uma vez. O filtro **Sem modelo** mostra quem ainda não entra no gerador.
- **Reimportação segura:** valores editados manualmente não são sobrescritos (a divergência vira pendência em *Revisão*, onde você escolhe "usar valor da lista" ou "manter atual"). Um valor desconhecido na lista nova não apaga um valor já conhecido. Aeronaves ausentes da lista **não** são desativadas, a não ser que você marque a opção.
- **Histórico** de alterações por aeronave (manual, importação, revisão) e o texto original de cada linha importada.
- Filtros por companhia, modelo, matrícula, status, pendências e **equipamento instalado**. Exportação em CSV.

Exemplos **fictícios** de listas estão em `samples/frota/`. Como as listas reais ainda não foram enviadas, o importador foi feito para se adaptar ao formato com o mapeamento manual. Se o formato real tiver algo que ele não detecte, ajuste o mapeamento na pré-visualização.

---

## 5. Google Calendar

A integração usa a **API oficial Google Calendar v3** com **OAuth 2.0** (fluxo *authorization code* com PKCE e *refresh token*), chamando os endpoints do Google diretamente. Por isso não é preciso instalar mais bibliotecas.

### Configurar as credenciais (uma vez)
1. Acesse <https://console.cloud.google.com/> e crie um projeto.
2. Em **APIs e serviços → Biblioteca**, ative a **Google Calendar API**.
3. Em **Tela de consentimento OAuth**, escolha *Externo*, preencha os dados obrigatórios e adicione o seu e-mail em **Usuários de teste**.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web**.
5. Em **URIs de redirecionamento autorizados**, adicione:
   - `http://localhost:5000/api/google/callback`
   - `http://127.0.0.1:5000/api/google/callback` (se você abrir o app por esse endereço)
   - Se mudou a porta, use a porta nova. A tela *Configurações → Google Calendar* mostra a URI exata.
6. Baixe o JSON da credencial e envie em **Configurações → Google Calendar → Enviar credencial JSON**.
7. Clique em **Conectar conta Google** e autorize. Depois escolha (ou crie) a agenda de destino.

### Sincronizar
Na escala, clique em **Google Calendar → Sincronizar**. Cada perna vira um evento com companhia, voo, matrícula, tipo, origem, destino e horários. O início usa o fuso do aeroporto de origem e o fim usa o fuso do aeroporto de destino.

- **Sem duplicações:** cada evento carrega um identificador da perna (`extendedProperties`). Sincronizar de novo **atualiza** só o que mudou, recria eventos apagados no Google e remove duplicatas.
- Pernas excluídas da escala podem ter o evento removido (opção marcada por padrão).
- *Mais → Remover eventos do Google* apaga todos os eventos da escala.
- Os tokens ficam só em `data/google_token.json`, no seu computador. *Desconectar* revoga o acesso.

Sem Google configurado, use o **.ics**: no Google Calendar, *Configurações → Importar e exportar → Importar*.

---

## 6. Backup e reinstalação do Windows

**Antes de formatar:**
- dê dois cliques em **`fazer_backup.bat`**: ele salva `aeroscale-backup-AAAAMMDD-HHMM.zip` na Área de Trabalho; ou
- use *Configurações → Backup e restauração → Baixar backup*.

O arquivo contém o banco (RPL, frota, campos, histórico, escalas e configurações), os arquivos originais importados e, opcionalmente, a credencial e a autorização do Google.

**No Windows novo:**
1. Instale o Python e extraia o AeroScale.
2. **Arraste o .zip para cima de `restaurar_backup.bat`.** Ele prepara o ambiente se for preciso e restaura.
   - Também dá para rodar o `iniciar.bat` e enviar o .zip em *Configurações → Backup e restauração*.
3. Antes de restaurar, o AeroScale cria um **ponto de restauração** automático em `data/backups/`, onde ficam os 10 mais recentes.

**Pelo terminal:** `python app.py --backup arquivo.zip` e `python app.py --restore arquivo.zip`.

**Copiando a pasta:** copiar a pasta `data/` inteira também funciona.

## 7. Previsão de rodízio, meteorologia e briefing

### Previsão de continuidade (menu *Previsões*)
Dado um voo, o AeroScale estima **qual voo do RPL a mesma aeronave provavelmente faz em seguida**. Os candidatos são todos os voos compatíveis que partem do aeroporto de chegada nas 22 h seguintes.

Cada candidato recebe uma pontuação (modelo log-linear) e as pontuações viram probabilidades que somam 100%. O que pesa:

| Sinal | Efeito |
|---|---|
| Mesmo número de voo (voo com escalas) | forte a favor |
| Bate-volta com número consecutivo (G31854 → G31855) | a favor |
| Voltar para o aeroporto de onde veio | leve a favor |
| Solo acima de 90 min / parada diurna > 4 h | contra |
| Encerrar o dia (pernoite) | contra, salvo quando não há voo no mesmo dia |
| Tipo do RPL igual ao da aeronave; voo diário | leve a favor |

- **Confiança:** alta (≥ 60%, ou ≥ 45% com evidência estrutural), média (≥ 30%), baixa (abaixo disso).
- **Intervalos classificados:** solo curto, solo normal, solo longo, parada longa, pernoite, parada noturna curta, lacuna de dados e sobreposição.
- **Calibração:** os pesos foram ajustados com as 4 amostras de rodízio enviadas (2× GOL B738, Azul A20N, LATAM A320/A20N), guardadas em `aeroscale/data/observed_samples.json`. Elas servem só para calibrar e medir o modelo. **Não são importadas como voos.**
- **Qualidade medida nessas amostras** (76 transições): a perna real ficou em 1º lugar em **42%** dos casos e entre as 3 primeiras em **65%**, com 4 a ~100 candidatos por transição. A tabela completa fica em *Previsões → Qualidade do modelo*.
- **Achados das amostras usados no modelo:**
  - a aeronave voa voos registrados no RPL com outro tipo da mesma família (B738 ↔ B38M, A320 ↔ A20N/A321), por isso a compatibilidade padrão é por **família**;
  - bate-voltas costumam ter números consecutivos;
  - o solo real mínimo fica entre 30 e 40 min.
- **No gerador:** a opção *Usar o modelo de rodízio (realismo)* (ligada por padrão) faz o planejador preferir encadeamentos prováveis. Na escala, cada intervalo mostra o tipo de solo e a probabilidade do modelo, e ao fim do dia aparece a **continuação prevista** (4 passos).
- Previsões aparecem sempre com selo **"previsão – não confirmada"**. O modelo nunca cria número de voo: só escolhe entre voos que existem no RPL.

### METAR e TAF (menu *Meteorologia*)
- **Fonte principal:** API pública do [aviationweather.gov](https://aviationweather.gov/data/api/) (NOAA/NWS), gratuita e sem chave.
- **Reserva:** servidor de texto da NOAA (`tgftp.nws.noaa.gov`).
- **Decodificação local:** vento (com rajada e variação), visibilidade (m e SM), RVR, tempo presente, nuvens, visibilidade vertical, teto, temperatura, orvalho, umidade, QNH, tendência e categoria de voo (VFR/MVFR/IFR/LIFR).
- **Alertas automáticos:** trovoada/CB, rajadas, vento forte, teto baixo e risco de nevoeiro (temperatura próxima do orvalho).
- **Hora da observação e frescor:** atual (≤ 70 min), atrasado (≤ 3 h) ou desatualizado.
- **Cache local** (padrão 10 min) e **atualização automática** configuráveis em *Configurações → Geral*. O botão *Atualizar agora* ignora o cache.
- **Falha na consulta:** se as duas fontes falharem, mostra o último METAR guardado com aviso de falha. Sem nenhum dado, aparece "indisponível"; nunca é inventado.
- **TAF** aparece separado e rotulado como previsão, com validade.

### Briefing (ícone de prancheta em cada perna, ou *Briefing do dia* na escala)
- **Por perna:**
  - origem, destino, horários local e UTC, duração, matrícula, modelo e configurações da aeronave;
  - perna anterior e próxima, com o intervalo entre elas;
  - dados do RPL (rota, nível, EET, equipamento);
  - jornada do dia;
  - METAR e TAF de origem e destino, com as diferenças entre eles (categoria, QNH, temperatura, vento);
  - próximas pernas previstas pelo modelo.
- **Alertas:**
  - METAR indisponível ou desatualizado;
  - voo fora das próximas 3 h, porque nesse caso o METAR mostra a condição *atual* e não a do horário do voo.
- **Por escala/dia:** todas as pernas do dia com o METAR de cada aeródromo e a continuação prevista.
- **Exportação:** *Baixar HTML* (arquivo único, abre offline) e *Imprimir/PDF* (layout próprio para impressão).

### SimBrief (ícone de avião de papel em cada perna e painel no briefing)
Abre o despacho do SimBrief já preenchido (`dispatch.simbrief.com/options/custom`). É preciso estar logado no Navigraph/SimBrief.

| Campo | De onde vem |
|---|---|
| airline / fltnum | número do voo da perna (TAM3845 → TAM + 3845) |
| type / reg | tipo e matrícula da aeronave (matrícula FIC- não é enviada) |
| orig / dest / route / fl | registro do RPL. Perna manual ou sugerida usa o voo do RPL mais frequente no mesmo trecho (avisado na tela) |
| extrarmk | `EQPT/… PBN/…` do RPL + `OPR/<cia>` + `RMK/<texto das configurações>` |
| date / deph / depm / steh / stem | partida em UTC e EET da perna |
| altn | alternado fixo do destino (*Configurações → Geral*); senão, sugestão (veja abaixo); senão, vazio, e o SimBrief escolhe |

- **Sugestão de alternado:** aeroporto mais próximo do destino, entre 10 e 450 km, com pista pavimentada suficiente para a categoria (jato narrow-body ≥ 1600 m, E-Jet ≥ 1500 m, ATR ≥ 1200 m), preferindo os atendidos pela própria companhia no RPL. Coordenadas e pistas vêm do **OurAirports** (domínio público), em `aeroscale/airport_geo.py`.
- **No briefing:** dá para trocar alternado, nível e rota antes de abrir (o link é refeito na hora). O METAR/TAF do alternado também aparece.

### IVAO Webeye (menu *IVAO Webeye*)
- **Página própria:** o mapa ao vivo da IVAO com campos para centralizar num aeroporto (ICAO) ou seguir um indicativo (`GLO1016`, `SBGR_APP`).
- **Botão "Abrir em janela separada":** abre uma janela de verdade, reaproveitada pelos botões do briefing (origem, destino e "Seguir" o voo).
- **Se o mapa não aparecer dentro da página,** o site da IVAO está impedindo a exibição dentro de outro site. Use a janela separada.

### Dados ADS-B reais (menu *Dados ADS-B*)
Matrículas reais e rodízio observado de GOL, LATAM e Azul, tirados do **histórico aberto do [adsb.lol](https://adsb.lol)** (licença ODbL 1.0; pacotes diários em `github.com/adsblol/globe_history_AAAA`). Não usa o Flightradar24: raspar o FR24 viola os termos de uso dele.

**Como pegar as matrículas:**
1. Abra *Dados ADS-B*, escolha o período (ex.: os últimos 3 dias até ontem) e clique em **Baixar e processar**.
2. Espere a barra terminar. Cada dia leva uns 5–6 min com internet de 100 Mbit/s (~3 GB lidos por dia).
3. Em cada companhia, clique em **Adicionar à frota**: as matrículas novas entram na *Frota* com o modelo certo (B738, B38M, A20N, E295…). Aeronaves já cadastradas sem modelo ganham o modelo visto no ADS-B.

**O que acontece por baixo:**
- O pacote do dia (~3,8 GB, em partes `.tar.aa`, `.tar.ab`) é lido direto da rede por faixas de bytes. Os mapas de calor (~0,7 GB) são pulados sem baixar, e nada do pacote é gravado no disco.
- Só são abertos os rastros com endereço ICAO brasileiro (E40000–E7FFFF) e, deles, só as aeronaves com indicativo das companhias escolhidas.
- Cada trecho com o mesmo indicativo (GLO1908 visto das 08:08 às 09:30) é **ligado ao voo do RPL** com o mesmo número e horário compatível (±90 min). Indicativo fora do RPL vira perna "por posição" (aeroporto mais próximo do primeiro/último ponto em baixa altitude, quando houver).

**Medição real (24 a 27/10/2026, 4 dias; ~3 GB lidos por dia, ~4 min por dia no teste, ~5–6 min com 100 Mbit/s):**
- Matrículas encontradas: **GOL 138, LATAM 161 e Azul 135**.
- **6.190 transições** observadas (perna → próxima perna da mesma matrícula), 91% das pernas ligadas a voos do RPL.
- Com os pesos padrão, o modelo acerta a próxima perna real em 1º lugar em 49% das transições e entre as 3 primeiras em 66%.
- Solo típico (P10 · mediana, horários do RPL): GOL 51 · 71 min, LATAM 45 · 60 min, Azul 42 · 58 min. Pernas por dia (média): GOL 4,3, LATAM 4,7, Azul 5,1.
- Dias com 3+ pernas no mesmo par (ponte aérea SBRJ–SBSP, bate-voltas seguidos): GOL 20%, LATAM 21%, Azul 41% (27% no total). O botão *Usar X% (realista)* ajusta a chance de anormalidade do gerador para esse valor.
- **Matrícula para conferir:** se o transponder voou voos domésticos de uma companhia com um tipo que ela não opera no RPL (ex.: "PR-MLD A320" voando só voos da GOL), o cadastro do adsb.lol para aquele hex provavelmente está desatualizado. A aeronave fica fora da importação automática para a frota (dá para adicionar uma a uma).

**Calibrar o modelo de rodízio:** *Calibrar com os dados reais* ajusta os pesos de cada companhia por máxima verossimilhança (logit multinomial, Newton com regularização em direção aos pesos atuais). Depois mede o resultado em dados que o ajuste não viu: o último dia, ou 1 em cada 4 matrículas se houver um dia só. Nos 4 dias medidos, a calibração melhorou a qualidade das probabilidades (log-verossimilhança −2,19 → −2,06) e deixou o top 3 igual (72%), mas o 1º lugar caiu um pouco (55% → 53%), porque o ajuste otimiza probabilidade, não só o 1º lugar. Aplicar é opcional. **Aplicar estes pesos** faz o gerador, o briefing e as previsões usarem os pesos calibrados. *Voltar aos pesos padrão* desfaz.

**Limites:**
- A cobertura ADS-B no Brasil é boa no eixo SP–RJ–BH–Sul e tem buracos no Norte e no interior: pernas faltando viram "lacuna de dados", não "aeronave parada".
- O histórico sai com ~1 dia de atraso.
- Uns poucos rastros vêm sem matrícula no banco do adsb.lol: aparecem só pelo hex e não vão para a frota.
- Aeronaves das três companhias com matrícula estrangeira só entram com a opção *Incluir aeronaves com matrícula estrangeira* (bem mais lenta, abre todos os rastros).

## 8. Estrutura do projeto

```
aeroscale/
├── app.py                 ponto de entrada (python app.py)
├── iniciar.bat            instalação + execução no Windows
├── fazer_backup.bat       backup na Área de Trabalho
├── restaurar_backup.bat   arraste o .zip do backup sobre ele
├── requirements.txt
├── aeroscale/
│   ├── __init__.py        cria o app Flask
│   ├── api.py             rotas REST (/api/...)
│   ├── db.py              esquema SQLite e configurações padrão
│   ├── rpl_parser.py      parser CGNA/RPL
│   ├── rpl_service.py     importação e expansão dos voos em datas (real/projetado)
│   ├── scheduler.py       gerador, validação, edição, CSV/ICS
│   ├── crew.py            regras de tripulação (Lei 13.475 + RBAC 117)
│   ├── reserve.py         sorteio e persistência da reserva automática
│   ├── predict.py         modelo de rodízio, classificação de intervalos, backtest
│   ├── weather.py         METAR/TAF (aviationweather.gov + NOAA), decodificador, cache
│   ├── briefing.py        montagem do briefing por perna e por dia
│   ├── briefing_html.py   exportação do briefing em HTML
│   ├── simbrief.py        link do SimBrief e sugestão de alternado
│   ├── adsb.py            histórico ADS-B (adsb.lol): leitura, ligação ao RPL, estatísticas, calibração
│   ├── airport_geo_world.py  aeroportos do mundo para identificar pernas pela posição
│   ├── airport_geo.py     coordenadas e pistas (OurAirports)
│   ├── data/observed_samples.json  amostras de rodízio usadas na calibração
│   ├── backup.py          backup/restauração completos
│   ├── fleet.py           frota, campos dinâmicos, importação de listas, histórico
│   ├── gcal.py            OAuth 2.0 + Google Calendar API
│   ├── catalog.py         companhias, tipos/famílias, aeroportos
│   └── airports.py        tabela de aeroportos e fusos
├── static/                interface (index.html, css/, js/)
├── rpl/                   RPL CGNA embutidos (AZU/GLO/TAM), importados ao abrir
├── samples/
│   └── frota/             listas de frota FICTÍCIAS para teste
├── tests/                 testes automatizados
└── data/                  criado ao rodar: banco, arquivos originais, tokens
```

**Adicionar outra companhia:** importe o RPL dela (a companhia é criada sozinha) ou cadastre-a em *Configurações → Companhias*. Depois importe a lista de frota e crie os campos específicos em *Frota → Campos de configuração*. Não é preciso mudar código.

**Backup:** copie a pasta `data/`.

---

## 9. Testes

```bat
.venv\Scripts\activate
python -m unittest discover -s tests -v
```

São 40 testes que cobrem:
- o parser com os três arquivos reais e com registros malformados;
- importação, duplicidade e ocorrências reais e projetadas;
- geração com invariantes de continuidade (origem = destino anterior, solo mínimo e mesma matrícula), restrições, requisitos de equipamento, projeção mensal, edição, regeração e exportações;
- importação e reimportação de frota com conflitos;
- o fluxo OAuth e a sincronização com o Google Calendar contra um **servidor Google simulado** (criar, não duplicar, atualizar, remover e recuperar vínculos perdidos);
- regras de tripulação, limites por dia da semana e backup/restauração;
- decodificador de METAR, troca de fonte, cache e falha de rede contra um **servidor meteorológico simulado**, previsão de rodízio, qualidade do modelo e briefing;
- repetição de trecho como anormalidade, link do SimBrief (campos, ajustes, alternado fixo e sugerido);
- leitura do histórico ADS-B contra um **servidor GitHub simulado** (pacote em 2 partes, pulo dos trechos grandes, filtro do Brasil, ligação ao RPL, frota, pesos) e o ajuste dos pesos;
- a exportação da escala em texto (formato, FOLGA, números de voo);
- a importação automática da pasta `rpl/`;
- a reserva automática: limites de 3–9 dias, taxas de local e acionamento, indisponibilidade, folgas em volta, voos reais saindo e voltando ao local, acionamento inviável sem inventar voos, persistência dos sorteios, exportações e Google Calendar.

---

## 10. Limitações conhecidas

- **Matrícula e rodízio:** o RPL não informa a aeronave real de cada voo. O encadeamento é uma sugestão coerente, não o rodízio real da companhia.
- **Validade curta dos RPL anexados** (22 a 28/10/2026): escalas futuras dependem da projeção semanal, que fica marcada como não garantida. Uma lacuna *dentro* do período coberto por importações diferentes não é projetada.
- **Horário de chegada** é estimado (EOBT + EET + táxi). O RPL não traz o horário de chegada no portão.
- **Dias de operação** seguem a data UTC do EOBT, como no RPL. Voos noturnos podem aparecer no dia local anterior.
- **Listas de frota reais** ainda não foram fornecidas. O importador foi testado com exemplos fictícios em dois formatos; formatos muito diferentes podem precisar de mapeamento manual.
- **Google Calendar** foi testado contra um servidor que simula a API, não contra a conta Google real (isso depende das suas credenciais). Em modo de teste do Google, o refresh token pode expirar em 7 dias; nesse caso, clique em *Reconectar*.
- **Regras de tripulação** valem para tripulação simples aclimatada em voos domésticos. Não consideram sobreaviso, reserva, cruzamento de 3+ fusos nem tripulação composta. A jornada de uma escala montada para uma aeronave é tratada como a jornada do piloto que voa essa aeronave.
- **Previsão de rodízio** foi calibrada com só 4 amostras (cerca de 100 pernas) e um RPL de uma semana. Por isso ainda não há sazonalidade: o modelo usa só o dia da semana. É uma estimativa estatística, não o rodízio real.
- **METAR é a condição atual**, não uma previsão para o horário do voo. Para isso existe o TAF. Sem internet, a meteorologia fica indisponível (ou mostra o último dado em cache, com aviso).
- **METAR/TAF** foram testados contra um servidor que simula o formato da API do aviationweather.gov. O formato real foi conferido na documentação e numa resposta real da API.
- **Alternado sugerido** é só uma proposta pela distância e pela pista. Ele não considera NOTAM, horário de funcionamento nem meteorologia; confira no SimBrief ou fixe o seu em *Configurações*.
- **IVAO Webeye** depende do site da IVAO. O mapa dentro da página pode ser bloqueado pelo próprio site; a janela separada sempre funciona.
- **Uso local e de um usuário só:** o servidor de desenvolvimento do Flask atende em `127.0.0.1`. Ele não foi feito para ficar exposto na rede.
- **Fontes:** a interface usa a fonte **Bahnschrift**, nativa do Windows 10/11. Em outros sistemas, ela cai para uma fonte equivalente.

---

## 11. Dados fictícios

Tudo que é de demonstração está marcado:
- aeronaves com prefixo **FIC-** e selo **FICTÍCIA**, criadas por *Configurações → Dados de demonstração* e removíveis pelo mesmo menu;
- as listas em `samples/frota/`.

Os RPL em `rpl/` são os arquivos reais do CGNA.

---

## 12. Fontes de dados e licenças
- **RPL:** Planos de Voo Repetitivos publicados pelo CGNA (DECEA), na pasta `rpl/`.
- **Coordenadas e pistas de aeroportos:** [OurAirports](https://ourairports.com/data/) (domínio público).
- **METAR/TAF:** [aviationweather.gov](https://aviationweather.gov/data/api/) (NOAA/NWS) e NOAA tgftp.
- **ADS-B:** histórico aberto do [adsb.lol](https://adsb.lol) (ODbL 1.0). Os dados derivados guardados no seu banco seguem a mesma licença.
- **Uso:** projeto de simulação aérea. Não serve para operação real.

## 13. Publicar no GitHub
O passo a passo está em [`PUBLICAR_NO_GITHUB.md`](PUBLICAR_NO_GITHUB.md). Ao enviar uma tag `vX.Y.Z`, o GitHub Actions roda os testes, monta o `.zip` e publica o release com as notas do [`CHANGELOG.md`](CHANGELOG.md).

