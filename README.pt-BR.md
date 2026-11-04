# REA Pro Max

**Entenda o mecanismo. Reconstrua o comportamento. Verifique o resultado.**

Uma skill independente de engenharia reversa com ferramentas executáveis para Claude Code e Codex. Transforme um app, uma extensão ou uma função web desconhecida em um mecanismo que você consegue explicar, uma implementação que consegue executar e um contrato de comportamento finito que consegue verificar.

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[Explore o laboratório gravado](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Instale a skill](docs/INSTALL.md) · [Registro de verificação](docs/VALIDATION.md) · [Versões](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## Uma interface convincente é só o começo

A dificuldade vem depois do clique: qual contexto recebe a mensagem, onde o estado persiste, o que o cancelamento interrompe, qual erro chega a quem chamou e por que a função reconstruída falha na segunda tentativa.

REA Pro Max traz essas perguntas para a implementação. Analise o JavaScript distribuído. Declare explicações concorrentes. Escolha um experimento que as diferencie. Implemente o comportamento solicitado no seu projeto. Compare saídas, alterações de estado e eventos observados. Reduza uma divergência às ações que ainda reproduzem a mesma falha.

**A entrega é a funcionalidade executável que você pediu, acompanhada de evidências.** O agente do seu ambiente faz a programação e as operações de runtime; as ferramentas incluídas executam análise, priorização de experimentos, verificação e redução de falhas.

## Passe uma tarefa, sem aprender outro processo

Depois de [instalar](docs/INSTALL.md), peça o trabalho no Claude Code:

```text
/rea-pro-max Investigue como esta extensão salva e restaura dados e implemente esse comportamento no meu projeto. Mapeie os limites entre popup, content script, worker e armazenamento. Verifique a persistência após um reinício confirmado do worker, preserve os erros e entregue código executável, os casos realmente testados e o que continuar sem verificação.
```

No Codex, selecione a skill ou acrescente `$rea-pro-max` no início da mesma tarefa. Forneça o alvo e o projeto de destino; o agente prepara os arquivos internos do caso. Observar um navegador, app ou dispositivo real exige as ferramentas correspondentes no seu ambiente.

- **Reconstrua uma funcionalidade específica:** ordem, erros, cancelamento e limites de persistência.
- **Entenda uma extensão MV3:** separe os contextos popup, content, page e worker.
- **Recupere limites do Electron:** analise fontes extraídas de main, preload e renderer.
- **Explique uma regressão entre builds:** compare entradas e efeitos observáveis compatíveis.
- **Reduza uma falha reproduzível:** preserve sua identidade enquanto encurta a sequência.

## Execute o mecanismo antes de confiar na promessa

Requer **Node.js 22+**. As ferramentas rodam diretamente, sem chave de API, `npm install` ou servidor REA original.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Abra `rpm-lab/report.html` no navegador. O laboratório sintético próprio executa workers de referência e com regressão em um **modelo JavaScript controlado, com APIs do Chrome simuladas**. Análise, classificação de testes, detecção de divergências e redução são resultados reais do núcleo. Isso não comprova a suspensão de um worker em Chromium real. Observações de runtime realizadas separadamente estão no [registro de verificação](docs/VALIDATION.md).

Analise o artefato incluído:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Use novos caminhos de saída: resultados existentes não são sobrescritos silenciosamente. Consulte a [instalação e referência da CLI](docs/INSTALL.md), em inglês, para configurar o ambiente e usar mais comandos.

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

**Análise integrada na v0.1:** arquivos JavaScript e fontes extraídas de web, Manifest V3 e Electron. Expressões dinâmicas, sintaxe não suportada, imports ausentes e limites de recursos ficam explícitos.

**Núcleo independente de provedores:** gestão de casos, priorização de experimentos, comparação finita, redução de sequências e relatórios locais. `shrink` executa explicitamente o módulo oráculo `.mjs` que você fornece e controla.

**Fluxos avançados com ferramentas do ambiente:** prompts para native, managed, Android, Apple, React Native, Flutter, Tauri e WebAssembly. A análise profunda depende de ferramentas adequadas realmente disponíveis. Não inclui decompilador universal, runtime mobile, extrator para qualquer pacote ou motor de recuperação semântica. Detectar um formato ou ter um template não equivale a uma integração verificada.

A CLI não faz requisições de rede nem envia telemetria. Seu ambiente de IA e ferramentas externas seguem políticas de dados próprias. Os relatórios podem conter caminhos, código e valores sensíveis. Leia [privacidade e limites de execução](docs/PRIVACY.md), em inglês, antes de compartilhá-los.

## O que fica com você

Uma reconstrução deve entregar fontes executáveis e instruções de execução, o contrato escolhido, as operações realmente testadas, evidências JSON e os limites restantes. Um `pass` finito vale para os casos verificados, não para a equivalência de toda a aplicação.

O laboratório exporta `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` e o relatório independente `report.html`. Inspecione os registros separadamente, guarde-os com o projeto e exporte todo o conteúdo JSON pelo workbench.

Referências técnicas em inglês: [Skill](skills/rea-pro-max/SKILL.md) · [Escopo](skills/rea-pro-max/references/target-analysis.md) · [Formato de casos](skills/rea-pro-max/references/case-format.md) · [Contrato de verificação](skills/rea-pro-max/references/verification.md) · [Prompts](skills/rea-pro-max/references/prompt-library.md).

Projeto desenvolvido de forma independente. Inspiração de pesquisa e avisos de dependências estão nos [créditos](THIRD_PARTY_NOTICES.md); REA original não é dependência obrigatória. [Licença MIT](LICENSE).

**Traga uma funcionalidade que mereça ser entendida. Leve um resultado que você pode verificar.**
