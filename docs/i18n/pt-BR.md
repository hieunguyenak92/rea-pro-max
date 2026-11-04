# REA Pro Max

**Entenda o mecanismo. Reconstrua o comportamento. Verifique o resultado.**

Um conjunto independente de ferramentas de engenharia reversa com MCP local, skill de agente e CLI direta para Claude Code, Codex e clientes MCP compatíveis. Transforme um app, uma extensão ou uma função web desconhecida em um mecanismo que você consegue explicar, uma implementação que consegue executar e um contrato de comportamento finito que consegue verificar.

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[Explore o laboratório gravado](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Instale a skill](../INSTALL.md) · [Registro de verificação](../VALIDATION.md) · [Versões](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![Workbench real do REA Pro Max no laboratório sintético próprio](../media/workbench.png)

*Relatório real do modelo JavaScript com APIs do Chrome simuladas; não comprova o ciclo de vida do Chromium real.*

## Uma interface convincente é só o começo

A dificuldade vem depois do clique: qual contexto recebe a mensagem, onde o estado persiste, o que o cancelamento interrompe, qual erro chega a quem chamou e por que a função reconstruída falha na segunda tentativa.

REA Pro Max traz essas perguntas para a implementação. Analise o JavaScript distribuído. Declare explicações concorrentes. Escolha um experimento que as diferencie. Implemente o comportamento solicitado no seu projeto. Compare saídas, alterações de estado e eventos observados. Reduza uma divergência às ações que ainda reproduzem a mesma falha.

**A entrega é a funcionalidade executável que você pediu, acompanhada de evidências.** O agente do seu ambiente faz a programação e as operações de runtime; as ferramentas incluídas executam análise, priorização de experimentos, verificação e redução de falhas.

## Passe uma tarefa, sem aprender outro processo

Depois de [instalar](../INSTALL.md), peça o trabalho no Claude Code:

```text
/rea-pro-max Investigue como esta extensão salva e restaura dados e implemente esse comportamento no meu projeto. Mapeie os limites entre popup, content script, worker e armazenamento. Verifique a persistência após um reinício confirmado do worker, preserve os erros e entregue código executável, os casos realmente testados e o que continuar sem verificação.
```

No Codex, selecione a skill ou acrescente `$rea-pro-max` no início da mesma tarefa. Forneça o alvo e o projeto de destino; o agente prepara os arquivos internos do caso. Observar um navegador, app ou dispositivo real exige as ferramentas correspondentes no seu ambiente.

- **Reconstrua uma funcionalidade específica:** ordem, erros, cancelamento e limites de persistência.
- **Entenda uma extensão MV3:** separe os contextos popup, content, page e worker.
- **Recupere limites do Electron:** analise fontes extraídas de main, preload e renderer.
- **Explique uma regressão entre builds:** compare entradas e efeitos observáveis compatíveis.
- **Reduza uma falha reproduzível:** preserve sua identidade enquanto encurta a sequência.

## Uma ferramenta. Três formas de começar.

**A v0.2 adiciona MCP local com 12 ferramentas**, permitindo que o agente invoque diretamente o núcleo de análise e verificação. A skill fornece o procedimento; a CLI permite executar e inspecionar resultados de forma independente. O runtime inclui parser e SDK oficial do MCP, sem instalação npm para uso.

### Conecte MCP ao Claude Code ou Codex

Substitua os caminhos absolutos pelos seus. O workspace deve existir e conter os alvos e os locais de saída necessários. Estes são comandos para você executar: o produto não altera automaticamente a configuração de outro aplicativo.

**Os caminhos dos comandos abaixo usam a estrutura do checkout Git.** No ZIP da skill empacotado em Releases, a pasta extraída `rea-pro-max/` é a raiz da skill: execute nela `node scripts/rea-pro-max.mjs demo --out ./rpm-lab`, use `/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs` para MCP e copie a pasta inteira ao instalar. [Estrutura e comandos ZIP, em inglês](../INSTALL.md#choose-your-package-layout). Os arquivos Source code automáticos do GitHub mantêm a estrutura do checkout.

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

Reconecte o ambiente, confira as ferramentas e peça uma chamada a `get_capabilities`. Se o app desktop tiver outro PATH, use o caminho absoluto do executável Node. O [guia MCP em inglês](../MCP.md) inclui configuração JSON, argumentos, limites e tratamento de erros.

O servidor usa stdio local. Quando iniciado diretamente, aguarda mensagens MCP em vez de mostrar uma interface interativa:

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### Instale a skill para passar tarefas naturalmente

Copie **toda** a pasta `skills/rea-pro-max` para `.claude/skills/rea-pro-max` em um projeto Claude Code ou `.agents/skills/rea-pro-max` no Codex. `lib`, `scripts`, `references` e `assets` fazem parte do sistema executável. Copiar apenas `SKILL.md` deixa os mecanismos de fora.

Depois use `/rea-pro-max` no Claude Code ou selecione/mencione `$rea-pro-max` no Codex. [INSTALL.md em inglês](../INSTALL.md) traz cópia sem sobrescrita, locais pessoais e instruções para Windows.

### Rode a CLI de forma independente

A demo abaixo funciona sem MCP. Escolha skill, MCP ou CLI conforme seu ambiente; o servidor REA original não é um requisito.

## Catálogo MCP: do artefato a um resultado entregável

| Ferramenta | Trabalho |
| --- | --- |
| `get_capabilities` | Consulta versão, workspace, escopo, limites e política de execução. |
| `inspect_artifact` | Analisa estaticamente o alvo admitido e mantém o resultado completo por um handle. |
| `read_artifact` | Lê seções ou páginas sem repetir todo o grafo. |
| `create_case` | Cria um caso com a identidade real do alvo inspecionado. |
| `revise_case` | Valida o patch e a revisão esperada antes de atualizar. |
| `record_observation` | Mantém observações, origem, autoridade e bindings declarados. |
| `rank_probes` | Ordena experimentos permitidos; não os executa. |
| `verify_behavior` | Compara arquivos de observações sob um contrato finito. |
| `export_artifact` | Salva JSON ou HTML independente em um arquivo novo no workspace. |
| `run_owned_lab` | Executa apenas o modelo controlado dos workers próprios incluídos. |
| `list_task_prompts` | Consulta os 36 templates por família e página. |
| `import_case` | Retoma um caso JSON exportado e validado. |

Handles são identificadores opacos na memória do processo. O cache é limitado; após reinício ou remoção, importe o caso salvo ou analise novamente. Use `read_artifact` para ler o necessário. Os schemas descobertos pelo cliente definem os argumentos exatos.

MCP restringe caminhos escolhidos pelo cliente ao workspace, rejeita links simbólicos e não sobrescreve saídas. É uma política de admissão das ferramentas, não um sandbox do sistema operacional para Node ou outras ferramentas do ambiente. Não expõe shell, inicialização de apps, controle de navegador nem execução arbitrária de oráculos. `run_owned_lab` roda apenas código próprio fixo.

## Execute o mecanismo antes de confiar na promessa

Requer **Node.js 22+**. As ferramentas rodam diretamente, sem chave de API, `npm install` ou servidor REA original.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Abra `rpm-lab/report.html` no navegador. O laboratório sintético próprio executa workers de referência e com regressão em um **modelo JavaScript controlado, com APIs do Chrome simuladas**. Análise, classificação de testes, detecção de divergências e redução são resultados reais do núcleo. Isso não comprova a suspensão de um worker em Chromium real. Observações de runtime realizadas separadamente estão no [registro de verificação](../VALIDATION.md).

Analise o artefato incluído:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Use novos caminhos de saída: resultados existentes não são sobrescritos silenciosamente. Consulte a [instalação e referência da CLI](../INSTALL.md), em inglês, para configurar o ambiente e usar mais comandos.

## Conhecimento especializado que você pode inspecionar

| Capacidade | O que acrescenta à investigação |
| --- | --- |
| Análise dos limites do artefato | AST com Acorn, contextos distintos, conexões candidatas de comunicação, posições exatas e resumos de conteúdo. `inspect` não executa o código-alvo. |
| Explicações concorrentes | Hipóteses, previsões e receitas de teste com reinicialização explícita, evitando aceitar a primeira história plausível. |
| Priorização conservadora | Eliminação de hipóteses no pior caso por custo declarado, filtrada por capacidades, efeitos permitidos e orçamento. Previsões ausentes continuam desconhecidas. |
| Observações vinculadas | Identidades de alvo, cenário, reset e ferramentas excluem observações incompatíveis da inferência atual. Um hash identifica conteúdo, não comprova a execução. |
| Verificação finita | `pass`, `fail` e `unknown` para saídas, estado, efeitos e traces, mantendo eventos duplicados e a ordem relevante. |
| Redução da falha | Remoção limitada de ações, com verificações repetidas do oráculo e a mesma impressão digital da falha. Não promete a menor sequência global. |
| Workbench local | HTML independente com busca, filtros de contexto, seleção de evidências e exportação completa em JSON. Sem backend ou CDN. |
| 36 prompts de tarefas | Web, extensões, desktop e famílias mobile com pré-requisitos explícitos. Um template não certifica suporte de um provedor. |

O planejador escolhe a próxima pergunta; não executa o teste. O verificador compara observações fornecidas; não atesta sozinho que o runtime foi executado. A skill orienta o agente a fazer esse trabalho e preservar as evidências.

## Escopo definido, limites visíveis

**Análise integrada na v0.2:** arquivos JavaScript e fontes extraídas de web, Manifest V3 e Electron. Expressões dinâmicas, sintaxe não suportada, imports ausentes e limites de recursos ficam explícitos.

**Núcleo independente de provedores:** gestão de casos, priorização de experimentos, comparação finita, redução de sequências e relatórios locais. `shrink` executa explicitamente o módulo oráculo `.mjs` que você fornece e controla.

**Fluxos avançados com ferramentas do ambiente:** prompts para native, managed, Android, Apple, React Native, Flutter, Tauri e WebAssembly. A análise profunda depende de ferramentas adequadas realmente disponíveis. Não inclui decompilador universal, runtime mobile, extrator para qualquer pacote ou motor de recuperação semântica. Detectar um formato ou ter um template não equivale a uma integração verificada.

A CLI não faz requisições de rede nem envia telemetria. Seu ambiente de IA e ferramentas externas seguem políticas de dados próprias. Os relatórios podem conter caminhos, código e valores sensíveis. Leia [privacidade e limites de execução](../PRIVACY.md), em inglês, antes de compartilhá-los.

## O que fica com você

Uma reconstrução deve entregar fontes executáveis e instruções de execução, o contrato escolhido, as operações realmente testadas, evidências JSON e os limites restantes. Um `pass` finito vale para os casos verificados, não para a equivalência de toda a aplicação.

O laboratório exporta `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` e o relatório independente `report.html`. Inspecione os registros separadamente, guarde-os com o projeto e exporte todo o conteúdo JSON pelo workbench.

## Exemplos reais e evidências revisáveis

**Busca Unicode:** a [implementação receptora](../../examples/recovered-search/CONTRACT.md) reconstrói o contrato selecionado do fixture web: NFKC, minúsculas por locale, substring, ordem estável e IDs de texto. A referência e o app receptor foram iniciados separadamente. Casos finitos e limites estão em [VALIDATION.md](../VALIDATION.md). O mesmo agente criou e verificou o exemplo com acesso ao código; não é estudo cego ou benchmark causal da skill.

![A implementação de busca executada separadamente](../media/recovered-search.png)

**Exportação Electron:** o fixture próprio percorreu renderer → preload → `ipcRenderer.invoke` → main e o JSON local foi lido depois. As conexões estáticas mantêm autoridade de candidato; a observação de execução comprova a operação exercitada.

![Resposta real da exportação Electron](../media/electron-runtime.png)

## Decisões especializadas dentro do motor

A pontuação de um teste divide as hipóteses elimináveis no pior caso pelo custo declarado. Antes disso aplica capacidades, efeitos permitidos e orçamento. Se todas as hipóteses contradizem observações qualificadas, pode retornar `model_incomplete`; se nenhum teste admissível distingue as alternativas, `no_discriminating_probe`. A incerteza não vira porcentagens de confiança sem fundamento.

O verificador só permite normalização em caminhos explícitos de metadata, preservando diferenças em output/state/effects/trace. Contratos de ordem total ou por canal mantêm duplicatas e ordem relevante. O redutor repete verificações do oráculo, aceita reset antes de cada tentativa e mantém a impressão digital da falha. A minimalidade se limita às remoções realmente verificadas.

## Perguntas frequentes e solução de problemas

**Preciso de MCP e skill juntos?** Não. MCP oferece ferramentas estruturadas; a skill oferece instruções para a tarefa. A CLI funciona diretamente.

**A skill escreve a funcionalidade?** Ela orienta o agente do ambiente a implementar e executar no seu projeto. Um relatório não conclui uma reconstrução.

**O caso sobrevive ao encerramento do MCP?** Exporte JSON antes de sair e use `import_case` em uma nova sessão. Handles não persistem entre processos.

**Por que `unknown`?** Confira observações incompletas, entradas não comparáveis e bindings de scenario/reset/toolchain/verifier. Não vira `pass` automaticamente.

| Problema | Próximo passo |
| --- | --- |
| MCP não inicia | Confira Node22+, caminhos absolutos e workspace existente. |
| Ferramentas não aparecem | Reconecte, veja o estado do servidor e as permissões MCP. |
| Handle indisponível | Importe um caso salvo ou analise de novo após reinício/remoção do cache. |
| Conflito de revisão | Leia o caso mais recente e use a revisão real. |
| Limite de recursos ou caminho fora do escopo | Restrinja o artefato ou selecione o workspace correto. |
| Saída já existe | Use outro nome e preserve a evidência anterior. |

Próximas direções: resolução estática mais profunda com incerteza explícita, mais exemplos reproduzíveis de recuperação e integrações por versão quando puderem ser exercitadas. São direções de desenvolvimento, não suporte já publicado.

Referências técnicas em inglês: [Skill](../../skills/rea-pro-max/SKILL.md) · [Escopo](../../skills/rea-pro-max/references/target-analysis.md) · [Formato de casos](../../skills/rea-pro-max/references/case-format.md) · [Contrato de verificação](../../skills/rea-pro-max/references/verification.md) · [Prompts](../../skills/rea-pro-max/references/prompt-library.md).

Projeto desenvolvido de forma independente. Inspiração de pesquisa e avisos de dependências estão nos [créditos](../../THIRD_PARTY_NOTICES.md); REA original não é dependência obrigatória. [Licença MIT](../../LICENSE).

**Traga uma funcionalidade que mereça ser entendida. Leve um resultado que você pode verificar.**
